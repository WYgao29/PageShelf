import path from "node:path";
import { searchItems, publicItem } from "../search.js";
import { readSafeFile, sourceNotFound } from "../source-files.js";
import { parseHtml } from "../formats/html.js";
import { MHTML_RENDER_VERSION, renderMhtml } from "../formats/mhtml.js";
import { documentIdentity } from "../cache.js";

export const SOURCE_CSP =
  "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline' data:; font-src data:; script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self' pageshelf://app";

const jsonResult = (status, json) => ({ status, json });
const byteResult = (status, body, headers) => ({ status, body, headers });
const formatFor = (source) =>
  source.extension === ".md"
    ? "markdown"
    : [".mhtml", ".mht"].includes(source.extension)
      ? "mhtml"
      : "html";

function imageType(buffer, extension) {
  if (
    extension === ".png" &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    [".jpg", ".jpeg"].includes(extension) &&
    buffer[0] === 255 &&
    buffer[1] === 216 &&
    buffer[2] === 255
  )
    return "image/jpeg";
  if (
    extension === ".gif" &&
    /^GIF8[79]a$/.test(buffer.toString("ascii", 0, 6))
  )
    return "image/gif";
  if (
    extension === ".webp" &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (
    extension === ".avif" &&
    buffer.toString("ascii", 4, 8) === "ftyp" &&
    /avif|avis/.test(buffer.toString("ascii", 8, 32))
  )
    return "image/avif";
  return null;
}

export function requireItem({ library, id }) {
  const item = library.getItem(id);
  if (!item) throw sourceNotFound();
  return item;
}

export function search({ library, query }) {
  return jsonResult(200, searchItems(library.getSnapshot(), query));
}

export async function clearCache({ cache }) {
  return jsonResult(200, await cache.clear());
}

export function getItem({ library, id }) {
  const item = requireItem({ library, id });
  const series =
      item.series &&
      library
        .getSnapshot()
        .series.find((entry) => entry.key === item.series.key),
    position = series?.itemIds.indexOf(id);
  const neighborAt = (index) => {
    const adjacent = series && library.getItem(series.itemIds[index]);
    return adjacent
      ? {
          id: adjacent.id,
          title: adjacent.title,
          index: adjacent.series.index,
        }
      : null;
  };
  return jsonResult(200, {
    item: { ...publicItem(item), headings: item.headings },
    prev: series ? neighborAt(position - 1) : null,
    next: series ? neighborAt(position + 1) : null,
    series: series
      ? { key: series.key, name: series.name, total: series.total }
      : null,
    files: item.sourceFiles.map((source) => ({
      format: formatFor(source),
      path: source.path,
      size: source.size,
      updatedAt: source.updatedAt,
    })),
  });
}

export async function trashItem({ library, cache, id, confirm }) {
  requireItem({ library, id });
  if (confirm !== true)
    throw Object.assign(new Error("请确认移入废纸篓"), {
      code: "CONFIRM_REQUIRED",
      status: 400,
    });
  try {
    const result = await library.trashItem(id);
    return jsonResult(result.failed.length ? 207 : 200, {
      ...result,
      itemId: id,
    });
  } finally {
    await cache.invalidateItem(id);
  }
}

export async function readAsset({ library, registry, id, assetPath }) {
  const item = requireItem({ library, id });
  if (!item.markdown) throw sourceNotFound();
  if (!assetPath || assetPath.includes("\0")) throw sourceNotFound();
  const file = path.resolve(path.dirname(item.markdown.path), assetPath),
    root = registry.get(item.rootId);
  const { buffer } = await readSafeFile(root.realPath, file),
    mime = imageType(buffer, path.extname(file).toLowerCase());
  if (!mime) throw sourceNotFound("仅支持本地图片");
  return byteResult(200, buffer, {
    "content-type": mime,
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
    "content-security-policy": SOURCE_CSP,
  });
}

export async function readItemFile({ library, id, format, action }) {
  requireItem({ library, id });
  const source =
    format === "mhtml" && action === "source"
      ? await library.readMhtmlView(id)
      : await library.readSource(id, format);
  return byteResult(200, action === "download" ? source.buffer : source.content, {
    "content-type": source.contentType,
    "content-disposition":
      (action === "download" ? "attachment" : "inline") +
      "; filename*=UTF-8''" +
      encodeURIComponent(source.fileName),
    "cache-control": "no-store",
    "content-security-policy": SOURCE_CSP,
    "x-content-type-options": "nosniff",
  });
}

export async function readDocument({
  library,
  cache,
  id,
  action,
  ifNoneMatch,
}) {
  const item = requireItem({ library, id });
  const format = item.html ? "html" : item.mhtml ? "mhtml" : "markdown";
  // Always validate and open the current whitelisted source before checking an ETag or cache.
  const source = await library.readSource(id, format),
    key = documentIdentity({
      itemId: id,
      format,
      path: source.path,
      stat: source.stat,
    }) + (format === "mhtml" ? ":mhtml-" + MHTML_RENDER_VERSION : ""),
    etag = '"' + key + '"';
  const headers = {
    "content-type":
      action === "document" || format === "markdown"
        ? "text/plain; charset=utf-8"
        : "text/html; charset=utf-8",
    etag,
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
    "x-source-format": format,
    "x-site-rule": item.site || "",
  };
  if (action === "original") headers["content-security-policy"] = SOURCE_CSP;
  if (ifNoneMatch === etag) return byteResult(304, undefined, headers);
  const content =
    format === "markdown"
      ? source.content
      : await cache.getOrCreate(
          key,
          () =>
            format === "mhtml"
              ? renderMhtml(source.buffer)
              : parseHtml(source.buffer).html,
          { itemId: id },
        );
  return byteResult(200, content, headers);
}
