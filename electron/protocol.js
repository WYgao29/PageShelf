import { readFile } from "node:fs/promises";
import path from "node:path";
import { rewriteExternalAnchors } from "./external-links.js";
import { SOURCE_CSP } from "../src/services/items.js";
import {
  APP_CSP,
  parsePageshelfUrl,
} from "../shared/pageshelf-contract.js";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const sourceHeaders = (headers = {}, dev = false) => ({
  ...headers,
  "content-security-policy": SOURCE_CSP + (dev ? " http://127.0.0.1:5173" : ""),
  "x-content-type-options": "nosniff",
});

const appHeaders = (contentType) => ({
  "content-type": contentType,
  "content-security-policy": APP_CSP,
  "x-content-type-options": "nosniff",
  "cache-control": "no-cache",
});

function textResult(status, message, headers) {
  return {
    status,
    body: Buffer.from(message),
    headers,
  };
}

async function readAppFile(appRoot, pathname) {
  const relative =
    !pathname || pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(appRoot, relative);
  const fromRoot = path.relative(appRoot, filePath);
  if (
    !relative ||
    fromRoot.startsWith("..") ||
    path.isAbsolute(fromRoot) ||
    fromRoot === ""
  )
    return null;
  try {
    const body = await readFile(filePath);
    const contentType =
      contentTypes[path.extname(filePath).toLowerCase()] ||
      "application/octet-stream";
    return { body, contentType };
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") return null;
    throw error;
  }
}

/**
 * @param {{
 *   url: string,
 *   method?: string,
 *   call: (method: string, params: object) => Promise<any>,
 *   appRoot: string,
 *   dev?: boolean,
 * }} request
 */
export async function handlePageshelfRequest({
  url,
  method = "GET",
  call,
  appRoot,
  dev = false,
}) {
  if (method !== "GET" && method !== "HEAD")
    return textResult(405, "方法不被允许", appHeaders("text/plain; charset=utf-8"));
  const parsed = parsePageshelfUrl(url);
  if (!parsed)
    return textResult(400, "协议地址无效", appHeaders("text/plain; charset=utf-8"));
  if (parsed.kind === "app") {
    const file = await readAppFile(appRoot, parsed.pathname);
    if (!file)
      return textResult(404, "页面不存在", appHeaders("text/plain; charset=utf-8"));
    return {
      status: 200,
      body: method === "HEAD" ? null : file.body,
      headers: appHeaders(file.contentType),
    };
  }
  try {
    const result = await call(sourceMethod(parsed), sourceParams(parsed));
    if (result.notModified)
      return { status: 304, body: null, headers: sourceHeaders(result.headers, dev) };
    return {
      status: 200,
      body: method === "HEAD" ? null : parsed.action === "original" && String(result.headers?.["content-type"]).startsWith("text/html") ? rewriteExternalAnchors(result.body, parsed.id) : result.body,
      headers: sourceHeaders(result.headers, dev),
    };
  } catch (error) {
    const status = error.code === "SOURCE_NOT_FOUND" ? 404 : 400;
    return textResult(
      status,
      error.message || "源文件不存在",
      sourceHeaders({ "content-type": "text/plain; charset=utf-8" }, dev),
    );
  }
}

function sourceMethod(parsed) {
  if (parsed.action === "asset") return "items.asset";
  if (parsed.action === "source") return "items.source";
  return parsed.action === "document" ? "items.document" : "items.original";
}

function sourceParams(parsed) {
  if (parsed.action === "asset") return { id: parsed.id, path: parsed.assetPath };
  if (parsed.action === "source")
    return { id: parsed.id, format: parsed.format };
  return { id: parsed.id };
}

export function protocolPrivileges() {
  return {
    scheme: "pageshelf",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  };
}
