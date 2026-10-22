import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { ItemDetail } from "./items";
import { LibraryProvider } from "./library-context";
import { RouterProvider } from "./router";
import { registerShortcuts } from "./shortcuts";
import { TrashDialog } from "./trash-dialog";

describe("keyboard commands", () => {
  it("maps all single-key, shifted and prefixed shortcuts", () => {
    const dispatch = vi.fn(); const stop = registerShortcuts(dispatch);
    const cases = [["/", "focus-search"], ["j", "next-item"], ["k", "previous-item"], ["[", "previous-article"], ["]", "next-article"], ["v", "cycle-view"], ["n", "next-hit"], ["t", "cycle-theme"], ["?", "help"], ["Enter", "open-item"]];
    for (const [key, command] of cases) { fireEvent.keyDown(document.body, { key }); expect(dispatch).toHaveBeenLastCalledWith(command); }
    for (const [key, command] of [["N", "previous-hit"], ["R", "scan-all"], ["M", "manage-roots"]]) { fireEvent.keyDown(document.body, { key, shiftKey: true }); expect(dispatch).toHaveBeenLastCalledWith(command); }
    fireEvent.keyDown(document.body, { key: "g" }); fireEvent.keyDown(document.body, { key: "a" }); expect(dispatch).toHaveBeenLastCalledWith("all-roots");
    fireEvent.keyDown(document.body, { key: "g" }); fireEvent.keyDown(document.body, { key: "9" }); expect(dispatch).toHaveBeenLastCalledWith("root-9"); stop();
  });
  it("expires g at one second and suppresses composing, editable and dialog events", () => {
    const dispatch = vi.fn(); let now = 100; const stop = registerShortcuts(dispatch, () => now);
    fireEvent.keyDown(document.body, { key: "g" }); now = 1100; fireEvent.keyDown(document.body, { key: "a" }); expect(dispatch).not.toHaveBeenCalled();
    const input = document.createElement("input"); document.body.append(input);
    for (const key of ["j", "t", "n", "v", "g", "/", "?"]) fireEvent.keyDown(input, { key });
    const editable = document.createElement("div"); editable.contentEditable = "true"; editable.setAttribute("contenteditable", "true"); document.body.append(editable); fireEvent.keyDown(editable, { key: "j" });
    const dialog = document.createElement("dialog"); dialog.setAttribute("open", ""); document.body.append(dialog); fireEvent.keyDown(document.body, { key: "t" });
    expect(dispatch).not.toHaveBeenCalled(); dialog.remove(); input.remove(); editable.remove();
    fireEvent.keyDown(document.body, { key: "j", isComposing: true }); expect(dispatch).not.toHaveBeenCalled(); stop();
  });
  it("uses Command on macOS and Control elsewhere, and preserves non-search input Escape", () => {
    const dispatch = vi.fn(); let stop = registerShortcuts(dispatch, Date.now, "darwin");
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true }); expect(dispatch).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "k", metaKey: true }); expect(dispatch).toHaveBeenLastCalledWith("focus-search");
    fireEvent.keyDown(document.body, { key: "[", metaKey: true }); expect(dispatch).toHaveBeenLastCalledWith("back"); stop();
    stop = registerShortcuts(dispatch, Date.now, "win32"); fireEvent.keyDown(document.body, { key: "\\", ctrlKey: true }); expect(dispatch).toHaveBeenLastCalledWith("toggle-sidebar");
    const input = document.createElement("input"); document.body.append(input); dispatch.mockClear(); fireEvent.keyDown(input, { key: "Escape" }); expect(dispatch).not.toHaveBeenCalled();
    input.id = "search-input"; fireEvent.keyDown(input, { key: "Escape" }); expect(dispatch).toHaveBeenLastCalledWith("escape-search"); input.remove(); stop();
  });
});

describe("trash confirmation", () => {
  const detail = { item: { id: "item-a", title: "测试文章" }, files: [{ format: "html", path: "/tmp/a.html", size: 10 }, { format: "markdown", path: "/tmp/a.md", size: 20 }], next: null, prev: null, series: null } as ItemDetail;
  function install(readOnly = false, trash = vi.fn(async () => ({ trashed: [], failed: [] }))) {
    window.pageshelf = { invoke: vi.fn(async method => method === "roots.list" ? { roots: [], readOnly } : method === "items.trash" ? trash() : {}), on: () => () => {}, pickFolder: async () => ({}), openTrash: async () => ({}), openExternal: async () => ({}), openOriginal: async () => ({}), revealInFinder: async () => ({}) };
    return trash;
  }
  function show(onClose = vi.fn()) { render(<RouterProvider><LibraryProvider><TrashDialog detail={detail} onClose={onClose} /></LibraryProvider></RouterProvider>); return onClose; }
  it("lists every source and defaults to Cancel without moving files", async () => {
    const trash = install(); const close = show();
    const dialog = screen.getByRole("dialog"); expect(dialog).toHaveTextContent("/tmp/a.html"); expect(dialog).toHaveTextContent("/tmp/a.md");
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" })); expect(close).toHaveBeenCalled(); expect(trash).not.toHaveBeenCalled();
  });
  it("keeps partial failures visible and retries remaining formats", async () => {
    const trash = vi.fn().mockResolvedValueOnce({ trashed: ["/tmp/a.html"], failed: [{ path: "/tmp/a.md", message: "权限不足" }] }).mockResolvedValueOnce({ trashed: ["/tmp/a.md"], failed: [] });
    install(false, trash); const close = show();
    fireEvent.click(screen.getByRole("button", { name: /^移入废纸篓$/ }));
    await screen.findByText(/权限不足/); expect(close).not.toHaveBeenCalled();
    const list = screen.getByRole("list"); expect(list).not.toHaveTextContent("/tmp/a.html"); expect(list).toHaveTextContent("/tmp/a.md");
    fireEvent.click(screen.getByRole("button", { name: "重试剩余文件" })); await waitFor(() => expect(close).toHaveBeenCalled()); expect(trash).toHaveBeenCalledTimes(2);
  });
  it("retains the confirmation on total failure and disables read-only deletion", async () => {
    install(false, vi.fn().mockRejectedValue(new Error("全部失败，文件没有被改动"))); const close = show();
    fireEvent.click(screen.getByRole("button", { name: /^移入废纸篓$/ }));
    await screen.findByText("全部失败，文件没有被改动"); expect(close).not.toHaveBeenCalled();
  });
  it("makes the final action unavailable with a newer read-only configuration", async () => {
    const trash = install(true); show();
    await waitFor(() => expect(screen.getByRole("button", { name: /^移入废纸篓$/ })).toBeDisabled()); expect(trash).not.toHaveBeenCalled();
  });
});

it("connects menu commands and sidebar navigation to the shell", async () => {
  let callback: ((value: unknown) => void) | undefined;
  window.pageshelf = { invoke: vi.fn(async method => method === "items.search" ? { items: [], groups: [], total: 0, roots: 0 } : { roots: [] }), on: (event, listener) => { if (event === "command") callback = listener; return () => {}; }, pickFolder: async () => ({}), openTrash: async () => ({}), openExternal: async () => ({}), openOriginal: async () => ({}), revealInFinder: async () => ({}) };
  render(<App />); fireEvent.keyDown(document.body, { key: "?" });
  expect(screen.getByRole("dialog", { name: "快捷键帮助" })).toHaveTextContent("g 1–9");
  fireEvent.click(screen.getByRole("button", { name: "关闭弹窗" }));
  callback?.({ command: "focus-search" }); expect(screen.getByRole("searchbox")).toHaveFocus();
});
