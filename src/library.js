import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { createRootRegistry, listSourceFiles, rootAvailable, contains } from "./roots.js";
import { createScheduler } from "./scheduler.js";
import { readSafeFile, validateSourceFile } from "./source-files.js";
import { createTrashService } from "./trash.js";
const SUPPORTED_EXTENSIONS = new Set([".html", ".htm", ".mhtml", ".mht", ".md"]);
const FORMAT_EXTENSIONS = {
  html: new Set([".html", ".htm"]),
  mhtml: new Set([".mhtml", ".mht"]),
  markdown: new Set([".md"]),
};

function createId(value) {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function normalizeRoot(root) {
  if (!root || typeof root !== "object" || typeof root.path !== "string" || !root.path.trim()) {
    throw Object.assign(new Error("配置中的扫描目录无效"), { code: "ROOT_CONFIG_INVALID" });
  }
  const resolvedPath = path.resolve(root.path.trim());
  return {
    id: typeof root.id === "string" && root.id.trim() ? root.id : "root-" + createId(resolvedPath),
    path: resolvedPath,
    label: typeof root.label === "string" && root.label.trim() ? root.label : path.basename(resolvedPath),
    addedAt: typeof root.addedAt === "string" && root.addedAt ? root.addedAt : new Date().toISOString(),
  };
}

function sourceNotFound(message = "源文件不存在") {
  return Object.assign(new Error(message), { code: "SOURCE_NOT_FOUND" });
}

function chooseSource(existing, candidate) {
  if (existing.extension === candidate.extension) {
    return existing.filename.localeCompare(candidate.filename) <= 0 ? existing : candidate;
  }
  const priority = { ".html": 3, ".htm": 2, ".mhtml": 3, ".mht": 2 };
  return (priority[existing.extension] || 0) >= (priority[candidate.extension] || 0)
    ? existing
    : candidate;
}

function isMhtmlExtension(extension) {
  return extension === ".mhtml" || extension === ".mht";
}

function parseMimeHeaders(value) {
  const headers = {};
  let currentName = "";
  for (const line of value.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^[ \t]/.test(line) && currentName) {
      headers[currentName] += " " + line.trim();
      continue;
    }
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    currentName = line.slice(0, separator).trim().toLowerCase();
    headers[currentName] = line.slice(separator + 1).trim();
  }
  return headers;
}

function decodeMhtmlPart(value, transferEncoding = "") {
  const encoding = transferEncoding.toLowerCase();
  if (encoding === "base64") {
    return Buffer.from(value.replace(/\s/g, ""), "base64").toString("utf8");
  }
  if (encoding === "quoted-printable") {
    if (!/=([0-9a-f]{2})|=\r?\n/i.test(value)) return value;
    const binary = value
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
    return Buffer.from(binary, "latin1").toString("utf8");
  }
  return value;
}

function decodeMhtmlPartBuffer(value, transferEncoding = "") {
  const encoding = transferEncoding.toLowerCase();
  if (encoding === "base64") {
    return Buffer.from(value.replace(/\s/g, ""), "base64");
  }
  if (encoding === "quoted-printable") {
    const binary = value
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
    return Buffer.from(binary, "latin1");
  }
  return Buffer.from(value, "latin1");
}

function extractMhtmlHtml(content) {
  const normalized = content.replace(/\r\n?/g, "\n");
  const headerEnd = normalized.indexOf("\n\n");
  if (headerEnd < 0) return content;
  const headers = parseMimeHeaders(normalized.slice(0, headerEnd));
  const boundaryMatch = headers["content-type"]?.match(/boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i);
  if (!boundaryMatch) return content;
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  for (const part of normalized.slice(headerEnd + 2).split("--" + boundary)) {
    if (!part.trim() || part.trim() === "--") continue;
    const partHeaderEnd = part.indexOf("\n\n");
    if (partHeaderEnd < 0) continue;
    const partHeaders = parseMimeHeaders(part.slice(0, partHeaderEnd));
    if (/^text\/html\b/i.test(partHeaders["content-type"] || "")) {
      return decodeMhtmlPart(part.slice(partHeaderEnd + 2).replace(/\n--?\s*$/g, ""), partHeaders["content-transfer-encoding"]);
    }
  }
  return content;
}

function mhtmlContentType(content) {
  const text = (Buffer.isBuffer(content) ? content.toString("latin1", 0, 64 * 1024) : content).replace(/\r\n?/g, "\n");
  const headerEnd = text.indexOf("\n\n");
  if (headerEnd < 0) return "multipart/related";
  const contentType = parseMimeHeaders(text.slice(0, headerEnd))["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary || /[\r\n"]/.test(boundary)) return "multipart/related";
  return 'multipart/related; type="text/html"; boundary="' + boundary + '"';
}

function parseMhtmlArchive(content) {
  const raw = Buffer.isBuffer(content) ? content.toString("latin1") : content;
  const normalized = raw.replace(/\r\n?/g, "\n");
  const headerEnd = normalized.indexOf("\n\n");
  if (headerEnd < 0) return { headers: {}, parts: [] };
  const headers = parseMimeHeaders(normalized.slice(0, headerEnd));
  const boundaryMatch = headers["content-type"]?.match(/boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i);
  if (!boundaryMatch) return { headers, parts: [] };
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const parts = [];
  for (const part of normalized.slice(headerEnd + 2).split("--" + boundary)) {
    if (!part.trim() || part.trim() === "--") continue;
    const partHeaderEnd = part.indexOf("\n\n");
    if (partHeaderEnd < 0) continue;
    const partHeaders = parseMimeHeaders(part.slice(0, partHeaderEnd));
    let body = part.slice(partHeaderEnd + 2);
    body = body.replace(/\n$/, "");
    parts.push({ headers: partHeaders, body: decodeMhtmlPartBuffer(body, partHeaders["content-transfer-encoding"]) });
  }
  return { headers, parts };
}

function resourceKey(value, baseLocation = "") {
  if (!value) return "";
  const trimmed = value.trim();
  if (/^cid:/i.test(trimmed)) return "cid:" + trimmed.slice(4).replace(/^<|>$/g, "").toLowerCase();
  try {
    return new URL(trimmed, baseLocation || undefined).href;
  } catch {
    return trimmed;
  }
}

function rewriteCssResources(value, baseLocation, resources) {
  return value.replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi, (match, quote, reference) => {
    const replacement = resources.get(resourceKey(reference, baseLocation));
    return replacement ? "url(\"" + replacement + "\")" : match;
  });
}

function renderMhtml(content) {
  const archive = parseMhtmlArchive(content);
  const htmlPart = archive.parts.find((part) => /^text\/html\b/i.test(part.headers["content-type"] || ""));
  if (!htmlPart) return Buffer.isBuffer(content) ? content.toString("utf8") : content;
  const htmlLocation = htmlPart.headers["content-location"] || "";
  const resources = new Map();
  for (const part of archive.parts) {
    if (part === htmlPart) continue;
    const contentType = (part.headers["content-type"] || "application/octet-stream").split(";", 1)[0].trim();
    const dataUri = "data:" + contentType + ";base64," + part.body.toString("base64");
    const location = part.headers["content-location"];
    const contentId = part.headers["content-id"];
    if (location) resources.set(resourceKey(location, htmlLocation), dataUri);
    if (contentId) resources.set(resourceKey("cid:" + contentId, htmlLocation), dataUri);
  }
  let html = htmlPart.body.toString("utf8");
  html = html.replace(/<base\b[^>]*>/gi, "");
  html = html.replace(/(\b(?:src|href|poster|background)\s*=\s*)(["'])([^"']+)\2/gi, (match, prefix, quote, reference) => {
    const replacement = resources.get(resourceKey(reference, htmlLocation));
    return replacement ? prefix + quote + replacement + quote : match;
  });
  html = html.replace(/(\bstyle\s*=\s*)(["'])([\s\S]*?)\2/gi, (match, prefix, quote, style) => prefix + quote + rewriteCssResources(style, htmlLocation, resources) + quote);
  html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (match, open, style, close) => open + rewriteCssResources(style, htmlLocation, resources) + close);
  return html;
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripHtml(value) {
  return decodeEntities(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function markdownText(value) {
  return value
    .replace(/\x60\x60\x60[\s\S]*?\x60\x60\x60/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_\x60~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(extension, content, fallback) {
  if (extension === ".md") {
    const heading = content.match(/^\s{0,3}#\s+(.+?)\s*$/m);
    return heading?.[1].replace(/[*_\x60]/g, "").trim() || fallback;
  }

  const htmlContent = isMhtmlExtension(extension) ? extractMhtmlHtml(content) : content;
  const title = htmlContent.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (title?.[1]) return stripHtml(title[1]);
  const heading = htmlContent.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return heading?.[1] ? stripHtml(heading[1]) : fallback;
}

function relativeStem(rootPath, filePath) {
  const relative = path.relative(rootPath, filePath);
  const extension = path.extname(relative);
  return relative.slice(0, -extension.length).split(path.sep).join("/");
}

function isInsideRoot(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
}

async function walkDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDirectory(entryPath)));
    } else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(entryPath);
    }
  }
  return files;
}

function publicSource(source) {
  if (!source) return null;
  return {
    extension: source.extension,
    filename: source.filename,
    size: source.size,
    updatedAt: source.updatedAt,
  };
}

function publicItem(item) {
  return {
    id: item.id,
    title: item.title,
    relativePath: item.relativePath,
    directory: item.directory,
    rootId: item.rootId,
    rootLabel: item.rootLabel,
    html: publicSource(item.html),
    mhtml: publicSource(item.mhtml),
    markdown: publicSource(item.markdown),
    updatedAt: item.updatedAt,
    size: item.size,
    snippet: item.snippet,
  };
}

export function createLibrary({ roots = [], rootRegistry, scanFile, trashService = createTrashService() } = {}) {
  let memoryConfig = { version: 2, roots: roots.map((root, order) => ({ ...normalizeRoot(root), ...root, order, enabled: root.enabled !== false, options: { series: 'auto', ...root.options } })) };
  const registry = rootRegistry || createRootRegistry({ configStore: { load: async () => ({ config: structuredClone(memoryConfig), legacyRootIds: [] }), update: async mutator => { const draft = structuredClone(memoryConfig); memoryConfig = mutator(draft) || draft; return { config: structuredClone(memoryConfig), legacyRootIds: [] }; } } });
  const initialized = rootRegistry ? Promise.resolve() : registry.load();
  const indexes = new Map();
  let lastScan = { completedAt: null, durationMs: 0, stats: { roots: 0, files: 0, items: 0 }, errors: [] };
  async function defaultScanFile(file, { rootPath }) {
    const { buffer } = await readSafeFile(rootPath, file), extension = path.extname(file).toLowerCase(), content = buffer.toString('utf8');
    return { title: extractTitle(extension, content, path.basename(file, extension)), bodyText: extension === '.md' ? markdownText(content) : stripHtml(isMhtmlExtension(extension) ? renderMhtml(buffer) : content) };
  }
  async function scanRoot(rootId, options = {}) {
    await initialized;
    const affected = await registry.refresh(rootId);
    for (const entry of affected) if (entry.rootId !== rootId) scheduler.enqueue(entry.rootId, entry);
    const root = registry.get(rootId);
    if (!root || !rootAvailable(root)) { indexes.delete(rootId); return; }
    const revision = registry.revision(rootId), started = Date.now(), issues = [];
    registry.setIndexState(rootId, { state: 'scanning' });
    const previous = indexes.get(rootId), subtrees = options.subtrees?.length ? options.subtrees : options.subtree ? [options.subtree] : [];
    let files;
    if (!options.full && previous && subtrees.length) {
      const ranges = subtrees.map(subtree => path.resolve(root.realPath, subtree)).filter(subtree => contains(root.realPath, subtree));
      files = [...previous.filesMap.keys()].filter(file => !ranges.some(subtree => contains(subtree, file)) && !root.excludes.some(exclude => contains(exclude, file)));
      for (const subtree of ranges) files.push(...await listSourceFiles(subtree, { excludes: root.excludes, issues }));
      files = [...new Set(files)];
    } else files = await listSourceFiles(root.realPath, { excludes: root.excludes, issues });
    const nfcChanges = files.some(file => { const stem = relativeStem(root.realPath, file); return stem !== stem.normalize('NFC'); });
    const idAlgo = registry.resolveIdAlgorithm(rootId, { nfcChanges });
    const filesMap = new Map(), groups = new Map();
    options.onProgress?.({ done: 0, total: files.length });
    let done = 0;
    for (const file of files) {
      try {
        const { stat: info } = await validateSourceFile(root.realPath, file), old = previous?.filesMap.get(file);
        const signature = [info.size, info.mtimeMs, info.ino, info.dev].join(':');
        const extracted = !options.full && old?.signature === signature ? old : await (scanFile || defaultScanFile)(file, { rootPath: root.realPath });
        const extension = path.extname(file).toLowerCase(), source = { ...extracted, signature, path: file, extension, filename: path.basename(file), size: info.size, ino: info.ino, dev: info.dev, mtimeMs: info.mtimeMs, updatedAt: info.mtime.toISOString() };
        // Raw input is never retained in a published index, including injected parsers.
        delete source.content; delete source.buffer;
        filesMap.set(file, source);
        const rawStem = relativeStem(root.realPath, file), stem = idAlgo === 'v1' ? rawStem : rawStem.normalize('NFC');
        const group = groups.get(stem) || { files: [] }, format = extension === '.md' ? 'markdown' : isMhtmlExtension(extension) ? 'mhtml' : 'html';
        group.files.push(source);
        if (group[format]) { group[format] = chooseSource(group[format], source); issues.push({ rootId, path: file, message: `发现重复 ${format} 文件，已保留 ${group[format].filename}` }); }
        else group[format] = source;
        groups.set(stem, group);
      } catch (error) { issues.push({ rootId, path: file, code: error.code, message: error.message }); }
      options.onProgress?.({ done: ++done, total: files.length });
    }
    const itemsMap = new Map();
    for (const [relativePath, group] of groups) {
      const preferred = group.html || group.mhtml || group.markdown, title = preferred.title || path.basename(relativePath), bodyText = group.files.map(source => source.bodyText).filter(Boolean).join(' '), id = rootId + ':' + createId(relativePath);
      itemsMap.set(id, { id, title, titleRaw: title, relativePath, directory: path.dirname(relativePath) === '.' ? '/' : path.dirname(relativePath).split(path.sep).join('/'), rootId, rootLabel: root.label, rootOrder: root.order,
        html: group.html || null, mhtml: group.mhtml || null, markdown: group.markdown || null, sourceFiles: group.files, formats: ['html', 'mhtml', 'markdown'].filter(format => group[format]),
        updatedAt: group.files.map(source => source.updatedAt).sort().at(-1), size: group.files.reduce((total, source) => total + source.size, 0), snippet: bodyText.slice(0, 220), excerpt: [...bodyText].slice(0, 120).join(''), searchText: bodyText, tags: [], headings: [], readingMinutes: Math.max(1, Math.ceil([...bodyText].length / 500)), series: null });
    }
    if (registry.revision(rootId) !== revision || !registry.get(rootId)) { if (registry.get(rootId)) scheduler.enqueue(rootId, {}); return; }
    indexes.set(rootId, { itemsMap, filesMap, seriesMap: new Map(), state: issues.length ? 'warning' : 'ok' });
    registry.setIndexState(rootId, { state: issues.length ? 'warning' : 'ok', issues, counts: { items: itemsMap.size, files: filesMap.size, series: 0 }, lastScan: { completedAt: new Date().toISOString(), durationMs: Date.now() - started } });
    const snapshot = getSnapshot();
    lastScan = { completedAt: new Date().toISOString(), durationMs: Date.now() - started, stats: { roots: registry.list().length, files: snapshot.fileCount, items: snapshot.items.length }, errors: registry.list().flatMap(root => root.issues || []) };
    return snapshot;
  }
  const scheduler = createScheduler({ scanRoot, concurrency: 2 });
  function getSnapshot() {
    const visible = registry.list().filter(rootAvailable), items = visible.flatMap(root => [...(indexes.get(root.id)?.itemsMap.values() || [])].map(item => ({ ...item, rootLabel: root.label, rootOrder: root.order }))), series = visible.flatMap(root => [...(indexes.get(root.id)?.seriesMap.values() || [])]);
    return { items, series, roots: registry.list(), fileCount: visible.reduce((total, root) => total + (indexes.get(root.id)?.filesMap.size || 0), 0) };
  }
  async function scan(options = {}) { await initialized; registry.list().forEach(root => scheduler.enqueue(root.id, options)); await scheduler.waitForIdle(); return { items: getSnapshot().items.map(publicItem), stats: lastScan.stats, errors: lastScan.errors }; }
  function search(query = '', filters = {}) {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return getSnapshot().items.filter(item => (!filters.rootId || item.rootId === filters.rootId) && (!filters.format || (filters.format === 'html' ? item.html || item.mhtml : item[filters.format])) && terms.every(term => [item.title, item.relativePath, item.rootLabel, item.searchText].join(' ').toLowerCase().includes(term))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(publicItem);
  }
  function getItem(id) { return getSnapshot().items.find(item => item.id === id) || null; }
  async function addRoot(rootPath, label) { await initialized; return (await registry.applyChange({ type: 'add', input: { path: rootPath, label } })).root; }
  async function removeRoot(id) { await initialized; if (!registry.get(id)) return false; await registry.applyChange({ type: 'remove', id }); indexes.delete(id); return true; }
  async function trashItem(id) {
    const item = getItem(id), root = item && registry.get(item.rootId); if (!item || !root) throw sourceNotFound();
    if (registry.getConfigLoad()?.readOnly) throw Object.assign(new Error('只读配置无法删除源文件'), { code: 'CONFIG_READ_ONLY' });
    for (const source of item.sourceFiles) await validateSourceFile(root.realPath, source.path);
    registry.invalidate(root.id);
    let result;
    try { result = await trashService.trashFiles({ rootPath: root.realPath, paths: item.sourceFiles.map(source => source.path) }); }
    finally { registry.invalidate(root.id); }
    const index = indexes.get(root.id);
    if (!result.failed.length) { index?.itemsMap.delete(id); for (const source of item.sourceFiles) index?.filesMap.delete(source.path); registry.setIndexState(root.id, { counts: { ...root.counts, items: index?.itemsMap.size || 0, files: index?.filesMap.size || 0 } }); }
    else { await scanRoot(root.id); }
    return result;
  }
  async function deleteItem(id) { const item = getItem(id); if (!item) throw sourceNotFound(); return { ...publicItem(item), trashResult: await trashItem(id) }; }
  async function readSource(id, format, requestedRelativePath) {
    const item = getItem(id); if (!item || !Object.hasOwn(FORMAT_EXTENSIONS, format) || !item[format]) throw sourceNotFound();
    const root = registry.get(item.rootId), source = item[format];
    if (requestedRelativePath && path.resolve(root.realPath, requestedRelativePath) !== source.path) throw sourceNotFound('源文件路径无效');
    const { buffer, stat: info, path: canonical } = await readSafeFile(root.realPath, source.path);
    return { content: format === 'mhtml' ? buffer : buffer.toString('utf8'), buffer, stat: info, path: canonical, contentType: format === 'html' ? 'text/html; charset=utf-8' : format === 'mhtml' ? mhtmlContentType(buffer) : 'text/plain; charset=utf-8', fileName: source.filename };
  }
  async function readMhtmlView(id) { const source = await readSource(id, 'mhtml'); return { ...source, content: renderMhtml(source.buffer), contentType: 'text/html; charset=utf-8', fileName: source.fileName.replace(/\.(?:mhtml|mht)$/i, '.html') }; }
  return { scan, scanRoot, scheduler, registry, getSnapshot, search, getItem, addRoot, removeRoot, deleteItem, trashItem, readSource, readMhtmlView, getSettings: () => ({ roots: registry.list(), lastScan }), invalidateRoot: id => registry.invalidate(id), refreshItem: async id => { const item = getItem(id); if (item) await scanRoot(item.rootId); return getItem(id); } };
}
