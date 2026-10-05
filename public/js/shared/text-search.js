const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function normalizeWithMap(text) {
  text = String(text || "");
  let normalized = "";
  const offsets = [];
  for (const { segment, index } of segmenter.segment(text)) {
    const value = segment.normalize("NFKC").toLowerCase();
    normalized += value;
    for (let unit = 0; unit < value.length; unit++)
      offsets.push([index, index + segment.length]);
  }
  return { normalized, offsets };
}
export const normalizeText = (text) =>
  String(text || "")
    .normalize("NFKC")
    .toLowerCase();
export function parseQuery(query = "") {
  const include = [],
    exclude = [],
    pattern = /(-?)(?:"([^"]*)"|([^\s]+))/g;
  for (const match of query.matchAll(pattern)) {
    const term = normalizeText(match[2] ?? match[3]).trim();
    if (term) (match[1] ? exclude : include).push(term);
  }
  return { include: [...new Set(include)], exclude: [...new Set(exclude)] };
}
export function findRanges(text, terms) {
  const direct = normalizeText(text);
  const mapped =
    direct.length === String(text).length &&
    (direct === String(text).toLowerCase() ||
      !/[^\u0000-\u007f\u4e00-\u9fff\u3001\u3002\uff01-\uff5e]/u.test(text))
      ? { normalized: direct, offsets: null }
      : normalizeWithMap(text);
  const { normalized, offsets } = mapped,
    ranges = [];
  for (const term of terms) {
    if (!term) continue;
    for (
      let index = normalized.indexOf(term);
      index >= 0;
      index = normalized.indexOf(term, index + term.length)
    )
      ranges.push(
        offsets
          ? [offsets[index][0], offsets[index + term.length - 1][1]]
          : [index, index + term.length],
      );
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] < last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push(range.slice());
  }
  return merged;
}
export function countMatches(text, terms) {
  const normalized = normalizeText(text);
  let count = 0;
  for (const term of terms)
    for (
      let index = normalized.indexOf(term);
      term && index >= 0;
      index = normalized.indexOf(term, index + term.length)
    )
      count++;
  return count;
}
