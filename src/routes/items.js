import path from 'node:path';
import { searchItems, publicItem } from '../search.js';
import { readSafeFile, sourceNotFound } from '../source-files.js';
import { parseHtml } from '../formats/html.js';
import { renderMhtml } from '../formats/mhtml.js';
import { documentIdentity } from '../cache.js';
export const SOURCE_CSP = "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline' data:; font-src data:; script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'";
const formatFor = source => source.extension === '.md' ? 'markdown' : ['.mhtml', '.mht'].includes(source.extension) ? 'mhtml' : 'html';
function imageType(buffer, extension) {
  if (extension === '.png' && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (['.jpg', '.jpeg'].includes(extension) && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (extension === '.gif' && /^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6))) return 'image/gif';
  if (extension === '.webp' && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (extension === '.avif' && buffer.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(buffer.toString('ascii', 8, 32))) return 'image/avif';
  return null;
}
export async function handle({ request, response, url, library, registry, cache, sendJson, body, decode }) {
  const route = url.pathname, method = request.method;
  if (route === '/api/items' && method === 'GET') { sendJson(response, 200, searchItems(library.getSnapshot(), Object.fromEntries(url.searchParams))); return true; }
  if (route === '/api/cache' && method === 'DELETE') { sendJson(response, 200, await cache.clear()); return true; }
  const match = route.match(/^\/api\/items\/([^/]+)(?:\/(document|original|asset|trash|source|download)(?:\/([^/]+))?)?$/); if (!match) return false;
  const id = decode(match[1]), action = match[2], item = library.getItem(id); if (!item) throw sourceNotFound();
  if (!action && method === 'GET') {
    const series = item.series && library.getSnapshot().series.find(series => series.key === item.series.key), position = series?.itemIds.indexOf(id);
    const neighbor = index => { const neighbor = series && library.getItem(series.itemIds[index]); return neighbor ? { id: neighbor.id, title: neighbor.title, index: neighbor.series.index } : null; };
    sendJson(response, 200, { item: { ...publicItem(item), headings: item.headings }, prev: series ? neighbor(position - 1) : null, next: series ? neighbor(position + 1) : null, series: series ? { key: series.key, name: series.name, total: series.total } : null,
      files: item.sourceFiles.map(source => ({ format: formatFor(source), path: source.path, size: source.size, updatedAt: source.updatedAt })) }); return true;
  }
  if (action === 'trash' && method === 'POST') {
    if (body.confirm !== true) throw Object.assign(new Error('请确认移入废纸篓'), { code: 'CONFIRM_REQUIRED', status: 400 });
    try { const result = await library.trashItem(id); sendJson(response, result.failed.length ? 207 : 200, { ...result, itemId: id }); } finally { await cache.invalidateItem(id); } return true;
  }
  if (method !== 'GET') return false;
  if (action === 'asset') {
    if (!item.markdown) throw sourceNotFound();
    const asset = url.searchParams.get('path'); if (!asset || asset.includes('\0')) throw sourceNotFound();
    const file = path.resolve(path.dirname(item.markdown.path), asset), root = registry.get(item.rootId);
    const { buffer } = await readSafeFile(root.realPath, file), mime = imageType(buffer, path.extname(file).toLowerCase()); if (!mime) throw sourceNotFound('仅支持本地图片');
    response.writeHead(200, { 'content-type': mime, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'content-security-policy': SOURCE_CSP }); response.end(buffer); return true;
  }
  if (['source', 'download'].includes(action)) {
    const format = decode(match[3] || ''); const source = format === 'mhtml' && action === 'source' ? await library.readMhtmlView(id) : await library.readSource(id, format);
    response.writeHead(200, { 'content-type': source.contentType, 'content-disposition': (action === 'download' ? 'attachment' : 'inline') + "; filename*=UTF-8''" + encodeURIComponent(source.fileName), 'cache-control': 'no-store', 'content-security-policy': SOURCE_CSP, 'x-content-type-options': 'nosniff' }); response.end(source.content); return true;
  }
  if (['document', 'original'].includes(action)) {
    const format = item.html ? 'html' : item.mhtml ? 'mhtml' : 'markdown';
    // Always validate and open the current whitelisted source before checking an ETag or cache.
    const source = await library.readSource(id, format), key = documentIdentity({ itemId: id, format, path: source.path, stat: source.stat }), etag = '"' + key + '"';
    const headers = { 'content-type': action === 'document' || format === 'markdown' ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8', etag, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'x-source-format': format, 'x-site-rule': item.site || '' };
    if (action === 'original') headers['content-security-policy'] = SOURCE_CSP;
    if (request.headers['if-none-match'] === etag) { response.writeHead(304, headers); response.end(); return true; }
    const content = format === 'markdown' ? source.content : await cache.getOrCreate(key, () => format === 'mhtml' ? renderMhtml(source.buffer) : parseHtml(source.buffer).html, { itemId: id });
    response.writeHead(200, headers); response.end(content); return true;
  }
  return false;
}
