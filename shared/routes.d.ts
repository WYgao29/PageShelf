export type Route = {
  rootId: string; seriesKey: string; folder: string; q: string;
  scope: "root" | "all"; fmt: string; kind: string; sort: string;
  item: string; view: "reader" | "original" | "markdown"; settings: boolean;
};
export function parseRoute(input?: string): Route;
export function serializeRoute(route: Route): string;
