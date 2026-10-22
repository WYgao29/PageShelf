import { attributes } from "../shared/html-source.js";
import { externalUrlDecision, isItemId } from "../shared/pageshelf-contract.js";

export function sourceExternalLink(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "pageshelf:" || parsed.host !== "source" || !/^\/[^/]+\/external$/.test(parsed.pathname)) return null;
    const id = parsed.pathname.split("/")[1];
    if (!isItemId(id) || [...parsed.searchParams.keys()].join(",") !== "url64") return null;
    const encoded = parsed.searchParams.get("url64");
    if (!encoded || !/^[A-Za-z0-9_-]{1,3000}$/.test(encoded)) return null;
    const target = Buffer.from(encoded, "base64url").toString("utf8");
    const decision = externalUrlDecision(target, { confirmed: true });
    return decision.ok ? decision.url : null;
  } catch { return null; }
}

// Sandboxed original documents cannot execute a click bridge. Route external
// anchors through a local navigation that the main process cancels and confirms.
export function rewriteExternalAnchors(content, itemId) {
  const html = typeof content === "string" ? content : Buffer.from(content).toString("utf8");
  return html.replace(/<a\b[^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/gi, raw => {
    const href = attributes(raw).href;
    if (!href || !/^https?:\/\//i.test(href)) return raw;
    const decision = externalUrlDecision(href, { confirmed: true });
    if (!decision.ok) return raw;
    const link = `pageshelf://source/${itemId}/external?url64=${Buffer.from(decision.url).toString("base64url")}`;
    return raw.replace(/\s+(href|target)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/>$/, ` href="${link}">`);
  });
}
