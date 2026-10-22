import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import markDark from "../assets/brand/pageshelf-mark-dark.svg";
import mark from "../assets/brand/pageshelf-mark.svg";
import { App } from "./App";

function installApi() {
  Object.defineProperty(window, "pageshelf", {
    configurable: true,
    value: {
      invoke: vi.fn(async () => ({ roots: [] })),
      on: () => () => {},
      pickFolder: async () => ({}),
      revealInFinder: async () => ({}),
      openTrash: async () => ({}),
      openOriginal: async () => ({}),
      openExternal: async () => ({}),
    },
  });
}

function installScheme(prefersDark: boolean) {
  let dark = prefersDark;
  const listeners = new Set<(event: { matches: boolean }) => void>();
  window.matchMedia = ((query: string) => {
    const relevant = query.replace(/\s/g, "").includes("prefers-color-scheme:dark");
    return {
      get matches() {
        return relevant ? dark : false;
      },
      media: query,
      onchange: null,
      addEventListener(_type: string, listener: (event: { matches: boolean }) => void) {
        if (relevant) listeners.add(listener);
      },
      removeEventListener(_type: string, listener: (event: { matches: boolean }) => void) {
        listeners.delete(listener);
      },
      dispatchEvent() {
        return false;
      },
      addListener() {},
      removeListener() {},
    };
  }) as unknown as typeof window.matchMedia;
  return {
    set(next: boolean) {
      dark = next;
      for (const listener of listeners) listener({ matches: next });
    },
  };
}

function setWidth(width: number) {
  window.innerWidth = width;
  window.dispatchEvent(new Event("resize"));
}

describe("PageShelf shell", () => {
  beforeEach(() => {
    installApi();
    installScheme(false);
    setWidth(1440);
  });

  it("shows three named panes, a skip link, and the empty source list", async () => {
    render(<App />);
    expect(screen.getByRole("link", { name: "跳到阅读区" })).toHaveAttribute("href", "#reader-pane");
    expect(screen.getByRole("complementary", { name: "来源目录" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "资料列表" })).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "阅读区" })).toHaveAttribute("id", "reader-pane");
    expect(await screen.findByText("还没有来源目录")).toBeInTheDocument();
    expect(screen.getByText("PageShelf").className).toBe("wordmark");
  });

  it("persists theme choices, ignores bad values, and follows the system only in system mode", async () => {
    localStorage.setItem("ui.theme", "nope");
    const scheme = installScheme(false);
    render(<App />);
    const system = screen.getByRole("radio", { name: "跟随系统" });
    const light = screen.getByRole("radio", { name: "亮色" });
    const dark = screen.getByRole("radio", { name: "暗色" });
    expect(system).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.dataset.theme).toBe("light");

    await act(async () => {
      scheme.set(true);
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("ui.theme")).toBe("system");

    fireEvent.click(light);
    expect(light).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("ui.theme")).toBe("light");
    await act(async () => {
      scheme.set(true);
    });
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.click(dark);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.querySelector(".brand-mark")?.getAttribute("src")).toBe(markDark);
    fireEvent.click(light);
    expect(document.querySelector(".brand-mark")?.getAttribute("src")).toBe(mark);
    fireEvent.click(dark);
    expect(localStorage.getItem("ui.theme")).toBe("dark");

    fireEvent.keyDown(document.body, { key: "t" });
    expect(localStorage.getItem("ui.theme")).toBe("dark");
    expect(dark).toHaveAttribute("aria-checked", "true");
  });

  it("steps, clamps, drags, resets, and restores pane widths", () => {
    localStorage.setItem("ui.paneWidths", "[10,900]");
    render(<App />);
    const side = screen.getByRole("separator", { name: "调整目录栏宽度" });
    const list = screen.getByRole("separator", { name: "调整列表栏宽度" });
    expect(side).toHaveAttribute("aria-valuenow", "200");
    expect(side).toHaveAttribute("aria-valuemin", "200");
    expect(side).toHaveAttribute("aria-valuemax", "320");
    expect(list).toHaveAttribute("aria-valuenow", "520");
    expect(list).toHaveAttribute("aria-valuemin", "320");
    expect(list).toHaveAttribute("aria-valuemax", "520");

    fireEvent.keyDown(side, { key: "ArrowRight" });
    expect(side).toHaveAttribute("aria-valuenow", "216");
    fireEvent.keyDown(side, { key: "ArrowLeft" });
    fireEvent.keyDown(side, { key: "ArrowLeft" });
    expect(side).toHaveAttribute("aria-valuenow", "200");

    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(list).toHaveAttribute("aria-valuenow", "504");
    for (let step = 0; step < 20; step += 1) fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(list).toHaveAttribute("aria-valuenow", "520");
    expect(localStorage.getItem("ui.paneWidths")).toBe("[200,520]");

    fireEvent.doubleClick(side);
    expect(side).toHaveAttribute("aria-valuenow", "252");
    expect(list).toHaveAttribute("aria-valuenow", "384");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    fireEvent.doubleClick(list);
    expect(localStorage.getItem("ui.paneWidths")).toBe("[252,384]");

    fireEvent.pointerDown(side, { button: 0, clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(side, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(side, { clientX: 100, pointerId: 1 });
    expect(side).toHaveAttribute("aria-valuenow", "320");
  });

  it("falls back to the default panes when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    render(<App />);
    expect(screen.getByRole("separator", { name: "调整目录栏宽度" })).toHaveAttribute("aria-valuenow", "252");
    expect(screen.getByRole("separator", { name: "调整列表栏宽度" })).toHaveAttribute("aria-valuenow", "384");
    expect(screen.getByRole("radio", { name: "跟随系统" })).toHaveAttribute("aria-checked", "true");
    vi.restoreAllMocks();
  });

  it("collapses the sidebar below the reading minimum and keeps 1280 open", () => {
    render(<App />);
    expect(document.querySelector(".app-shell")).toHaveAttribute("data-sidebar", "open");
    act(() => {
      setWidth(1280);
    });
    expect(document.querySelector(".app-shell")).toHaveAttribute("data-sidebar", "open");
    expect(document.documentElement.style.getPropertyValue("--sidebar-width")).toBe("252px");
    act(() => {
      setWidth(960);
    });
    const sidebar = screen.getByRole("complementary", { name: "来源目录" });
    const theme = screen.getByRole("radio", { name: "跟随系统" });
    const light = screen.getByRole("radio", { name: "亮色" });
    expect(document.querySelector(".app-shell")).toHaveAttribute("data-sidebar", "collapsed");
    expect(sidebar).toHaveAttribute("inert");
    expect(screen.queryByRole("separator", { name: "调整目录栏宽度" })).toBeNull();
    expect(document.getElementById("split-side")).toHaveAttribute("tabindex", "-1");
    expect(document.getElementById("split-side")).toHaveAttribute("aria-hidden", "true");
    expect(document.documentElement.style.getPropertyValue("--sidebar-width")).toBe("0px");
    expect(theme.tabIndex).toBe(0);
    expect(light.tabIndex).toBe(-1);
    expect(sidebar.contains(theme)).toBe(false);
    expect(document.querySelector("#sidebar > .titlebar")).not.toBeNull();
    expect(document.querySelector("#list-pane > .titlebar")).not.toBeNull();
    expect(document.querySelector("#reader-pane > .titlebar")).toBeNull();
  });

  it("keeps a wide stored list from covering the reader at 960", () => {
    localStorage.setItem("ui.paneWidths", "[252,520]");
    setWidth(960);
    render(<App />);
    expect(document.documentElement.style.getPropertyValue("--list-width")).toBe("480px");
    expect(screen.getByRole("separator", { name: "调整列表栏宽度" })).toHaveAttribute("aria-valuenow", "520");
    expect(localStorage.getItem("ui.paneWidths")).toBe("[252,520]");
  });

  it("exposes keyboard focus targets in order", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.tab();
    expect(document.activeElement).toHaveTextContent("跳到阅读区");
    await user.tab();
    expect(document.activeElement).toHaveTextContent("全部来源");
    await user.tab();
    expect(document.activeElement).toHaveTextContent("管理");
    await user.tab();
    expect(document.activeElement).toHaveTextContent("＋ 添加目录");
    await user.tab();
    expect(document.activeElement).toHaveTextContent("⚙ 设置");
    await user.tab();
    expect(document.activeElement).toHaveTextContent("↻ 全部重扫");
    await user.tab();
    expect(document.activeElement).toHaveTextContent("跟随系统");
    await user.tab();
    expect(document.activeElement).toHaveAttribute("aria-label", "调整目录栏宽度");
    await user.tab();
    expect(document.activeElement).toHaveAttribute("aria-label", "调整列表栏宽度");
  });

  it("moves the theme radios with arrow keys and selects with space or enter", async () => {
    const user = userEvent.setup();
    render(<App />);
    const system = screen.getByRole("radio", { name: "跟随系统" });
    const light = screen.getByRole("radio", { name: "亮色" });
    const dark = screen.getByRole("radio", { name: "暗色" });
    expect(system).toHaveAttribute("tabindex", "0");
    expect(light).toHaveAttribute("tabindex", "-1");
    expect(dark).toHaveAttribute("tabindex", "-1");

    system.focus();
    await user.keyboard("{ArrowRight}");
    expect(light).toHaveFocus();
    expect(light).toHaveAttribute("aria-checked", "true");
    expect(light).toHaveAttribute("tabindex", "0");
    expect(system).toHaveAttribute("tabindex", "-1");
    expect(localStorage.getItem("ui.theme")).toBe("light");

    await user.keyboard("{ArrowDown}");
    expect(dark).toHaveFocus();
    expect(dark).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{ArrowRight}");
    expect(system).toHaveFocus();
    expect(system).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{ArrowLeft}");
    expect(dark).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(light).toHaveFocus();
    expect(light).toHaveAttribute("aria-checked", "true");

    dark.focus();
    await user.keyboard(" ");
    expect(dark).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("ui.theme")).toBe("dark");

    system.focus();
    await user.keyboard("{Enter}");
    expect(system).toHaveAttribute("aria-checked", "true");
    expect(localStorage.getItem("ui.theme")).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
