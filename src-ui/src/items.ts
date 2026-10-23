import type { Route } from "./router";

export type Format = { extension: string; filename: string; size: number; updatedAt: string };
export type Item = {
  id: string; title: string; rootId: string; rootLabel: string; relativePath: string;
  formats: { html: Format | null; mhtml: Format | null; markdown: Format | null };
  series: { key: string; name: string; index: number; total: number } | null;
  site: string | null; author: string | null; tags: string[]; readingMinutes: number;
  updatedAt: string; excerpt: string; hits?: number;
  highlights?: { field: string; text: string; ranges: [number, number][] }[];
};
export type Group = { rootId: string; seriesKey: string | null; label: string; kind: string; itemIds: string[] };
export type SearchResult = { items: Item[]; groups: Group[]; total: number; roots: number; tookMs: number };
export type ItemDetail = { item: Item; prev: { id: string; title: string } | null; next: { id: string; title: string } | null; files: { format: string; path: string; size: number }[]; series: { key: string; name: string; total: number } | null };

export function searchQuery(route: Route) {
  const all = route.q && route.scope === "all";
  return { q: route.q, roots: all ? "" : route.rootId, series: all ? "" : route.seriesKey,
    folder: route.folder, fmt: route.fmt, kind: route.kind, sort: route.sort };
}
export function mergePage(current: SearchResult, page: SearchResult): SearchResult {
  const ids = new Set(current.items.map(item => item.id));
  const groups = current.groups.map(group => ({ ...group, itemIds: [...group.itemIds] }));
  for (const group of page.groups) {
    const target = groups.find(value => value.rootId === group.rootId && value.seriesKey === group.seriesKey);
    if (target) target.itemIds = [...new Set([...target.itemIds, ...group.itemIds])];
    else groups.push(group);
  }
  return { ...page, items: [...current.items, ...page.items.filter(item => !ids.has(item.id))], groups };
}
export async function invoke<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  if (!window.pageshelf) throw new Error("桌面接口不可用");
  return await window.pageshelf.invoke(method, params) as T;
}
