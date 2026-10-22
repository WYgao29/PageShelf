import { decodeText } from "./html.js";
import { decodeEntities } from "../../shared/html-source.js";

// Bump when archive rendering changes so cached HTML is regenerated.
export const MHTML_RENDER_VERSION = 2;
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
      .replace(/=([0-9a-f]{2})/gi, (_, hex) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      );
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
      .replace(/=([0-9a-f]{2})/gi, (_, hex) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      );
    return Buffer.from(binary, "latin1");
  }
  return Buffer.from(value, "latin1");
}

function extractMhtmlHtml(content) {
  const normalized = content.replace(/\r\n?/g, "\n");
  const headerEnd = normalized.indexOf("\n\n");
  if (headerEnd < 0) return content;
  const headers = parseMimeHeaders(normalized.slice(0, headerEnd));
  const boundaryMatch = headers["content-type"]?.match(
    /boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i,
  );
  if (!boundaryMatch) return content;
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  for (const part of normalized.slice(headerEnd + 2).split("--" + boundary)) {
    if (!part.trim() || part.trim() === "--") continue;
    const partHeaderEnd = part.indexOf("\n\n");
    if (partHeaderEnd < 0) continue;
    const partHeaders = parseMimeHeaders(part.slice(0, partHeaderEnd));
    if (/^text\/html\b/i.test(partHeaders["content-type"] || "")) {
      return decodeMhtmlPart(
        part.slice(partHeaderEnd + 2).replace(/\n--?\s*$/g, ""),
        partHeaders["content-transfer-encoding"],
      );
    }
  }
  return content;
}

export function mhtmlContentType(content) {
  const text = (
    Buffer.isBuffer(content)
      ? content.toString("latin1", 0, 64 * 1024)
      : content
  ).replace(/\r\n?/g, "\n");
  const headerEnd = text.indexOf("\n\n");
  if (headerEnd < 0) return "multipart/related";
  const contentType =
    parseMimeHeaders(text.slice(0, headerEnd))["content-type"] || "";
  const boundaryMatch = contentType.match(
    /boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i,
  );
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
  const boundaryMatch = headers["content-type"]?.match(
    /boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i,
  );
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
    parts.push({
      headers: partHeaders,
      body: decodeMhtmlPartBuffer(
        body,
        partHeaders["content-transfer-encoding"],
      ),
    });
  }
  return { headers, parts };
}

function resourceKey(value, baseLocation = "") {
  if (!value) return "";
  const trimmed = value.trim();
  if (/^cid:/i.test(trimmed))
    return "cid:" + trimmed.slice(4).replace(/^<|>$/g, "").toLowerCase();
  try {
    return new URL(trimmed, baseLocation || undefined).href;
  } catch {
    return trimmed;
  }
}

function rewriteCssResources(value, baseLocation, resources) {
  return value.replace(
    /url\(\s*(["']?)([^)"']+)\1\s*\)/gi,
    (match, quote, reference) => {
      const replacement = resources.get(resourceKey(reference, baseLocation));
      return replacement ? 'url("' + replacement + '")' : match;
    },
  );
}

export function renderMhtml(content) {
  const archive = parseMhtmlArchive(content);
  const htmlPart = archive.parts.find((part) =>
    /^text\/html\b/i.test(part.headers["content-type"] || ""),
  );
  if (!htmlPart)
    return Buffer.isBuffer(content) ? content.toString("utf8") : content;
  const htmlLocation = htmlPart.headers["content-location"] || "";
  const resources = new Map();
  for (const part of archive.parts) {
    if (part === htmlPart) continue;
    const contentType = (
      part.headers["content-type"] || "application/octet-stream"
    )
      .split(";", 1)[0]
      .trim();
    const dataUri =
      "data:" + contentType + ";base64," + part.body.toString("base64");
    const location = part.headers["content-location"];
    const contentId = part.headers["content-id"];
    if (location) resources.set(resourceKey(location, htmlLocation), dataUri);
    if (contentId)
      resources.set(resourceKey("cid:" + contentId, htmlLocation), dataUri);
  }
  let html = decodeText(
    htmlPart.body,
    htmlPart.headers["content-type"]?.match(
      /charset\s*=\s*["']?([^;\s"']+)/i,
    )?.[1] || "utf-8",
  );
  html = html.replace(/<base\b[^>]*>/gi, "");
  html = html.replace(
    /(\b(?:src|href|poster|background)\s*=\s*)(["'])([^"']+)\2/gi,
    (match, prefix, quote, reference) => {
      const replacement = resources.get(resourceKey(decodeEntities(reference), htmlLocation));
      return replacement ? prefix + quote + replacement + quote : match;
    },
  );
  html = html.replace(
    /(\bstyle\s*=\s*)(["'])([\s\S]*?)\2/gi,
    (match, prefix, quote, style) => {
      const decoded = decodeEntities(style);
      const rewritten = rewriteCssResources(decoded, htmlLocation, resources);
      if (rewritten === decoded) return match;
      const escaped = rewritten.replaceAll("&", "&amp;").replaceAll(quote, quote === '"' ? "&quot;" : "&#39;");
      return prefix + quote + escaped + quote;
    },
  );
  html = html.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (match, open, style, close) =>
      open + rewriteCssResources(style, htmlLocation, resources) + close,
  );
  return html;
}

export function parseMhtml(content) {
  const archive = parseMhtmlArchive(content);
  const part = archive.parts.find((part) =>
    /^text\/html\b/i.test(part.headers["content-type"] || ""),
  );
  return {
    html: part
      ? decodeText(
          part.body,
          part.headers["content-type"]?.match(
            /charset\s*=\s*["\']?([^;\s"\']+)/i,
          )?.[1] || "utf-8",
        )
      : Buffer.isBuffer(content)
        ? content.toString("utf8")
        : content,
    parts: archive.parts,
  };
}
