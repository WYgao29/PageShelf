import os from 'node:os';
import { rootAvailable } from '../roots.js';
export function rootResponse(root, library) {
  if (!root) return null;
  const items = library.getSnapshot().items.filter(item => item.rootId === root.id);
  return { ...root, displayPath: root.path.startsWith(os.homedir() + '/') ? '~' + root.path.slice(os.homedir().length) : root.path,
    counts: { items: items.length, files: library.getSnapshot().items.filter(item=>item.rootId===root.id).reduce((count,item)=>count+item.sourceFiles.length,0), series: root.counts?.series || 0, html: items.filter(x => x.html).length, mhtml: items.filter(x => x.mhtml).length, markdown: items.filter(x => x.markdown).length },
    state: { status: root.state, message: root.message || null, excludes: root.excludes, lastScan: root.lastScan || null, issues: root.issues || [] } };
}
function previewResponse(preview, registry) {
  const parent = preview.overlap?.parentId && registry.get(preview.overlap.parentId);
  return { ...preview, errors: preview.checks, checks: { exists: !preview.checks.some(x => x.code === 'ROOT_MISSING'), isDirectory: !preview.checks.some(x => x.code === 'ROOT_NOT_DIRECTORY'), readable: preview.valid, indexable: { total: preview.counts?.files || 0, items: preview.counts?.items || 0 } },
    duplicateOf: preview.duplicateOf ? { id: preview.duplicateOf, label: registry.get(preview.duplicateOf)?.label } : null,
    overlap: preview.overlap ? { ...preview.overlap, type: parent ? 'child_of' : 'parent_of', parent: parent ? { id: parent.id, label: parent.label } : null, parentBefore: parent?.counts?.items || 0, children: preview.overlap.childIds.map(id => ({ id, label: registry.get(id)?.label, kept: registry.get(id)?.counts?.items || 0 })) } : null };
}
export async function handle(context) {
  const { request, response, url, library, registry, sendJson, body, decode } = context;
  const route = url.pathname, method = request.method;
  if (route === '/api/roots' && method === 'GET') {
    const roots = registry.list().map(root => rootResponse(root, library)), config = registry.getConfigLoad();
    sendJson(response, 200, { roots, totals: { items: library.getSnapshot().items.length, available: registry.list().filter(rootAvailable).length }, readOnly: !!config?.readOnly, startupWarning: config?.startupWarning || '' }); return true;
  }
  if (route === '/api/scan/status' && method === 'GET') { sendJson(response, 200, library.scheduler.status()); return true; }
  if (route === '/api/scan' && method === 'POST') { const queued = registry.list().map(root => { library.scheduler.enqueue(root.id, { full: url.searchParams.get('full') === '1' }); return root.id; }); sendJson(response, 202, { queued }); return true; }
  if (route === '/api/roots/order' && method === 'PUT') { await registry.applyChange({ type: 'order', ids: body.ids }); sendJson(response, 200, { roots: registry.list().map(root => rootResponse(root, library)) }); return true; }
  const match = route.match(/^\/api\/roots\/([^/]+)(?:\/(scan|series))?$/);
  const id = match && decode(match[1]);
  if (match && !registry.get(id)) throw Object.assign(new Error('目录不存在'), { code: 'ROOT_NOT_FOUND' });
  if (match?.[2] === 'scan' && method === 'POST') { sendJson(response, 202, library.scheduler.enqueue(id, { full: url.searchParams.get('full') === '1' })); return true; }
  if (match?.[2] === 'series' && method === 'GET') { sendJson(response, 200, { series: library.getSnapshot().series.filter(series => series.rootId === id) }); return true; }
  if ((route === '/api/roots' && method === 'POST') || (match && !match[2] && method === 'PATCH')) {
    const input = method === 'PATCH' ? { ...body, path: body.path ?? registry.get(id).path, label: body.label ?? registry.get(id).label } : body;
    if (url.searchParams.get('dryRun') === '1') { sendJson(response, 200, previewResponse(await registry.preview(input, { excludeId: id }), registry)); return true; }
    const result = await registry.applyChange({ type: method === 'PATCH' ? 'patch' : 'add', id, input: method === 'PATCH' ? body : input });
    result.affected.forEach(entry => library.scheduler.enqueue(entry.rootId, entry));
    if (body.options?.series && library.recomputeMetadata) library.recomputeMetadata(id);
    sendJson(response, method === 'POST' ? 201 : 200, { root: rootResponse(result.root, library), scan: { queued: result.affected.map(x => x.rootId) } }); return true;
  }
  if (match && !match[2] && method === 'DELETE') { const result = await registry.applyChange({ type: 'remove', id }); result.affected.forEach(entry => library.scheduler.enqueue(entry.rootId, entry)); sendJson(response, 200, { removed: id, scan: { queued: result.affected.map(x => x.rootId) } }); return true; }
  return false;
}
