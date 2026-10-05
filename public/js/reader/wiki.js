function logicalPath(value) { const output = []; for (const part of value.replace(/\\/g, '/').split('/')) { if (!part || part === '.') continue; if (part === '..') { if (!output.length) return null; output.pop(); } else output.push(part); } return output.join('/').normalize('NFC').replace(/\.md$/i, ''); }
export function resolveWikilink(target, item, items = []) {
  const clean = target.trim().replace(/\.md$/i, ''), folder = item.relativePath.includes('/') ? item.relativePath.slice(0, item.relativePath.lastIndexOf('/')) : '';
  const path = logicalPath(folder + '/' + clean), rootPath = logicalPath(clean), candidates = items.filter(value => value.rootId === item.rootId);
  if (!path) return { status: 'missing' };
  const exact = candidates.filter(value => value.relativePath.normalize('NFC') === path); if (exact.length === 1) return { status: 'resolved', item: exact[0] };
  const rootMatches = candidates.filter(value => value.relativePath.normalize('NFC') === rootPath || value.relativePath.split('/').at(-1).normalize('NFC') === clean.normalize('NFC'));
  return rootMatches.length === 1 ? { status: 'resolved', item: rootMatches[0] } : { status: rootMatches.length > 1 ? 'ambiguous' : 'missing' };
}
