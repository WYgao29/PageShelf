import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Route = {
  rootId: string; seriesKey: string; folder: string; q: string;
  scope: "root" | "all"; fmt: string; kind: string;
  sort: string; item: string; view: "reader" | "original" | "markdown"; settings: boolean;
};

const decode = (value: string) => { try { return decodeURIComponent(value); } catch { return ""; } };
export function parseRoute(input = "/"): Route {
  let url: URL;
  try { url = new URL(input.replace(/^#/, "") || "/", "https://local"); }
  catch { url = new URL("https://local/"); }
  const match = url.pathname.match(/^\/r\/([^/]+)(?:\/(s|f)\/(.+))?$/);
  const rootId = match ? decode(match[1]) : "";
  const seriesKey = match?.[2] === "s" ? decode(match[3]) : "";
  const p = url.searchParams;
  const q = (p.get("q") || "").slice(0, 500);
  const allowed = (key: string, values: string[], fallback = "") => values.includes(p.get(key) || "") ? p.get(key)! : fallback;
  return {
    rootId, seriesKey, folder: match?.[2] === "f" ? decode(match[3]) : "", q,
    scope: rootId && p.get("scope") !== "all" ? "root" : "all",
    fmt: allowed("fmt", ["html", "mhtml", "markdown"]), kind: allowed("kind", ["series", "single"]),
    sort: allowed("sort", ["relevance", "updated", "title", "series"], q ? "relevance" : seriesKey ? "series" : "updated"),
    item: p.get("item") || "", view: allowed("view", ["original", "markdown"], "reader") as Route["view"],
    settings: p.get("settings") === "roots" || url.pathname === "/settings/roots",
  };
}

export function serializeRoute(route: Route) {
  const pathname = route.rootId ? "/r/" + encodeURIComponent(route.rootId) +
    (route.seriesKey ? "/s/" + encodeURIComponent(route.seriesKey) : route.folder ? "/f/" + route.folder.split("/").map(encodeURIComponent).join("/") : "") : "/";
  const p = new URLSearchParams();
  for (const key of ["q", "fmt", "kind", "item", "sort"] as const) if (route[key]) p.set(key, route[key]);
  if (route.rootId && route.scope === "all") p.set("scope", "all");
  if (route.view !== "reader") p.set("view", route.view);
  if (route.settings) p.set("settings", "roots");
  return pathname + (p.size ? "?" + p : "");
}

type RouterValue = { route: Route; navigate: (patch: Partial<Route>, replace?: boolean) => void };
const Router = createContext<RouterValue | null>(null);
function initialRoute() {
  if (location.hash.startsWith("#/")) return parseRoute(location.hash);
  try { return parseRoute(localStorage.getItem("ui.route") || "/"); } catch { return parseRoute(); }
}
export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [route, setRoute] = useState(initialRoute);
  useEffect(() => {
    const restore = () => setRoute(parseRoute(location.hash));
    window.addEventListener("popstate", restore);
    window.addEventListener("hashchange", restore);
    return () => { window.removeEventListener("popstate", restore); window.removeEventListener("hashchange", restore); };
  }, []);
  useEffect(() => {
    const serialized = serializeRoute(route);
    if (!location.hash.startsWith("#/")) history.replaceState(null, "", "#" + serialized);
    try { localStorage.setItem("ui.route", serialized); } catch { /* 设置不可写时仍可浏览。 */ }
    window.dispatchEvent(new Event("pageshelf-route"));
  }, [route]);
  const navigate = useCallback((patch: Partial<Route>, replace = false) => {
    setRoute(current => {
      const next = parseRoute(serializeRoute({ ...current, ...patch }));
      const serialized = serializeRoute(next);
      if (serializeRoute(current) === serialized) return current;
      history[replace ? "replaceState" : "pushState"](null, "", "#" + serialized);
      return next;
    });
  }, []);
  return <Router.Provider value={{ route, navigate }}>{children}</Router.Provider>;
}
export function useRoute() {
  const context = useContext(Router);
  if (!context) throw new Error("路由不可用");
  return context;
}
