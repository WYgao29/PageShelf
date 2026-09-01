import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

const SUPPORTED_EXTENSIONS = new Set([".html", ".htm", ".md"]);
const FORMAT_EXTENSIONS = {
  html: new Set([".html", ".htm"]),
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
  if (existing.extension === ".html" || candidate.extension === ".html") {
    return existing.extension === ".html" ? existing : candidate;
  }
  return existing.extension === ".htm" ? existing : candidate;
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

  const title = content.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (title?.[1]) return stripHtml(title[1]);
  const heading = content.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
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
    markdown: publicSource(item.markdown),
    updatedAt: item.updatedAt,
    size: item.size,
    snippet: item.snippet,
  };
}

export function createLibrary({ roots = [] } = {}) {
  let configuredRoots = roots.map(normalizeRoot);
  let items = new Map();
  let lastScan = {
    completedAt: null,
    durationMs: 0,
    stats: { roots: 0, files: 0, items: 0 },
    errors: [],
  };

  async function performScan() {
    const startedAt = Date.now();
    const nextItems = new Map();
    const errors = [];
    let fileCount = 0;
    const rootsSnapshot = configuredRoots;

    for (const root of rootsSnapshot) {
      try {
        const canonicalRootPath = await realpath(root.path);
        const rootStats = await stat(canonicalRootPath);
        if (!rootStats.isDirectory()) {
          throw Object.assign(new Error("扫描路径不是目录"), { code: "ROOT_NOT_DIRECTORY" });
        }
        const files = await walkDirectory(canonicalRootPath);
        fileCount += files.length;
        const groups = new Map();

        for (const filePath of files) {
          const extension = path.extname(filePath).toLowerCase();
          const key = relativeStem(canonicalRootPath, filePath);
          const sourceStats = await stat(filePath);
          const content = await readFile(filePath, "utf8");
          const source = {
            path: filePath,
            extension,
            filename: path.basename(filePath),
            size: sourceStats.size,
            updatedAt: sourceStats.mtime.toISOString(),
            content,
            bodyText: extension === ".md" ? markdownText(content) : stripHtml(content),
          };
          const group = groups.get(key) || {};
          const sourceType = extension === ".md" ? "markdown" : "html";
          if (group[sourceType]) {
            const selected = chooseSource(group[sourceType], source);
            group[sourceType] = selected;
            errors.push({
              rootId: root.id,
              path: filePath,
              message: `发现重复${sourceType === "markdown" ? " Markdown" : " HTML"}文件，已保留 ${selected.filename}`,
            });
          } else {
            group[sourceType] = source;
          }
          groups.set(key, group);
        }

        for (const [relativePath, group] of groups) {
          const preferredSource = group.markdown || group.html;
          const fallbackTitle = path.basename(relativePath);
          const title = extractTitle(
            preferredSource.extension,
            preferredSource.content,
            fallbackTitle,
          );
          const bodyText = [group.html?.bodyText, group.markdown?.bodyText].filter(Boolean).join(" ");
          const updatedAt = [group.html?.updatedAt, group.markdown?.updatedAt]
            .filter(Boolean)
            .sort()
            .at(-1);
          const size = (group.html?.size || 0) + (group.markdown?.size || 0);
          const id = root.id + ":" + createId(relativePath);
          nextItems.set(id, {
            id,
            title,
            relativePath,
            directory: path.dirname(relativePath) === "." ? "/" : path.dirname(relativePath),
            rootId: root.id,
            rootLabel: root.label,
            html: group.html || null,
            markdown: group.markdown || null,
            updatedAt,
            size,
            snippet: bodyText.slice(0, 220),
            searchText: [title, relativePath, root.label, bodyText].join(" ").toLowerCase(),
          });
        }
      } catch (error) {
        errors.push({ rootId: root.id, path: root.path, message: error.message });
      }
    }

    items = nextItems;
    lastScan = {
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      stats: { roots: rootsSnapshot.length, files: fileCount, items: items.size },
      errors,
    };
    return {
      items: [...items.values()].map(publicItem),
      stats: lastScan.stats,
      errors: lastScan.errors,
    };
  }

  let scanQueue = Promise.resolve();
  function scan() {
    const nextScan = scanQueue.then(() => performScan());
    scanQueue = nextScan.catch(() => undefined);
    return nextScan;
  }

  function search(query = "", filters = {}) {
    const normalizedQuery = query.trim().toLowerCase();
    const terms = normalizedQuery ? normalizedQuery.split(/\s+/) : [];
    return [...items.values()]
      .filter((item) => !filters.rootId || item.rootId === filters.rootId)
      .filter((item) => !filters.format || item[filters.format])
      .filter((item) => terms.every((term) => item.searchText.includes(term)))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(publicItem);
  }

  function getItem(id) {
    return items.get(id) || null;
  }

  async function addRoot(rootPath, label) {
    const resolvedPath = path.resolve(rootPath);
    let rootStats;
    let canonicalPath;
    try {
      canonicalPath = await realpath(resolvedPath);
      rootStats = await stat(canonicalPath);
    } catch (error) {
      throw Object.assign(new Error("扫描目录不存在或不可读取"), { code: "ROOT_INVALID", cause: error });
    }
    if (!rootStats.isDirectory()) {
      throw Object.assign(new Error("扫描路径不是目录"), { code: "ROOT_NOT_DIRECTORY" });
    }
    if (configuredRoots.some((root) => root.path === canonicalPath)) {
      throw Object.assign(new Error("扫描目录已经存在"), { code: "ROOT_EXISTS" });
    }
    const root = normalizeRoot({ path: canonicalPath, label });
    configuredRoots = [...configuredRoots, root];
    return root;
  }

  function removeRoot(id) {
    const previousLength = configuredRoots.length;
    configuredRoots = configuredRoots.filter((root) => root.id !== id);
    return configuredRoots.length !== previousLength;
  }

  function getSettings() {
    return {
      roots: configuredRoots.map(({ id, path: rootPath, label, addedAt }) => ({
        id,
        path: rootPath,
        label,
        addedAt,
      })),
      lastScan,
    };
  }

  async function readSource(id, format, requestedRelativePath) {
    const item = items.get(id);
    if (!item || !Object.hasOwn(FORMAT_EXTENSIONS, format) || !Object.hasOwn(item, format)) {
      throw sourceNotFound();
    }
    const source = item[format];
    const root = configuredRoots.find((candidate) => candidate.id === item.rootId);
    if (!root) throw sourceNotFound();
    let canonicalRootPath;
    let canonicalSourcePath;
    let candidatePath;
    try {
      canonicalRootPath = await realpath(root.path);
      candidatePath = requestedRelativePath
        ? path.resolve(canonicalRootPath, requestedRelativePath)
        : source.path;
      canonicalSourcePath = await realpath(source.path);
      const canonicalCandidatePath = await realpath(candidatePath);
      if (
        !isInsideRoot(canonicalRootPath, canonicalCandidatePath) ||
        canonicalCandidatePath !== canonicalSourcePath
      ) {
        throw sourceNotFound("源文件路径无效");
      }
    } catch (error) {
      if (error.code === "SOURCE_NOT_FOUND") throw error;
      if (["ENOENT", "ELOOP", "ENOTDIR"].includes(error.code)) throw sourceNotFound();
      throw error;
    }
    let handle;
    try {
      handle = await open(candidatePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
      const content = await handle.readFile("utf8");
      return {
        content,
        contentType: format === "html" ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
        fileName: source.filename,
      };
    } catch (error) {
      if (["ENOENT", "ELOOP", "ENOTDIR"].includes(error.code)) throw sourceNotFound();
      throw error;
    } finally {
      await handle?.close();
    }
  }

  return {
    scan,
    search,
    getItem,
    addRoot,
    removeRoot,
    getSettings,
    readSource,
  };
}
