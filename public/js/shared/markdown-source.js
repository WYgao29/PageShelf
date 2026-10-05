function scalar(value) { const text = value.trim(); return /^(["']).*\1$/.test(text) ? text.slice(1, -1) : text; }
export function parseMarkdownSource(source) {
  const original = String(source).replace(/^\uFEFF/, ''), opening = original.match(/^---[ \t]*\r?\n/);
  const empty = { frontMatter: {}, body: original, tags: [], title: '', issues: [] };
  if (!opening) return empty;
  const end = /^---[ \t]*\r?$/gm; end.lastIndex = opening[0].length; const closing = end.exec(original);
  if (!closing) return empty;
  const metadata = original.slice(opening[0].length, closing.index), frontMatter = {}; let arrayKey;
  for (const line of metadata.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const entry = line.match(/^([\w-]+):\s*(.*)$/), list = line.match(/^\s+-\s+(.+)$/);
    if (list && arrayKey) { frontMatter[arrayKey].push(scalar(list[1])); continue; }
    if (!entry) return { ...empty, issues: ['不支持的 front-matter 结构，已保留原文'] };
    const [, key, raw] = entry; arrayKey = undefined;
    if (!raw) { frontMatter[key] = []; arrayKey = key; }
    else if (/^\[.*\]$/.test(raw)) frontMatter[key] = raw.slice(1, -1).split(',').map(scalar).filter(Boolean);
    else if (/^[{|>&*!]/.test(raw)) return { ...empty, issues: ['不支持的 front-matter 结构，已保留原文'] };
    else frontMatter[key] = scalar(raw);
  }
  const body = original.slice(closing.index + closing[0].length).replace(/^\r?\n/, '');
  return { frontMatter, body, title: typeof frontMatter.title === 'string' ? frontMatter.title : '', tags: Array.isArray(frontMatter.tags) ? frontMatter.tags : typeof frontMatter.tags === 'string' ? [frontMatter.tags] : [], issues: [] };
}
