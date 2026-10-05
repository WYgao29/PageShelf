import { createHash } from "node:crypto";
import path from "node:path";
import {
  findElement,
  findElements,
  stripElements,
  stripHtml,
} from "./html-scan.js";
import { SITE_RULES, matchSite } from "../public/js/shared/site-rules.js";
import { markdownText } from "./formats/markdown.js";
export function seriesParts(stem) {
  const name = path.posix.basename(stem),
    folder = path.posix.dirname(stem);
  let match = name.match(/^(.+?)[_\s]+(\d{1,3})[_\s.-]+(.+)$/);
  if (match)
    return { name: match[1], index: Number(match[2]), title: match[3], folder };
  match = name.match(/^(\d{1,3})[_\s.-]+(.+)$/);
  return match
    ? {
        name: folder !== "." ? path.posix.basename(folder) : null,
        index: Number(match[1]),
        title: match[2],
        folder,
      }
    : null;
}
export function extractCandidates({
  html = "",
  markdown,
  filename = "",
  format,
}) {
  const candidates = [],
    title = findElement(html, { tag: "title" })?.text || "";
  const site = matchSite({
    title,
    exists: (selector) => !!findElement(html, selector),
  });
  let contentHtml = html;
  for (const selector of site?.content || []) {
    const selected = findElement(html, selector);
    if (selected) {
      contentHtml = selected.innerHTML;
      break;
    }
  }
  for (const selector of site?.titleInContent || []) {
    const selected = findElement(contentHtml, selector);
    if (selected?.text) {
      candidates.push({ priority: 3, text: selected.text });
      break;
    }
  }
  if (markdown?.title) candidates.push({ priority: 1, text: markdown.title });
  const mdHeading = markdown?.body?.match(/^ {0,3}#\s+(.+?)\s*#*$/m)?.[1];
  if (mdHeading)
    candidates.push({ priority: 2, text: mdHeading.replace(/[*_`]/g, "") });
  for (const selector of site?.title || []) {
    const selected = findElement(html, selector);
    if (selected?.text) {
      candidates.push({ priority: 3, text: selected.text });
      break;
    }
  }
  if (title) candidates.push({ priority: 4, text: title, generic: true });
  const fromFilename = seriesParts(filename);
  if (fromFilename) candidates.push({ priority: 5, text: fromFilename.title });
  const h1 = findElement(html, { tag: "h1" });
  if (h1?.text) candidates.push({ priority: 6, text: h1.text });
  candidates.push({ priority: 7, text: filename });
  let body = contentHtml;
  body = stripElements(body, [
    { tag: "head" },
    { tag: "nav" },
    { tag: "aside" },
    { tag: "footer" },
    ...(site?.strip || []),
  ]);
  const bodyText = markdown ? markdownText(markdown.body) : stripHtml(body);
  const authorMatch = site?.author?.textPattern
    ? stripHtml(html).match(new RegExp(site.author.textPattern))
    : null;
  const headings = markdown
    ? [...markdown.body.matchAll(/^ {0,3}(#{2,3})\s+(.+)$/gm)].map((match) => ({
        level: match[1].length,
        text: match[2],
      }))
    : [
        ...findElements(body, { tag: "h2" }),
        ...findElements(body, { tag: "h3" }),
      ]
        .sort((a, b) => a.start - b.start)
        .map((element) => ({
          level: Number(body[element.start + 2]),
          text: element.text,
        }));
  return {
    candidates,
    bodyText,
    site: site?.id || (markdown ? "markdown" : null),
    author: authorMatch?.[1]?.trim() || null,
    publishedAt:
      authorMatch?.[2]?.replace(/年|月/g, "-").replace("日", "") ||
      markdown?.frontMatter?.date ||
      null,
    tags: markdown?.tags || [],
    headings,
    title:
      candidates.sort((a, b) => a.priority - b.priority)[0]?.text || filename,
  };
}
function cleanTitle(value) {
  let title = value
    .replace(/^[\s\p{Extended_Pictographic}\uFE0F\u200D]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
  for (const suffix of SITE_RULES.flatMap((rule) => [
    ...(rule.titleSuffix || []),
    ...(rule.name ? [rule.name] : []),
  ])) {
    if (title.endsWith(suffix))
      title = title
        .slice(0, -suffix.length)
        .replace(/\s*[-|｜]\s*$/, "")
        .trim();
  }
  return [...title].slice(0, 120).join("");
}
export function finalizeRootMetadata(
  input,
  { rootId, seriesMode = "auto" } = {},
) {
  const items = new Map(input),
    repeats = new Map(),
    series = new Map(),
    clusters = new Map();
  for (const item of items.values()) {
    for (const candidate of item.candidates || [])
      if (candidate.priority === 4) {
        const key =
          (item.directory || path.posix.dirname(item.relativePath)) +
          "\n" +
          candidate.text;
        const ids = repeats.get(key) || new Set();
        ids.add(item.id);
        repeats.set(key, ids);
      }
  }
  for (const [id, original] of items) {
    const folder = path.posix.dirname(original.relativePath),
      candidates = original.candidates || [
        {
          priority: 7,
          text: original.title || path.posix.basename(original.relativePath),
        },
      ];
    const selected =
      candidates.find(
        (candidate) =>
          candidate.priority !== 4 ||
          (repeats.get((original.directory || folder) + "\n" + candidate.text)
            ?.size || 0) < 3,
      ) || candidates.at(-1);
    const titleRaw =
        selected?.text || path.posix.basename(original.relativePath),
      title =
        cleanTitle(titleRaw) || path.posix.basename(original.relativePath);
    let body = original.bodyText || original.searchText || "";
    if (body.startsWith(title)) body = body.slice(title.length).trim();
    if (original.author && body.startsWith(original.author))
      body = body.slice(original.author.length).trim();
    const item = {
      ...original,
      title,
      titleRaw,
      excerpt: [...body].slice(0, 120).join(""),
      snippet: [...body].slice(0, 220).join(""),
      searchText: original.searchText || body,
      readingMinutes: Math.max(1, Math.ceil([...body].length / 500)),
      series: null,
    };
    items.set(id, item);
    const parts = seriesParts(item.relativePath);
    if (seriesMode === "off" || !parts?.name) continue;
    const key = createHash("sha1")
      .update((rootId || item.rootId) + "\n" + parts.folder + "\n" + parts.name)
      .digest("hex")
      .slice(0, 10);
    const cluster = clusters.get(key) || {
      key,
      name: parts.name,
      rootId: rootId || item.rootId,
      folder: parts.folder,
      entries: [],
    };
    cluster.entries.push({ item, parts });
    clusters.set(key, cluster);
  }
  for (const cluster of clusters.values()) {
    if (cluster.entries.length < 2) continue;
    cluster.entries.sort(
      (a, b) =>
        a.parts.index - b.parts.index ||
        a.item.relativePath.localeCompare(b.item.relativePath, "zh-CN", {
          numeric: true,
        }),
    );
    const entry = {
      key: cluster.key,
      name: cluster.name,
      rootId: cluster.rootId,
      folder: cluster.folder,
      total: cluster.entries.length,
      itemIds: cluster.entries.map((x) => x.item.id),
    };
    series.set(entry.key, entry);
    cluster.entries.forEach((value, position) => {
      value.item.series = {
        key: entry.key,
        name: entry.name,
        index: value.parts.index,
        position: position + 1,
        total: entry.total,
      };
    });
  }
  return { items, series };
}
