import { createServer as createHttpServer } from "node:http";
import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createLibrary } from "./library.js";
import { createConfigStore } from "./config.js";
import { createRootRegistry } from "./roots.js";
import { handle as handleRoots } from "./routes/roots.js";
import { createDocumentCache } from "./cache.js";
import { handle as handleItems } from "./routes/items.js";
import { handle as handleSystem } from "./routes/system.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(currentDirectory, "..", "public");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};
const execFile = promisify(execFileCallback);

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
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
  if ([
    "ROOT_NOT_DIRECTORY",
    "ROOT_INVALID",
    "ROOT_EXISTS",
    "ROOT_CONFIG_INVALID",
    "INVALID_JSON",
    "BODY_TOO_LARGE",
    "INVALID_PATH",
    "FOLDER_PICKER_CANCELLED",
  ].includes(error.code)) {
    return 400;
  }
  if (error.code === "SOURCE_NOT_FOUND") return 404;
  return 500;
}

function decodeRoutePart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw Object.assign(new Error("请求路径无效"), { code: "INVALID_PATH" });
  }
}

function tokenMatches(actual, expected) {
  if (typeof actual !== "string" || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function requestToken(request) {
  const authorization = request.headers.authorization || "";
  if (authorization.startsWith("Bearer ")) return authorization.slice("Bearer ".length);
  const cookies = request.headers.cookie?.split(";").map((part) => part.trim()) || [];
  const tokenCookie = cookies.find((part) => part.startsWith("html_library_token="));
  if (!tokenCookie) return "";
  try {
    return decodeURIComponent(tokenCookie.slice("html_library_token=".length));
  } catch {
    return "";
  }
}

function authorizeRequest(request, requestUrl, response, authToken) {
  if (!authToken || tokenMatches(requestToken(request), authToken)) return true;
  if (request.method === "GET" && requestUrl.pathname === "/" && tokenMatches(requestUrl.searchParams.get("token"), authToken)) {
    response.writeHead(302, {
      location: "/",
      "set-cookie": "html_library_token=" + encodeURIComponent(authToken) + "; HttpOnly; SameSite=Strict; Path=/",
      "cache-control": "no-store",
    });
    response.end();
    return false;
  }
  sendJson(response, 401, { error: "需要访问令牌" });
  return false;
}

async function chooseFolderWithNativeDialog() {
  if (process.platform !== "darwin") {
    throw Object.assign(new Error("当前系统不支持原生文件夹选择器，请手动输入路径"), { code: "FOLDER_PICKER_UNAVAILABLE" });
  }
  try {
    const { stdout } = await execFile("osascript", [
      "-e",
      'POSIX path of (choose folder with prompt "选择要扫描的文件夹")',
    ]);
    const selectedPath = stdout.trim();
    if (!selectedPath) throw Object.assign(new Error("没有选择文件夹"), { code: "FOLDER_PICKER_CANCELLED" });
    return selectedPath;
  } catch (error) {
    if (error.code === "FOLDER_PICKER_CANCELLED" || /user canceled|cancelled|canceled/i.test(error.stderr || error.message || "")) {
      return null;
    }
    throw Object.assign(new Error("无法打开文件夹选择器，请手动输入路径"), { code: "FOLDER_PICKER_UNAVAILABLE", cause: error });
  }
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

export function createServer({ dataDir = path.join(os.homedir(), ".html-library"), library, authToken = "", chooseDirectory = chooseFolderWithNativeDialog, trashService } = {}) {
  const activeDataDir = path.resolve(dataDir);
  let activeLibrary = library;

  const configStore = createConfigStore({ dataDir: activeDataDir });
  let registry;
  const cache = createDocumentCache({ directory: path.join(activeDataDir, "cache", "doc") });
  const ready = (async () => {
    if (!activeLibrary) {
      registry = createRootRegistry({ configStore }); await registry.load();
      activeLibrary = createLibrary({ rootRegistry: registry, trashService });
    } else registry = activeLibrary.registry;
    const roots = registry.list();
    roots.forEach(root => activeLibrary.scheduler.enqueue(root.id, {}));
    if (roots.length) await activeLibrary.scheduler.waitForRoot(roots[0].id);
  })();

  const server = createHttpServer(async (request, response) => {
    try {
      await ready;
      const requestUrl = new URL(request.url || "/", "http://localhost");
      if (!authorizeRequest(request, requestUrl, response, authToken)) return;
      const pathname = requestUrl.pathname;
      const method = request.method || "GET";
      let body;
      if (["POST", "PATCH", "PUT", "DELETE"].includes(method)) {
        const expectedOrigin = 'http://' + request.headers.host;
        if (request.headers.origin !== expectedOrigin) throw Object.assign(new Error('仅允许同源请求'), { code: 'ORIGIN_FORBIDDEN', status: 403 });
        if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw Object.assign(new Error('请求需要 application/json'), { code: 'CONTENT_TYPE_REQUIRED', status: 415 });
        body = await readJsonBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('请求需要 JSON 对象'), { code: 'INVALID_JSON', status: 400 });
      }
      const context = { request, response, url: requestUrl, library: activeLibrary, registry, configStore, sendJson, body, decode: decodeRoutePart, chooseDirectory, cache };
      if (await handleRoots(context) || await handleSystem(context) || await handleItems(context)) return;

      if (pathname === "/api/settings" && method === "GET") {
        sendJson(response, 200, activeLibrary.getSettings());
        return;
      }

      const itemMatch = pathname.match(/^\/api\/items\/([^/]+)$/);
      if (itemMatch && method === "DELETE") {
        const item = await activeLibrary.deleteItem(decodeRoutePart(itemMatch[1]));
        const scan = await activeLibrary.scan();
        sendJson(response, item.trashResult?.failed.length ? 207 : 200, { item, scan, ...item.trashResult });
        return;
      }

      if (pathname === "/api/library" && method === "GET") {
        const format = requestUrl.searchParams.get("format") || "";
        if (format && !["html", "mhtml", "markdown"].includes(format)) {
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
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          typeof body.path !== "string" ||
          !body.path.trim() ||
          (body.label !== undefined && typeof body.label !== "string")
        ) {
          sendError(response, 400, "请提供有效的扫描目录路径");
          return;
        }
        const root = await activeLibrary.addRoot(body.path.trim(), body.label);
        const scan = await activeLibrary.scan();
        sendJson(response, 201, { root, scan });
        return;
      }

      const rootMatch = pathname.match(/^\/api\/settings\/roots\/([^/]+)$/);
      if (rootMatch && method === "DELETE") {
        const removed = await activeLibrary.removeRoot(decodeRoutePart(rootMatch[1]));
        if (!removed) {
          sendError(response, 404, "扫描目录不存在");
          return;
        }
        sendJson(response, 200, await activeLibrary.scan());
        return;
      }

      if (method === "GET") {
        await serveStatic(response, pathname);
        return;
      }

      sendError(response, 404, "接口不存在");
    } catch (error) {
      const legacy = request.url?.startsWith('/api/settings') || request.url?.startsWith('/api/library') || request.method === 'DELETE' && /^\/api\/items\/[^/]+$/.test(request.url || '');
      const status = error.status || (['ROOT_NOT_FOUND','SOURCE_NOT_FOUND'].includes(error.code) ? 404 : error.code === 'CONFIG_READ_ONLY' ? 409 : /^(ROOT_|INVALID_|LABEL_|ORDER_)/.test(error.code || '') ? 400 : errorStatus(error));
      sendJson(response, status, { error: legacy ? error.message : { code: error.code || 'INTERNAL_ERROR', message: error.message || '服务器内部错误', details: error.details || {} } });
    }
  });

  server.ready = ready;
  server.library = () => activeLibrary;
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 4321);
  const host = process.env.HOST || "127.0.0.1";
  const authToken = process.env.AUTH_TOKEN || "";
  if (!["127.0.0.1", "localhost", "::1"].includes(host) && !authToken) {
    throw new Error("HOST 非本机地址时必须设置 AUTH_TOKEN");
  }
  const server = createServer({ authToken, dataDir: process.env.HTML_LIBRARY_DATA_DIR || path.join(os.homedir(), ".html-library") });
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") { console.log("服务已在运行（端口 " + port + "）"); process.exitCode = 0; }
    else { console.error(error.message); process.exitCode = 1; }
  });
  await server.ready;
  server.listen(port, host, () => {
    console.log("HTML Library listening on http://" + host + ":" + port);
  });
}
