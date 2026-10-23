import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { Menu } from "./components/menu";
import { LibraryProvider, useLibrary } from "./library-context";
import { RouterProvider } from "./router";

function install(invoke: PageshelfApi["invoke"]) {
  window.pageshelf = { invoke, on: () => () => {}, pickFolder: async () => ({}), openTrash: async () => ({}), openExternal: async () => ({}), openOriginal: async () => ({}), revealInFinder: async () => ({}) };
}

describe("menu dismissal and focus", () => {
  it("moves focus with arrows and returns it on Escape", () => {
    const trigger = document.createElement("button"); document.body.append(trigger);
    const close = vi.fn();
    const { unmount } = render(<Menu items={[{ kind: "item", id: "a", label: "第一项" }, { kind: "item", id: "b", label: "第二项" }]} x={0} y={0} onClose={close} onSelect={() => {}} returnFocus={trigger} />);
    expect(screen.getByRole("menuitem", { name: "第一项" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" }); expect(screen.getByRole("menuitem", { name: "第二项" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" }); expect(close).toHaveBeenCalledTimes(1);
    unmount(); expect(trigger).toHaveFocus(); trigger.remove();
  });
  for (const event of ["outside", "route", "blur"]) it("closes on " + event, () => {
    const close = vi.fn();
    render(<Menu items={[{ kind: "item", id: "a", label: "操作" }]} x={0} y={0} onClose={close} onSelect={() => {}} returnFocus={null} />);
    if (event === "outside") fireEvent.pointerDown(document.body);
    else window.dispatchEvent(new Event(event === "route" ? "pageshelf-route" : "blur"));
    expect(close).toHaveBeenCalledOnce();
  });
});

it("shows a skeleton only for a sustained load and removes it when data arrives", async () => {
  vi.useFakeTimers();
  let release: (result: unknown) => void = () => {};
  const gate = new Promise(resolve => { release = resolve; });
  install(async method => method === "items.search" ? gate : { roots: [] });
  try {
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByLabelText("正在加载资料")).toBeNull();
    await act(async () => { vi.advanceTimersByTime(201); });
    expect(screen.getByLabelText("正在加载资料")).toBeInTheDocument();
    await act(async () => release({ items: [], groups: [], total: 0, roots: 0 }));
    expect(screen.queryByLabelText("正在加载资料")).toBeNull();
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-busy", "false");
  } finally { vi.useRealTimers(); }
});

it("retries a failed source load from the error state", async () => {
  let fail = true;
  install(async method => {
    if (method === "items.search") return { items: [], groups: [], total: 0, roots: 0 };
    if (method === "roots.list" && fail) throw new Error("目录读取失败");
    return { roots: [] };
  });
  render(<App />);
  await screen.findByRole("heading", { name: "无法读取来源" });
  fail = false; fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByText("还没有来源目录");
  expect(screen.queryByText("目录读取失败")).toBeNull();
});

it("settles every confirmation Promise when a new confirmation replaces the first", async () => {
  install(async () => ({ roots: [] }));
  function ConfirmHarness() {
    const library = useLibrary(); const [result, setResult] = useState<string[]>([]);
    return <><button onClick={() => {
      void library.confirm({ title: "第一问", message: "第一对象", confirmLabel: "确定" }).then(value => setResult(current => [...current, "first:" + value]));
      void library.confirm({ title: "第二问", message: "第二对象", confirmLabel: "确定" }).then(value => setResult(current => [...current, "second:" + value]));
    }}>连续确认</button><output>{result.join(",")}</output></>;
  }
  render(<RouterProvider><LibraryProvider><ConfirmHarness /></LibraryProvider></RouterProvider>);
  fireEvent.click(screen.getByRole("button", { name: "连续确认" }));
  expect(screen.getByRole("dialog", { name: "第二问" })).toHaveTextContent("第二对象");
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("first:false,second:false"));
});
