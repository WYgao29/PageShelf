import { createServer as createHttpServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLibrary } from "./library.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(currentDirectory, "..", "public");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { error: message });
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) {
      throw Object.assign(new Error("请求内容过大"), { code: "BODY_TOO_LARGE" });
    }
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw Object.assign(new Error("请求内容不是有效 JSON"), { code: "INVALID_JSON" });
  }
}

function errorStatus(error) {
  if (["ROOT_NOT_DIRECTORY", "ROOT_INVALID", "ROOT_EXISTS", "INVALID_JSON", "BODY_TOO_LARGE"].includes(error.code)) {
    return 400;
  }
  if (error.code === "SOURCE_NOT_FOUND") return 404;
  return 500;
}

async function readConfig(dataDir) {
  try {
    const config = JSON.parse(await readFile(path.join(dataDir, "config.json"), "utf8"));
    return Array.isArray(config.roots) ? config.roots : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    return [];
  }
}

async function saveConfig(dataDir, library) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    path.join(dataDir, "config.json"),
    JSON.stringify({ roots: library.getSettings().roots }, null, 2) + "\n",
    "utf8",
  );
}

async function serveStatic(response, pathname) {
  const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/assets\//, "");
  const filePath = path.resolve(publicDirectory, requestedPath);
  const relative = path.relative(publicDirectory, filePath);
  if (relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    sendError(response, 404, "页面不存在");
    return;
  }
  try {
    const content = await readFile(filePath);
    const contentType = contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, { "content-type": contentType, "cache-control": "no-cache" });
    response.end(content);
  } catch {
    sendError(response, 404, "页面不存在");
  }
}

export function createServer({ dataDir = path.join(os.homedir(), ".html-library"), library } = {}) {
  const activeDataDir = path.resolve(dataDir);
  let activeLibrary = library;

  const ready = (async () => {
    if (!activeLibrary) {
      activeLibrary = createLibrary({ roots: await readConfig(activeDataDir) });
    }
    await activeLibrary.scan();
  })();

  const server = createHttpServer(async (request, response) => {
    await ready;
    const requestUrl = new URL(request.url || "/", "http://localhost");
    const pathname = requestUrl.pathname;
    const method = request.method || "GET";

    try {
      if (pathname === "/api/settings" && method === "GET") {
        sendJson(response, 200, activeLibrary.getSettings());
        return;
      }

      if (pathname === "/api/scan" && method === "POST") {
        sendJson(response, 200, await activeLibrary.scan());
        return;
      }

      if (pathname === "/api/library" && method === "GET") {
        const format = requestUrl.searchParams.get("format") || "";
        if (format && !["html", "markdown"].includes(format)) {
          sendError(response, 400, "格式筛选无效");
          return;
        }
        sendJson(response, 200, {
          items: activeLibrary.search(requestUrl.searchParams.get("q") || "", {
            rootId: requestUrl.searchParams.get("rootId") || "",
            format,
          }),
          stats: activeLibrary.getSettings().lastScan.stats,
        });
        return;
      }

      if (pathname === "/api/settings/roots" && method === "POST") {
        const body = await readJsonBody(request);
        if (typeof body.path !== "string" || !body.path.trim()) {
          sendError(response, 400, "请提供有效的扫描目录路径");
          return;
        }
        const root = await activeLibrary.addRoot(body.path.trim(), body.label);
        await saveConfig(activeDataDir, activeLibrary);
        const scan = await activeLibrary.scan();
        sendJson(response, 201, { root, scan });
        return;
      }

      const rootMatch = pathname.match(/^\/api\/settings\/roots\/([^/]+)$/);
      if (rootMatch && method === "DELETE") {
        const removed = activeLibrary.removeRoot(decodeURIComponent(rootMatch[1]));
        if (!removed) {
          sendError(response, 404, "扫描目录不存在");
          return;
        }
        await saveConfig(activeDataDir, activeLibrary);
        sendJson(response, 200, await activeLibrary.scan());
        return;
      }

      const sourceMatch = pathname.match(/^\/api\/items\/([^/]+)\/(source|download)\/([^/]+)$/);
      if (sourceMatch && method === "GET") {
        const itemId = decodeURIComponent(sourceMatch[1]);
        const format = decodeURIComponent(sourceMatch[3]);
        const source = await activeLibrary.readSource(itemId, format);
        const disposition = sourceMatch[2] === "download" ? "attachment" : "inline";
        response.writeHead(200, {
          "content-type": source.contentType,
          "content-disposition": disposition + "; filename*=UTF-8''" + encodeURIComponent(source.fileName),
          "cache-control": "no-store",
        });
        response.end(source.content);
        return;
      }

      if (method === "GET") {
        await serveStatic(response, pathname);
        return;
      }

      sendError(response, 404, "接口不存在");
    } catch (error) {
      sendError(response, errorStatus(error), error.message || "服务器内部错误");
    }
  });

  server.ready = ready;
  server.library = () => activeLibrary;
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 4321);
  const host = process.env.HOST || "0.0.0.0";
  const server = createServer();
  await server.ready;
  server.listen(port, host, () => {
    console.log("HTML Library listening on http://" + host + ":" + port);
  });
}
