import { performance } from "node:perf_hooks";
import {
  countMatches,
  findRanges,
  normalizeText,
  parseQuery,
} from "../shared/text-search.js";
export function publicItem(item) {
  const source = (format) =>
    item[format]
      ? {
          extension: item[format].extension,
          filename: item[format].filename,
          size: item[format].size,
          updatedAt: item[format].updatedAt,
        }
      : null;
  const html = source("html"),
    mhtml = source("mhtml"),
    markdown = source("markdown");
  return {
    id: item.id,
    title: item.title,
    titleRaw: item.titleRaw || item.title,
    rootId: item.rootId,
    rootLabel: item.rootLabel,
    relativePath: item.relativePath,
    directory: item.directory,
    formats: { html, mhtml, markdown },
    html,
    mhtml,
    markdown,
    updatedAt: item.updatedAt,
    size: item.size,
    series: item.series || null,
    site: item.site || null,
    author: item.author || null,
    publishedAt: item.publishedAt || null,
    excerpt: item.excerpt || "",
    snippet: item.snippet || item.excerpt || "",
    readingMinutes: item.readingMinutes || 1,
    tags: item.tags || [],
  };
}
function snippet(text, terms) {
  const ranges = findRanges(text, terms);
  if (!ranges.length) return null;
  const first = ranges[0][0],
    units = [...text],
    starts = [];
  let position = 0;
  for (const unit of units) {
    starts.push(position);
    position += unit.length;
  }
  starts.push(position);
  const matchedUnit = starts.findIndex((start) => start >= first);
  let beginning = Math.max(0, matchedUnit - 25);
  for (let index = matchedUnit - 1; index >= beginning; index--)
    if (/[，。：；！？\s]/u.test(units[index])) {
      beginning = index + 1;
      break;
    }
  const start = starts[beginning],
    end = starts[Math.min(units.length, matchedUnit + 60)],
    sliced = text.slice(start, end);
  return {
    field: "body",
    text: sliced,
    ranges: ranges
      .filter((range) => range[0] >= start && range[1] <= end)
      .map((range) => [range[0] - start, range[1] - start]),
  };
}
const enumCheck = (value, allowed) => {
  if (value && !allowed.includes(value))
    throw Object.assign(new Error("筛选或排序参数无效"), {
      code: "INVALID_FILTER",
    });
};
export function searchItems(snapshot, query = {}, { now = Date.now() } = {}) {
  const started = performance.now(),
    q = query.q || "",
    terms = parseQuery(q);
  enumCheck(query.sort, ["relevance", "updated", "title", "series"]);
  enumCheck(query.fmt, ["html", "mhtml", "markdown"]);
  enumCheck(query.kind, ["series", "single"]);
  const roots =
      typeof query.roots === "string"
        ? query.roots.split(",").filter(Boolean)
        : query.roots || [],
    limit = Math.min(500, Math.max(1, Math.trunc(Number(query.limit) || 100))),
    offset = Math.max(0, Math.trunc(Number(query.offset) || 0));
  const sort =
    query.sort || (q ? "relevance" : query.series ? "series" : "updated");
  let entries = [];
  for (const item of snapshot.items) {
    if (
      (roots.length && !roots.includes(item.rootId)) ||
      (query.series && item.series?.key !== query.series) ||
      (query.folder &&
        !(
          item.directory === query.folder ||
          item.directory?.startsWith(query.folder + "/")
        )) ||
      (query.fmt &&
        !(query.fmt === "html" ? item.html || item.mhtml : item[query.fmt])) ||
      (query.kind === "series" && !item.series) ||
      (query.kind === "single" && item.series)
    )
      continue;
    const fields = [
        item.title,
        item.series?.name,
        (item.tags || []).join(" "),
        item.relativePath,
        item.searchText,
      ].map((value) => value || ""),
      normalized = fields.map(normalizeText);
    if (
      !terms.include.every((term) =>
        normalized.some((field) => field.includes(term)),
      ) ||
      terms.exclude.some((term) =>
        normalized.some((field) => field.includes(term)),
      )
    )
      continue;
    const hits = countMatches(fields[4], terms.include),
      age = Math.max(0, (now - Date.parse(item.updatedAt)) / 86400000);
    let score =
      10 * Math.min(3, countMatches(fields[0], terms.include)) +
      6 * countMatches(fields[1], terms.include) +
      5 * countMatches(fields[2], terms.include) +
      3 * countMatches(fields[3], terms.include) +
      Math.min(10, hits) +
      2 * Math.exp(-age / 90);
    if (normalizeText(q.trim()) === normalized[0] && terms.include.length)
      score += 15;
    const highlights = [];
    if (terms.include.length) {
      const ranges = findRanges(item.title, terms.include);
      if (ranges.length)
        highlights.push({ field: "title", text: item.title, ranges });
      const body = hits ? snippet(fields[4], terms.include) : null;
      if (body) highlights.push(body);
    }
    entries.push({ item, score, hits, highlights });
  }
  const stable = (a, b) =>
    b.item.updatedAt.localeCompare(a.item.updatedAt) ||
    a.item.id.localeCompare(b.item.id);
  const grouped =
    (sort === "series" || query.series || (sort === "relevance" && q)) &&
    !["updated", "title"].includes(sort);
  let groups = [];
  if (grouped) {
    const clusters = new Map();
    for (const entry of entries) {
      const key =
        entry.item.rootId + ":" + (entry.item.series?.key || "single");
      const cluster = clusters.get(key) || {
        rootId: entry.item.rootId,
        rootOrder: entry.item.rootOrder || 0,
        seriesKey: entry.item.series?.key || null,
        label:
          entry.item.rootLabel +
          (entry.item.series
            ? " › " + entry.item.series.name
            : sort === "series"
              ? " › 其他"
              : ""),
        kind: entry.item.series ? "series" : "root",
        score: -Infinity,
        entries: [],
      };
      cluster.entries.push(entry);
      cluster.score = Math.max(cluster.score, entry.score);
      clusters.set(key, cluster);
    }
    groups = [...clusters.values()].sort(
      (a, b) =>
        a.rootOrder - b.rootOrder ||
        (sort === "series"
          ? Number(!a.seriesKey) - Number(!b.seriesKey) ||
            a.label.localeCompare(b.label, "zh-CN", { numeric: true })
          : b.score - a.score),
    );
    groups.forEach((group) =>
      group.entries.sort((a, b) =>
        a.item.series
          ? a.item.series.index - b.item.series.index ||
            a.item.relativePath.localeCompare(b.item.relativePath, "zh-CN", {
              numeric: true,
            })
          : b.score - a.score || stable(a, b),
      ),
    );
    entries = groups.flatMap((group) => group.entries);
  } else
    entries.sort((a, b) =>
      sort === "title"
        ? a.item.title.localeCompare(b.item.title, "zh-CN", {
            numeric: true,
          }) || stable(a, b)
        : sort === "relevance" && q
          ? b.score - a.score || stable(a, b)
          : stable(a, b),
    );
  const page = entries.slice(offset, offset + limit),
    pageIds = new Set(page.map((entry) => entry.item.id));
  return {
    total: entries.length,
    tookMs: Math.round((performance.now() - started) * 100) / 100,
    roots: new Set(entries.map((entry) => entry.item.rootId)).size,
    items: page.map((entry) => ({
      ...publicItem(entry.item),
      score: entry.score,
      hits: entry.hits,
      highlights: entry.highlights,
    })),
    groups: groups
      .map((group) => ({
        kind: group.kind,
        rootId: group.rootId,
        seriesKey: group.seriesKey,
        label: group.label,
        itemIds: group.entries
          .map((entry) => entry.item.id)
          .filter((id) => pageIds.has(id)),
      }))
      .filter((group) => group.itemIds.length),
  };
}
