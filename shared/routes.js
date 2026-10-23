const decode = value => { try { return decodeURIComponent(value); } catch { return ""; } };

export function parseRoute(input = "/") {
  let url;
  try { url = new URL(input.replace(/^#/, "") || "/", "https://local"); }
  catch { url = new URL("https://local/"); }
  const match = url.pathname.match(/^\/r\/([^/]+)(?:\/(s|f)\/(.+))?$/);
  const rootId = match ? decode(match[1]) : "";
  const seriesKey = match?.[2] === "s" ? decode(match[3]) : "";
  const p = url.searchParams;
  const q = (p.get("q") || "").slice(0, 500);
  const allowed = (key, values, fallback = "") => values.includes(p.get(key) || "") ? p.get(key) : fallback;
  return {
    rootId, seriesKey, folder: match?.[2] === "f" ? decode(match[3]) : "", q,
    scope: rootId && p.get("scope") !== "all" ? "root" : "all",
    fmt: allowed("fmt", ["html", "mhtml", "markdown"]), kind: allowed("kind", ["series", "single"]),
    sort: allowed("sort", ["relevance", "updated", "title", "series"], q ? "relevance" : seriesKey ? "series" : "updated"),
    item: p.get("item") || "", view: allowed("view", ["original", "markdown"], "reader"),
    settings: p.get("settings") === "roots" || url.pathname === "/settings/roots",
  };
}

export function serializeRoute(route) {
  const pathname = route.rootId ? "/r/" + encodeURIComponent(route.rootId) +
    (route.seriesKey ? "/s/" + encodeURIComponent(route.seriesKey) : route.folder ? "/f/" + route.folder.split("/").map(encodeURIComponent).join("/") : "") : "/";
  const p = new URLSearchParams();
  for (const key of ["q", "fmt", "kind", "item", "sort"]) if (route[key]) p.set(key, route[key]);
  if (route.rootId && route.scope === "all") p.set("scope", "all");
  if (route.view && route.view !== "reader") p.set("view", route.view);
  if (route.settings) p.set("settings", "roots");
  return pathname + (p.size ? "?" + p : "");
}
