import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { parseRoute, serializeRoute, type Route } from "../../shared/routes.js";
export { parseRoute, serializeRoute };
export type { Route };

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
