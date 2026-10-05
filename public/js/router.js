const decode = value => { try { return decodeURIComponent(value || ''); } catch { return ''; } };
export function parseRoute(input = '/') {
  const url = new URL(input, 'http://local'), match = url.pathname.match(/^\/r\/([^/]+)(?:\/(s|f)\/(.+))?$/), rootId = match ? decode(match[1]) : '', seriesKey = match?.[2] === 's' ? decode(match[3]) : '', q = url.searchParams.get('q') || '';
  return { rootId, seriesKey, folder: match?.[2] === 'f' ? decode(match[3]) : '', q, scope: rootId && url.searchParams.get('scope') !== 'all' ? 'root' : 'all', fmt: url.searchParams.get('fmt') || '', kind: url.searchParams.get('kind') || '', sort: url.searchParams.get('sort') || (q ? 'relevance' : seriesKey ? 'series' : 'updated'), item: url.searchParams.get('item') || '', view: ['original','markdown'].includes(url.searchParams.get('view')) ? url.searchParams.get('view') : 'reader', settings: url.pathname === '/settings/roots' };
}
export function serializeRoute(route) {
  let pathname = route.settings ? '/settings/roots' : route.rootId ? '/r/' + encodeURIComponent(route.rootId) + (route.seriesKey ? '/s/' + encodeURIComponent(route.seriesKey) : route.folder ? '/f/' + route.folder.split('/').map(encodeURIComponent).join('/') : '') : '/';
  const params = new URLSearchParams(); for (const key of ['q','fmt','kind','item']) if (route[key]) params.set(key, route[key]);
  if (route.rootId && route.scope === 'all') params.set('scope','all'); if (route.sort) params.set('sort',route.sort); if (route.view && route.view !== 'reader') params.set('view',route.view);
  return pathname + (params.size ? '?' + params : '');
}
