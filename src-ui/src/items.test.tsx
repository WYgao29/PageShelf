import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { mergePage, searchQuery, type Item, type SearchResult } from "./items";
import { parseRoute, serializeRoute } from "./router";

const item = (id: string): Item => ({ id, title: "文章 " + id, rootId: "root-a", rootLabel: "甲", relativePath: id, formats: { html: { filename: id, extension: ".html", size: 10, updatedAt: "2026-01-01" }, mhtml: null, markdown: null }, series: null, site: null, author: null, tags: [], readingMinutes: 1, updatedAt: "2026-01-01", excerpt: "正文摘要", hits: 2 });
const page = (items: Item[], total = items.length): SearchResult => ({ items, total, groups: [], roots: 1, tookMs: 1 });
function harness(search: (params: Record<string, unknown>) => Promise<SearchResult>) {
  const invoke = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "items.search") return search(params?.query as Record<string, unknown>);
    if (method === "roots.list") return { roots: [{ id: "root-a", label: "甲", path: "/tmp/a", enabled: true, state: { status: "ok" } }] };
    if (method === "items.get") return { item: item(String(params?.id)), files: [], prev: null, next: null, series: null };
    return {};
  });
  window.pageshelf = { invoke, on: () => () => {}, openOriginal: vi.fn(async () => ({})), openExternal: async () => ({}), openTrash: async () => ({}), revealInFinder: async () => ({}), pickFolder: async () => ({}) };
  return invoke;
}

describe("desktop search and routes", () => {
  it("round trips every navigation field including Unicode and the settings overlay", () => {
    const route = parseRoute("/r/目录/s/系列?q=%22两%20词%22%20-排除&scope=all&fmt=markdown&kind=series&sort=title&item=abc&view=original&settings=roots");
    expect(parseRoute(serializeRoute(route))).toEqual(route);
    expect(searchQuery(route)).toMatchObject({ roots: "", series: "", q: '"两 词" -排除' });
    expect(parseRoute("/r/a?fmt=bad&sort=bad&view=bad")).toMatchObject({ fmt: "", sort: "updated", view: "reader", scope: "root" });
    expect(parseRoute("/r/a/f/文档/子目录").folder).toBe("文档/子目录");
  });

  it("merges pagination without duplicate items or groups", () => {
    const group = { rootId: "root-a", seriesKey: "s", kind: "series", label: "系列", itemIds: ["a"] };
    const merged = mergePage({ ...page([item("a")]), groups: [group] }, { ...page([item("a"), item("b")], 2), groups: [{ ...group, itemIds: ["a", "b"] }] });
    expect(merged.items.map(value => value.id)).toEqual(["a", "b"]);
    expect(merged.groups[0].itemIds).toEqual(["a", "b"]);
    expect(group.itemIds).toEqual(["a"]);
  });

  it("debounces search and sends filters through IPC, then persists selection", async () => {
    const invoke = harness(async () => page([item("a")]));
    render(<App />);
    await screen.findByRole("option", { name: /文章 a/ });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: '"短语" -排除' } });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("items.search", { query: expect.objectContaining({ q: '"短语" -排除', sort: "relevance", limit: 100, offset: 0 }) }));
    fireEvent.change(screen.getByLabelText("格式"), { target: { value: "html" } });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("items.search", { query: expect.objectContaining({ fmt: "html" }) }));
    fireEvent.click(await screen.findByRole("option", { name: /文章 a/ }));
    expect(parseRoute(localStorage.getItem("ui.route") || "").item).toBe("a");
  });

  it("ignores a stale search response after the query changes", async () => {
    let release: (value: SearchResult) => void = () => {};
    harness(async query => query.q === "old" ? new Promise(resolve => { release = resolve; }) : page([item("fresh")]));
    history.replaceState(null, "", "#/??q=old".replace("??", "?"));
    render(<App />);
    await waitFor(() => expect(screen.getByRole("searchbox")).toHaveValue("old"));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "new" } });
    await screen.findByRole("option", { name: /文章 fresh/ });
    await act(async () => release(page([item("stale")])));
    expect(screen.queryByRole("option", { name: /文章 stale/ })).toBeNull();
  });

  it("shows six entries per group and loads the next batch of 100", async () => {
    const items = Array.from({ length: 8 }, (_, index) => item(String(index)));
    const invoke = harness(async query => query.offset ? page([item("8")], 9) : { ...page(items, 9), groups: [{ rootId: "root-a", seriesKey: "s", label: "系列甲", kind: "series", itemIds: items.map(value => value.id) }] });
    render(<App />);
    await screen.findByRole("option", { name: /文章 0/ });
    expect(screen.getAllByRole("option", { selected: false }).filter(node => node.classList.contains("item-row"))).toHaveLength(6);
    fireEvent.click(screen.getByText("展开其余 2 篇"));
    expect(screen.getByRole("option", { name: /文章 7/ })).toBeInTheDocument();
    fireEvent.click(screen.getByText("加载更多（100 篇）"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("items.search", { query: expect.objectContaining({ offset: 8, limit: 100 }) }));
  });

  it("restores startup and browser history state", async () => {
    localStorage.setItem("ui.route", "/r/root-a?q=restore&item=a&view=markdown");
    harness(async () => page([item("a")]));
    render(<App />);
    expect(screen.getByRole("searchbox")).toHaveValue("restore");
    await act(async () => { history.replaceState(null, "", "#/r/root-a?q=back&fmt=markdown"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(screen.getByRole("searchbox")).toHaveValue("back");
    expect(screen.getByLabelText("格式")).toHaveValue("markdown");
  });

  it("shows an error with retry and distinct no-result content", async () => {
    let fail = true;
    harness(async () => { if (fail) throw new Error("worker unavailable"); return page([]); });
    history.replaceState(null, "", "#/?q=missing");
    render(<App />);
    await screen.findByText("worker unavailable");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("没有找到匹配内容");
    expect(screen.getByText(/查询“missing”/)).toBeInTheDocument();
  });
});
