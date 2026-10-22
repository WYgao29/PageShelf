import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { formatDate, parsePreflight, preflightFingerprint, type Preflight } from "./library";

type Call = { method: string; params?: Record<string, unknown> };
type RootJson = Record<string, unknown>;

function makeRoot(overrides: RootJson = {}): RootJson {
  const id = String(overrides.id || "root-a");
  return {
    id,
    label: "甲",
    path: "/tmp/a",
    displayPath: "~/a",
    enabled: true,
    options: { series: "auto" },
    counts: { items: 3, files: 4, series: 1, html: 2, mhtml: 1, markdown: 1 },
    state: {
      status: "ok",
      message: null,
      excludes: [],
      lastScan: { completedAt: "2026-01-02T00:00:00.000Z", files: 4, items: 3 },
      issues: [],
    },
    ...overrides,
  };
}

function validPreview(path: string, counts = { files: 2, items: 1 }, extra: Record<string, unknown> = {}) {
  return { valid: true, path, label: extra.label, counts, errors: [], duplicateLabel: false, overlap: null, ...extra };
}

function createHarness(initial: RootJson[] = [makeRoot()]) {
  const listeners = {
    "scan-progress": new Set<(payload: unknown) => void>(),
    "library-changed": new Set<(payload: unknown) => void>(),
    "worker-status": new Set<(payload: unknown) => void>(),
  };
  const calls: Call[] = [];
  const state = {
    roots: initial,
    readOnly: false,
    startupWarning: "",
    scan: { running: [] as unknown[], queued: [] as unknown[] },
    failList: 0,
    preflight(params?: Record<string, unknown>): unknown {
      return validPreview(String(params?.path || ""));
    },
    series(_params?: Record<string, unknown>): unknown {
      return { series: [] as unknown[] };
    },
  };
  let statusGate: Promise<unknown> | null = null;
  const api = {
    calls,
    state,
    holdNextStatus() {
      let release: (value: unknown) => void = () => {};
      statusGate = new Promise((resolve) => {
        release = resolve;
      });
      return (value: unknown) => release(value);
    },
    pickFolder: vi.fn(async (): Promise<{ cancelled: boolean; path?: string }> => ({ cancelled: true })),
    revealInFinder: vi.fn(async () => ({})),
    openTrash: vi.fn(async () => ({})),
    openOriginal: vi.fn(async () => ({})),
    openExternal: vi.fn(async () => ({})),
    invoke: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "roots.list") {
        if (state.failList > 0) {
          state.failList -= 1;
          throw new Error("读取失败");
        }
        return {
          roots: state.roots,
          totals: {
            items: state.roots.reduce((sum, root) => sum + Number((root.counts as { items: number }).items || 0), 0),
            available: state.roots.length,
          },
          readOnly: state.readOnly,
          startupWarning: state.startupWarning,
        };
      }
      if (method === "scan.status") {
        const gate = statusGate;
        statusGate = null;
        if (gate) await gate;
        return state.scan;
      }
      if (method === "roots.preflight") return state.preflight(params);
      if (method === "roots.series") return state.series(params);
      if (method === "roots.order") {
        const ids = Array.isArray(params?.ids) ? (params.ids as string[]) : [];
        state.roots = ids
          .map((id) => state.roots.find((root) => root.id === id))
          .filter((root): root is RootJson => !!root);
        return { ok: true };
      }
      if (method === "roots.update") {
        const root = state.roots.find((item) => item.id === params?.id);
        if (root) {
          if (typeof params?.label === "string") root.label = params.label;
          if (typeof params?.enabled === "boolean") root.enabled = params.enabled;
          if (params?.options && typeof params.options === "object") root.options = params.options;
          if (typeof params?.path === "string") {
            root.path = params.path;
            root.displayPath = params.path;
          }
        }
        return { ok: true };
      }
      if (method === "roots.remove") {
        state.roots = state.roots.filter((item) => item.id !== params?.id);
        return { ok: true };
      }
      if (method === "roots.add") {
        state.roots.push(
          makeRoot({
            id: "root-new",
            label: typeof params?.label === "string" ? params.label : "picked",
            path: String(params?.path || ""),
            displayPath: String(params?.path || ""),
            counts: { items: 1, files: 2, series: 0, html: 1, mhtml: 0, markdown: 0 },
          }),
        );
        return { ok: true };
      }
      if (method === "roots.rescan" || method === "scan.all" || method === "system.clearCache") return { ok: true };
      throw new Error("未预期的调用 " + method);
    }),
    on(event: "scan-progress" | "library-changed" | "worker-status", callback: (payload: unknown) => void) {
      listeners[event].add(callback);
      return () => listeners[event].delete(callback);
    },
    emit(event: "scan-progress" | "library-changed" | "worker-status", payload: unknown) {
      for (const callback of [...listeners[event]]) callback(payload);
    },
  };
  Object.defineProperty(window, "pageshelf", { configurable: true, value: api });
  return api;
}

function scanCalls(api: ReturnType<typeof createHarness>) {
  return api.calls.filter((call) => call.method === "roots.rescan" || call.method === "scan.all");
}

function rootNav(id: string) {
  const node = document.querySelector('[data-root-id="' + id + '"] .root-nav');
  if (!(node instanceof HTMLElement)) throw new Error("找不到来源 " + id);
  return node;
}

async function openManager(user: ReturnType<typeof userEvent.setup>, name = "管理") {
  await user.click(screen.getByRole("button", { name }));
  return screen.findByRole("dialog", { name: "目录管理" });
}

function menuLabels() {
  return screen.getAllByRole("menuitem").map((item) => item.textContent);
}

describe("来源侧栏与目录管理", () => {
  beforeEach(() => {
    window.innerWidth = 1440;
    window.dispatchEvent(new Event("resize"));
  });

  it("保留三个入口、废纸篓和清缓存，并记录后续列表的选择", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("不应请求"));
    const api = createHarness();
    const user = userEvent.setup();
    render(<App />);
    const sidebar = screen.getByRole("complementary", { name: "来源目录" });
    expect(await within(sidebar).findByText("甲")).toBeInTheDocument();
    const allSources = within(sidebar).getByRole("button", { name: /全部来源/ });
    expect(allSources).toHaveTextContent("可用 3");
    expect(allSources).toHaveTextContent("扫描 4");
    expect(rootNav("root-a")).toHaveTextContent("~/a");
    expect(rootNav("root-a")).toHaveTextContent("正常");
    expect(rootNav("root-a")).toHaveTextContent("扫描 4");
    expect(rootNav("root-a")).toHaveTextContent("可用 3");
    expect(within(sidebar).getByText("上次 " + formatDate("2026-01-02T00:00:00.000Z"))).toBeInTheDocument();
    expect(screen.getByText("选择来源后显示资料")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(document.querySelector("#list-pane input")).toBeNull();

    const list = screen.getByRole("region", { name: "资料列表" });
    expect(list.querySelector("[data-nav-kind]")).toHaveAttribute("data-nav-kind", "all");
    expect(list.querySelector("[data-nav-kind]")).toHaveTextContent("全部来源");

    await user.click(rootNav("root-a"));
    expect(list.querySelector("[data-nav-kind]")).toHaveAttribute("data-nav-kind", "root");
    expect(list.querySelector("[data-nav-kind]")).toHaveAttribute("data-nav-root", "root-a");
    expect(rootNav("root-a")).toHaveAttribute("aria-current", "page");

    await user.click(within(sidebar).getByRole("button", { name: /全部来源/ }));
    expect(list.querySelector("[data-nav-kind]")).toHaveAttribute("data-nav-kind", "all");

    const manager = await openManager(user, "管理");
    expect(within(manager).getByLabelText("目录路径")).not.toHaveFocus();
    await user.click(within(manager).getByRole("button", { name: "打开废纸篓" }));
    await waitFor(() => expect(api.openTrash).toHaveBeenCalled());
    await user.click(within(manager).getByRole("button", { name: "清除缓存" }));
    await screen.findByText("正文缓存已清除");
    expect(api.calls.some((call) => call.method === "system.clearCache")).toBe(true);
    await user.click(within(manager).getByRole("button", { name: "完成" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "目录管理" })).toBeNull());

    const add = await openManager(user, "＋ 添加目录");
    expect(within(add).getByLabelText("目录路径")).toHaveFocus();
    await user.click(within(add).getByRole("button", { name: "完成" }));
    await openManager(user, "⚙ 设置");
    expect(screen.getByRole("dialog", { name: "目录管理" })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("按中文数字排序系列，先显示 12 项，并选择系列", async () => {
    const api = createHarness();
    api.state.series = () => ({
      series: Array.from({ length: 14 }, (_, index) => ({
        key: "k" + (14 - index),
        name: "系列" + (14 - index),
        total: 14 - index,
      })),
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("甲");
    const chevron = screen.getByRole("button", { name: "展开 甲" });
    expect(chevron).toHaveAttribute("aria-expanded", "false");
    await user.click(chevron);
    expect(chevron).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(document.querySelector('[data-series-key="k1"]')).not.toBeNull());
    const first = document.querySelector('[data-series-key="k1"]') as HTMLElement;
    const keys = [...document.querySelectorAll("[data-series-key]")].map((node) => node.getAttribute("data-series-key"));
    expect(keys).toEqual(["k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8", "k9", "k10", "k11", "k12"]);
    expect(document.querySelector('[data-series-key="k13"]')).toBeNull();
    await user.click(screen.getByRole("button", { name: "更多 2 个" }));
    expect(document.querySelector('[data-series-key="k13"]')).not.toBeNull();
    expect(document.querySelector('[data-series-key="k14"]')).not.toBeNull();
    await user.click(first);
    const line = screen.getByRole("region", { name: "资料列表" }).querySelector("[data-nav-kind]");
    expect(line).toHaveAttribute("data-nav-kind", "series");
    expect(line).toHaveAttribute("data-nav-root", "root-a");
    expect(line).toHaveAttribute("data-nav-series", "k1");
    expect(line).toHaveTextContent("系列1");
    expect(first).toHaveAttribute("aria-current", "page");
    expect(api.calls.filter((call) => call.method === "roots.series").length).toBeGreaterThan(0);
  });

  it("失效或停用的来源不加载系列", async () => {
    const api = createHarness([
      makeRoot({ id: "root-missing", label: "缺", state: { status: "missing", message: null, excludes: [], lastScan: null, issues: [] } }),
    ]);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("缺");
    await user.click(screen.getByRole("button", { name: "展开 缺" }));
    expect(api.calls.some((call) => call.method === "roots.series")).toBe(false);
    expect(screen.queryByText("正在读取系列…")).toBeNull();
  });

  it("预检展示有效、无效、重复和重叠，改表单后必须再次确认", async () => {
    const api = createHarness();
    let generation = 0;
    let shiftMode: "stable" | "once" | "changed" = "stable";
    api.state.preflight = (params) => {
      generation += 1;
      const path = String(params?.path || "");
      if (path === "/tmp/missing") return { valid: false, path, errors: [{ message: "不是文件夹" }], duplicateLabel: false, overlap: null };
      if (path === "/tmp/a") return { valid: false, path, errors: [{ code: "ROOT_EXISTS", message: "该目录已经添加" }], duplicateLabel: false, overlap: null };
      if (path === "/tmp/same-name") {
        return validPreview(path, { files: 4, items: 2 }, { duplicateLabel: true, label: "甲" });
      }
      if (path === "/tmp/child") {
        return validPreview(path, { files: 6, items: 5 }, {
          overlap: {
            message: "5 条资料将归属新目录，父目录剩余 3 条；系列将重新计算",
            moved: generation === 1 ? 5 : 9,
            parentAfter: 3,
            parentId: "root-a",
            parentLabel: "甲",
            affectedSeries: [{ name: "系列甲", count: 2 }],
            children: [{ id: "root-child", label: "子目录" }],
          },
        });
      }
      if (path === "/tmp/shift") {
        if (shiftMode === "once") {
          shiftMode = "changed";
          return validPreview(path, { files: 9, items: 4 });
        }
        if (shiftMode === "changed") return validPreview(path, { files: 9, items: 4 });
        return validPreview(path, { files: 2, items: 1 });
      }
      return validPreview(path, { files: 2, items: 1 });
    };
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("甲");
    const dialog = await openManager(user, "＋ 添加目录");
    const path = within(dialog).getByLabelText("目录路径");
    const label = within(dialog).getByLabelText("新目录显示名");
    const add = within(dialog).getByRole("button", { name: "添加目录" });
    expect(add).toBeDisabled();

    fireEvent.change(path, { target: { value: "/tmp/missing" } });
    expect(add).toBeDisabled();
    expect(await screen.findByText("不是文件夹")).toBeInTheDocument();
    expect(add).toBeDisabled();
    expect(api.calls.some((call) => call.method === "roots.add")).toBe(false);

    fireEvent.change(path, { target: { value: "/tmp/a" } });
    expect(add).toBeDisabled();
    expect(await screen.findByText("该目录已经添加")).toBeInTheDocument();
    expect(api.calls.some((call) => call.method === "roots.add")).toBe(false);

    fireEvent.change(path, { target: { value: "/tmp/same-name" } });
    fireEvent.change(label, { target: { value: "甲" } });
    expect(await screen.findByText("显示名与其他目录相同；资料仍按路径区分。")).toBeInTheDocument();
    expect(await screen.findByText("4 个文件 · 2 条资料")).toBeInTheDocument();
    await waitFor(() => expect(add).toBeEnabled());

    fireEvent.change(path, { target: { value: "/tmp/child" } });
    expect(add).toBeDisabled();
    expect(await screen.findByText("5 条资料将归属新目录，父目录剩余 3 条；系列将重新计算")).toBeInTheDocument();
    expect(screen.getByText(/将重新计算：系列甲（2 篇）/)).toBeInTheDocument();
    expect(screen.getByText(/子目录仍独立：子目录/)).toBeInTheDocument();
    await waitFor(() => expect(add).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "不添加，查看父目录" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const line = screen.getByRole("region", { name: "资料列表" }).querySelector("[data-nav-kind]");
    expect(line).toHaveAttribute("data-nav-kind", "root");
    expect(line).toHaveAttribute("data-nav-root", "root-a");
    expect(api.calls.some((call) => call.method === "roots.add")).toBe(false);

    const again = await openManager(user, "＋ 添加目录");
    fireEvent.change(within(again).getByLabelText("目录路径"), { target: { value: "/tmp/shift" } });
    expect(await within(again).findByText("2 个文件 · 1 条资料")).toBeInTheDocument();
    const addAgain = within(again).getByRole("button", { name: "添加目录" });
    await waitFor(() => expect(addAgain).toBeEnabled());
    fireEvent.change(within(again).getByLabelText("新目录显示名"), { target: { value: "笔记" } });
    expect(addAgain).toBeDisabled();
    await waitFor(() => expect(addAgain).toBeEnabled());
    shiftMode = "once";
    await user.click(addAgain);
    expect(await screen.findByText("目录内容或归属已变化，请查看更新后的结果，再次点击添加。")).toBeInTheDocument();
    expect(screen.getByText("9 个文件 · 4 条资料")).toBeInTheDocument();
    expect(api.calls.some((call) => call.method === "roots.add")).toBe(false);
    await user.click(addAgain);
    await waitFor(() => expect(api.calls.some((call) => call.method === "roots.add")).toBe(true));
    const added = api.calls.find((call) => call.method === "roots.add");
    expect(added?.params).toEqual({ path: "/tmp/shift", label: "笔记" });
    expect(await screen.findByText("目录已添加")).toBeInTheDocument();
    expect(scanCalls(api)).toHaveLength(0);
  });

  it("路径和计数不变时，父目录或系列变化仍要再次确认", async () => {
    const message = "5 条资料将归属新目录，父目录剩余 3 条；系列将重新计算";
    const counts = { files: 6, items: 5 };
    const shown: Preflight = {
      valid: true,
      path: "/tmp/impact",
      label: "impact",
      counts,
      errors: [],
      duplicateLabel: false,
      overlap: {
        message,
        moved: 5,
        parentAfter: 3,
        parentId: "root-a",
        parentLabel: "甲",
        affectedSeries: [{ name: "系列甲", count: 2 }],
        children: [{ id: "root-child", label: "子目录" }],
      },
    };
    const changed: Preflight = {
      ...shown,
      overlap: {
        message,
        moved: 5,
        parentAfter: 3,
        parentId: "root-b",
        parentLabel: "乙",
        affectedSeries: [{ name: "系列乙", count: 2 }],
        children: [{ id: "root-other", label: "另一子目录" }],
      },
    };
    const oldFingerprint = (value: Preflight) =>
      JSON.stringify([value.path ?? null, value.counts ?? null, value.overlap?.moved ?? null, value.overlap?.parentAfter ?? null]);
    const shownPrint = preflightFingerprint(shown);
    expect(oldFingerprint(shown)).toBe(oldFingerprint(changed));
    expect(preflightFingerprint(parsePreflight(shown))).not.toBe(preflightFingerprint(parsePreflight(changed)));
    expect(preflightFingerprint({ ...shown, counts: { items: 5, files: 6 } })).toBe(shownPrint);
    const overlap = shown.overlap;
    if (!overlap) throw new Error("缺少重叠预检");
    for (const next of [
      { ...shown, valid: false },
      { ...shown, label: "别名" },
      { ...shown, duplicateLabel: true },
      { ...shown, errors: [{ code: "ROOT_MISSING", message: "不是文件夹" }] },
      { ...shown, overlap: { ...overlap, message: "另一段说明" } },
      { ...shown, overlap: { ...overlap, parentId: "root-b" } },
      { ...shown, overlap: { ...overlap, parentLabel: "乙" } },
      { ...shown, overlap: { ...overlap, affectedSeries: [{ name: "系列乙", count: 2 }] } },
      { ...shown, overlap: { ...overlap, affectedSeries: [{ name: "系列甲", count: 9 }] } },
      { ...shown, overlap: { ...overlap, children: [{ id: "root-other", label: "子目录" }] } },
      { ...shown, overlap: { ...overlap, children: [{ id: "root-child", label: "另一子目录" }] } },
      { ...shown, overlap: null },
    ]) {
      expect(preflightFingerprint(next)).not.toBe(shownPrint);
    }
    expect(
      preflightFingerprint({
        ...shown,
        overlap: { ...overlap, affectedSeries: undefined, children: undefined },
      }),
    ).toBe(
      preflightFingerprint({
        ...shown,
        overlap: { ...overlap, affectedSeries: [], children: [] },
      }),
    );

    const api = createHarness();
    let calls = 0;
    api.state.preflight = () => {
      calls += 1;
      return calls === 1 ? shown : changed;
    };
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("甲");
    const dialog = await openManager(user, "＋ 添加目录");
    fireEvent.change(within(dialog).getByLabelText("目录路径"), { target: { value: "/tmp/impact" } });
    expect(await screen.findByText("6 个文件 · 5 条资料")).toBeInTheDocument();
    expect(screen.getByText(/将重新计算：系列甲（2 篇）/)).toBeInTheDocument();
    expect(screen.getByText(/子目录仍独立：子目录/)).toBeInTheDocument();
    const add = within(dialog).getByRole("button", { name: "添加目录" });
    await waitFor(() => expect(add).toBeEnabled());
    await user.click(add);
    expect(await screen.findByText("目录内容或归属已变化，请查看更新后的结果，再次点击添加。")).toBeInTheDocument();
    expect(screen.getByText(/将重新计算：系列乙（2 篇）/)).toBeInTheDocument();
    expect(screen.getByText(/子目录仍独立：另一子目录/)).toBeInTheDocument();
    expect(screen.getByText("6 个文件 · 5 条资料")).toBeInTheDocument();
    expect(screen.queryByText(/系列甲/)).toBeNull();
    expect(api.calls.some((call) => call.method === "roots.add" || call.method === "roots.update")).toBe(false);
    await user.click(add);
    await waitFor(() => expect(api.calls.some((call) => call.method === "roots.add")).toBe(true));
    expect(api.calls.find((call) => call.method === "roots.add")?.params).toEqual({ path: "/tmp/impact" });
    expect(api.calls.some((call) => call.method === "roots.update")).toBe(false);
  });

  it("留空显示名交给服务取目录基名，超过 40 个码点不能添加", async () => {
    const api = createHarness();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("甲");
    const dialog = await openManager(user, "＋ 添加目录");
    fireEvent.change(within(dialog).getByLabelText("目录路径"), { target: { value: "/tmp/books" } });
    expect(await screen.findByText("2 个文件 · 1 条资料")).toBeInTheDocument();
    const add = within(dialog).getByRole("button", { name: "添加目录" });
    await waitFor(() => expect(add).toBeEnabled());
    await user.click(add);
    await waitFor(() => expect(api.calls.some((call) => call.method === "roots.add")).toBe(true));
    expect(api.calls.find((call) => call.method === "roots.add")?.params).toEqual({ path: "/tmp/books" });

    fireEvent.change(within(dialog).getByLabelText("目录路径"), { target: { value: "/tmp/long" } });
    fireEvent.change(within(dialog).getByLabelText("新目录显示名"), { target: { value: "书".repeat(41) } });
    expect(await screen.findByText("目录名称需为 1–40 个字符")).toBeInTheDocument();
    expect(add).toBeDisabled();
    expect(api.calls.filter((call) => call.method === "roots.add")).toHaveLength(1);

    fireEvent.change(within(dialog).getByLabelText("新目录显示名"), { target: { value: "书".repeat(40) } });
    await waitFor(() => expect(add).toBeEnabled());
  });

  it("原生选择写入路径，取消则不预检", async () => {
    const api = createHarness();
    api.pickFolder.mockResolvedValueOnce({ cancelled: true });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("甲");
    const dialog = await openManager(user, "＋ 添加目录");
    await user.click(within(dialog).getByRole("button", { name: "选择文件夹…" }));
    await waitFor(() => expect(api.pickFolder).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(within(dialog).getByLabelText("目录路径")).toHaveValue("");
    expect(api.calls.some((call) => call.method === "roots.preflight")).toBe(false);

    api.pickFolder.mockResolvedValueOnce({ cancelled: false, path: "/data/picked" });
    await user.click(within(dialog).getByRole("button", { name: "选择文件夹…" }));
    await waitFor(() => expect(within(dialog).getByLabelText("目录路径")).toHaveValue("/data/picked"));
    expect(await screen.findByText("2 个文件 · 1 条资料")).toBeInTheDocument();
    expect(api.calls.some((call) => call.method === "roots.preflight" && call.params?.path === "/data/picked")).toBe(true);
  });

  it("重新定位在内容变化时不直接保存", async () => {
    const api = createHarness();
    let calls = 0;
    api.state.preflight = (params) => {
      calls += 1;
      expect(params?.excludeId).toBe("root-a");
      return validPreview(String(params?.path || ""), calls === 1 ? { files: 2, items: 1 } : { files: 8, items: 6 });
    };
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("甲");
    await openManager(user);
    await user.click(screen.getByRole("button", { name: "甲目录操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "重新定位…" }));
    const relocate = await screen.findByRole("dialog", { name: "重新定位 · 甲" });
    expect(within(relocate).getByLabelText("新目录路径")).toHaveValue("/tmp/a");
    expect(await within(relocate).findByText("2 个文件 · 1 条资料")).toBeInTheDocument();
    await user.click(within(relocate).getByRole("button", { name: "重新定位" }));
    expect(await screen.findByText("归属已变化，请再次确认：6 条资料")).toBeInTheDocument();
    expect(api.calls.some((call) => call.method === "roots.update")).toBe(false);
    await user.click(within(relocate).getByRole("button", { name: "重新定位" }));
    await waitFor(() =>
      expect(api.calls.some((call) => call.method === "roots.update" && call.params?.path === "/tmp/a")).toBe(true),
    );
    const update = api.calls.find((call) => call.method === "roots.update");
    expect(update?.params).toEqual({ id: "root-a", path: "/tmp/a" });
    expect(await screen.findByText("目录位置已更新，条目 ID 保持不变")).toBeInTheDocument();
    expect(scanCalls(api)).toHaveLength(0);
  });

  it("管理菜单和侧栏菜单保持动作差异", async () => {
    const api = createHarness([
      makeRoot(),
      makeRoot({
        id: "root-missing",
        label: "缺",
        path: "/tmp/missing",
        displayPath: "~/missing",
        state: { status: "missing", message: "目录不存在", excludes: [], lastScan: null, issues: [] },
        counts: { items: 0, files: 0, series: 0, html: 0, mhtml: 0, markdown: 0 },
      }),
    ]);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("甲");
    await user.click(screen.getByRole("button", { name: "甲操作" }));
    expect(menuLabels()).toEqual(["重扫此目录", "重命名", "在访达中显示", "停用", "移除…"]);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    fireEvent.contextMenu(document.querySelector('[data-root-id="root-missing"]') as HTMLElement);
    expect(menuLabels()).toEqual(["重扫此目录", "重命名", "在访达中显示", "重新定位…", "停用", "移除…"]);
    expect(screen.queryByRole("menuitem", { name: "全量重扫" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "关闭系列识别" })).toBeNull();
    await user.keyboard("{Escape}");

    await openManager(user);
    expect(screen.getByText("2 HTML · 1 MHTML · 1 MD")).toBeInTheDocument();
    expect(screen.getByText("3 条")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "甲目录操作" }));
    expect(menuLabels()).toEqual(["增量重扫", "全量重扫", "重新定位…", "停用", "关闭系列识别", "在访达中显示", "移除…"]);
    await user.click(screen.getByRole("menuitem", { name: "增量重扫" }));
    await waitFor(() =>
      expect(api.calls.some((call) => call.method === "roots.rescan" && call.params?.full === false)).toBe(true),
    );
    await user.click(screen.getByRole("button", { name: "甲目录操作" }));
    await user.click(screen.getByRole("menuitem", { name: "全量重扫" }));
    await waitFor(() =>
      expect(api.calls.some((call) => call.method === "roots.rescan" && call.params?.id === "root-a" && call.params?.full === true)).toBe(true),
    );
    await user.click(screen.getByRole("button", { name: "甲目录操作" }));
    await user.click(screen.getByRole("menuitem", { name: "关闭系列识别" }));
    await waitFor(() =>
      expect(
        api.calls.some(
          (call) =>
            call.method === "roots.update" &&
            (call.params?.options as { series?: string } | undefined)?.series === "off",
        ),
      ).toBe(true),
    );
    expect(await screen.findByRole("button", { name: "甲目录操作" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "甲目录操作" }));
    expect(screen.getByRole("menuitem", { name: "启用系列识别" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "停用" }));
    await waitFor(() =>
      expect(api.calls.some((call) => call.method === "roots.update" && call.params?.enabled === false)).toBe(true),
    );
    await user.click(screen.getByRole("button", { name: "甲目录操作" }));
    await user.click(screen.getByRole("menuitem", { name: "在访达中显示" }));
    await waitFor(() => expect(api.revealInFinder).toHaveBeenCalledWith({ rootId: "root-a" }));

    await user.click(screen.getByRole("button", { name: "全部重扫" }));
    await user.click(screen.getByRole("button", { name: "全量重扫" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "scan.all" && call.params?.full === true)).toBe(true));
    expect(api.calls.some((call) => call.method === "scan.all" && call.params?.full === false)).toBe(true);
  });

  it("移除前使用应用内危险确认，取消不删除索引", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const api = createHarness();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("甲");
    await user.click(rootNav("root-a"));
    await user.click(screen.getByRole("button", { name: "甲操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "移除…" }));
    const dialog = await screen.findByRole("dialog", { name: "移除来源目录？" });
    expect(dialog).toHaveTextContent("将取消“甲”的索引。源文件保留在 /tmp/a。");
    const cancel = within(dialog).getByRole("button", { name: "取消" });
    await waitFor(() => expect(cancel).toHaveFocus());
    expect(within(dialog).getByRole("button", { name: "移除" })).toHaveClass("button-danger");
    await user.click(cancel);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "移除来源目录？" })).toBeNull());
    expect(api.calls.some((call) => call.method === "roots.remove")).toBe(false);

    await user.click(screen.getByRole("button", { name: "甲操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "移除…" }));
    await user.click(await screen.findByRole("button", { name: "移除" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "roots.remove" && call.params?.id === "root-a")).toBe(true));
    expect(await screen.findByText("来源目录已移除")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "资料列表" }).querySelector("[data-nav-kind]")).toHaveAttribute("data-nav-kind", "all");
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("改名和排序不触发重扫，拖放与拖柄方向键可用，只读不可排序", async () => {
    const api = createHarness([
      makeRoot(),
      makeRoot({ id: "root-b", label: "乙", path: "/tmp/b", displayPath: "~/b" }),
    ]);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("乙");
    fireEvent.doubleClick(rootNav("root-a"));
    const inline = await screen.findByRole("textbox", { name: "目录名称" });
    await user.clear(inline);
    await user.type(inline, "新甲");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(api.calls.some((call) => call.method === "roots.update" && call.params?.label === "新甲")).toBe(true));
    expect(api.calls.find((call) => call.method === "roots.update" && call.params?.label === "新甲")?.params).toEqual({
      id: "root-a",
      label: "新甲",
    });
    expect(scanCalls(api)).toHaveLength(0);

    fireEvent.doubleClick(rootNav("root-b"));
    const second = await screen.findByRole("textbox", { name: "目录名称" });
    await user.type(second, "临时");
    await user.keyboard("{Escape}");
    expect(api.calls.some((call) => call.method === "roots.update" && String(call.params?.label || "").includes("临时"))).toBe(false);

    const dialog = await openManager(user);
    const label = within(dialog).getByLabelText("新甲显示名");
    label.focus();
    fireEvent.keyDown(label, { key: "ArrowDown", altKey: true });
    expect(api.calls.some((call) => call.method === "roots.order")).toBe(false);
    fireEvent.change(label, { target: { value: "手册" } });
    fireEvent.blur(label);
    await waitFor(() => expect(api.calls.some((call) => call.method === "roots.update" && call.params?.label === "手册")).toBe(true));
    expect(scanCalls(api)).toHaveLength(0);

    const handles = within(dialog).getAllByRole("button", { name: "拖动或 Alt 加方向键排序" });
    handles[1].focus();
    fireEvent.keyDown(handles[1], { key: "ArrowUp", altKey: true });
    await waitFor(() =>
      expect(api.calls.some((call) => call.method === "roots.order" && JSON.stringify(call.params?.ids) === JSON.stringify(["root-b", "root-a"]))).toBe(true),
    );
    expect(scanCalls(api)).toHaveLength(0);
    const rows = [...dialog.querySelectorAll("[data-manager-root]")].map((node) => node.getAttribute("data-manager-root"));
    expect(rows).toEqual(["root-b", "root-a"]);

    const dataTransfer = {
      store: new Map<string, string>(),
      setData(type: string, value: string) {
        this.store.set(type, value);
      },
      getData(type: string) {
        return this.store.get(type) || "";
      },
      effectAllowed: "move",
      dropEffect: "move",
    };
    const handle = within(dialog).getAllByRole("button", { name: "拖动或 Alt 加方向键排序" })[0];
    const target = dialog.querySelector('[data-manager-root="root-a"]') as HTMLElement;
    for (const type of ["dragstart", "dragover", "drop"] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
      (type === "dragstart" ? handle : target).dispatchEvent(event);
    }
    await waitFor(() =>
      expect(api.calls.some((call) => call.method === "roots.order" && JSON.stringify(call.params?.ids) === JSON.stringify(["root-a", "root-b"]))).toBe(true),
    );
    expect(scanCalls(api)).toHaveLength(0);
  });

  it("只读时禁用写操作，仍可浏览、重扫和清缓存", async () => {
    const api = createHarness([makeRoot(), makeRoot({ id: "root-b", label: "乙", path: "/tmp/b", displayPath: "~/b" })]);
    api.state.readOnly = true;
    api.state.startupWarning = "配置来自旧版本。";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("甲");
    fireEvent.doubleClick(rootNav("root-a"));
    expect(screen.queryByRole("textbox", { name: "目录名称" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "甲操作" }));
    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "停用" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "移除…" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "重扫此目录" })).toBeEnabled();
    await user.click(screen.getByRole("menuitem", { name: "重扫此目录" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "roots.rescan")).toBe(true));

    const dialog = await openManager(user);
    expect(within(dialog).getByText("配置来自旧版本。")).toBeInTheDocument();
    expect(within(dialog).getByText("当前配置为只读，仍可浏览资料、重扫和清理缓存。")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("目录路径")).toBeDisabled();
    expect(within(dialog).getByLabelText("新目录显示名")).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "选择文件夹…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "添加目录" })).toBeDisabled();
    expect(within(dialog).getByLabelText("甲显示名")).toBeDisabled();
    const handle = within(dialog).getAllByRole("button", { name: "拖动或 Alt 加方向键排序" })[1];
    expect(handle).toBeDisabled();
    expect(handle).toHaveAttribute("draggable", "false");
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowUp", altKey: true });
    expect(api.calls.some((call) => call.method === "roots.order")).toBe(false);
    expect(within(dialog).getByRole("button", { name: "全部重扫" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "清除缓存" })).toBeEnabled();
    await user.click(within(dialog).getByRole("button", { name: "清除缓存" }));
    expect(await screen.findByText("正文缓存已清除")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "甲目录操作" }));
    expect(screen.getByRole("menuitem", { name: "增量重扫" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "重新定位…" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "关闭系列识别" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "在访达中显示" })).toBeEnabled();
  });

  it("用扫描事件更新进度和问题，不轮询，也不覆盖正在编辑的名称", async () => {
    const api = createHarness([
      makeRoot({
        state: {
          status: "missing",
          message: "目录不存在",
          excludes: ["nested"],
          lastScan: null,
          issues: [{ path: "/tmp/a/bad.html", message: "无法读取" }],
        },
      }),
    ]);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("目录不存在");
    const before = api.calls.filter((call) => call.method === "roots.list").length;
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(api.calls.filter((call) => call.method === "roots.list")).toHaveLength(before);

    api.emit("scan-progress", { running: [{ rootId: "root-a", files: { done: 2, total: 10 } }], queued: [] });
    const progress = await screen.findByText("扫描中 2/10");
    expect(progress).toHaveAttribute("data-scan-progress", "2/10");
    expect(screen.getByText("目录不存在")).toBeInTheDocument();
    expect(screen.getAllByText("目录不存在").length).toBeGreaterThan(0);
    expect(document.querySelector('[data-status="missing"]')).not.toBeNull();

    api.emit("scan-progress", { running: [], queued: [{ rootId: "root-a", position: 1 }] });
    expect(await screen.findByText("排队中")).toBeInTheDocument();
    expect(screen.getByText("目录不存在")).toBeInTheDocument();

    const dialog = await openManager(user);
    expect(within(dialog).getByText("排除 1 个子目录")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "1 个问题" }));
    const issues = await screen.findByRole("dialog", { name: "扫描问题 · 甲" });
    expect(issues).toHaveTextContent("/tmp/a/bad.html：无法读取");
    await user.click(within(issues).getByRole("button", { name: "关闭弹窗" }));

    const input = within(dialog).getByLabelText("甲显示名");
    input.focus();
    fireEvent.change(input, { target: { value: "甲乙" } });
    api.state.roots[0].label = "服务器名";
    api.emit("library-changed", { reason: "roots.update" });
    await waitFor(() => expect(api.calls.filter((call) => call.method === "roots.list").length).toBeGreaterThan(before));
    expect(input).toHaveValue("甲乙");
    expect(input).toHaveFocus();

    api.state.roots[0].state = {
      status: "warning",
      message: "有问题",
      excludes: [],
      lastScan: null,
      issues: [{ path: "/tmp/a/bad.html", message: "无法读取" }],
    };
    api.emit("scan-progress", { running: [{ rootId: "root-a", files: { done: 1, total: 4 } }], queued: [] });
    await waitFor(() => expect(document.querySelectorAll('[data-scan-progress="1/4"]').length).toBeGreaterThan(0));
    api.emit("scan-progress", { running: [], queued: [] });
    expect(await screen.findByText("扫描完成，发现 1 个问题")).toBeInTheDocument();
  });

  it("worker 恢复后重新读取来源，过期的扫描状态不能盖住进度", async () => {
    const api = createHarness();
    api.state.failList = 1;
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("读取失败");
    api.emit("worker-status", { state: "ready" });
    expect(await screen.findByText("甲")).toBeInTheDocument();
    expect(screen.queryByText("读取失败")).toBeNull();

    const release = api.holdNextStatus();
    const statusCalls = api.calls.filter((call) => call.method === "scan.status").length;
    api.emit("worker-status", { state: "ready" });
    await waitFor(() => expect(api.calls.filter((call) => call.method === "scan.status").length).toBeGreaterThan(statusCalls));
    api.emit("scan-progress", { running: [{ rootId: "root-a", files: { done: 3, total: 10 } }], queued: [] });
    expect(await screen.findByText("扫描中 3/10")).toBeInTheDocument();
    release({ running: [], queued: [] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText("扫描中 3/10")).toBeInTheDocument();
  });

  it("同名来源显示路径差异，主题切换不被目录界面清掉", async () => {
    const api = createHarness([
      makeRoot({ label: "同名" }),
      makeRoot({ id: "root-b", label: "同名", path: "/tmp/b", displayPath: "~/b" }),
    ]);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findAllByText("同名")).toHaveLength(2);
    const dialog = await openManager(user);
    expect(within(dialog).getAllByText("显示名相同")).toHaveLength(2);
    expect(within(dialog).getByText("~/a")).toBeInTheDocument();
    expect(within(dialog).getByText("~/b")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "暗色" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByText("PageShelf").className).toBe("wordmark");
    expect(screen.getByRole("dialog", { name: "目录管理" })).toBeInTheDocument();
    expect(api.state.readOnly).toBe(false);
  });

  it("新增样式只使用已有 token，对话框宽度保留规范基线", () => {
    const css = readFileSync(path.join(process.cwd(), "src-ui/src/styles/library.css"), "utf8");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/);
    expect(css).not.toMatch(/hsla?\(/);
    expect(css).not.toMatch(/font-size:\s*[0-9]/);
    expect(css).not.toMatch(/font-weight:\s*[0-9]/);
    expect(css).not.toMatch(/(padding|margin|gap):\s*[0-9]+px/);
    expect(css).not.toMatch(/border-radius:\s*[0-9]+px/);
    for (const declaration of css.match(/box-shadow:\s*[^;]+/g) || []) {
      expect(declaration.replace(/\s/g, "")).toContain("var(--");
    }
    expect(css).not.toMatch(/z-index:\s*[0-9]/);
    expect(css.match(/\d+px/g)).toEqual(["480px"]);
    expect(css).toContain("min(480px, 90vw)");
    expect(css).toContain("min(var(--form-width), 90vw)");
  });
});
