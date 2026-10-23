import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installInputModality } from "./input-modality";
import { menuPosition } from "./components/menu";
import { Toasts } from "./components/toast";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("uses actual input events for motion and cleans up modality listeners", () => {
  const off = installInputModality();
  expect(document.documentElement.dataset.input).toBe("keyboard");
  fireEvent.pointerDown(document.body);
  expect(document.documentElement.dataset.input).toBe("pointer");
  fireEvent.keyDown(document.body, { key: "j" });
  fireEvent.pointerMove(document.body);
  expect(document.documentElement.dataset.input).toBe("keyboard");
  off();
  const previous = document.documentElement.dataset.input;
  fireEvent.pointerDown(document.body);
  expect(document.documentElement.dataset.input).toBe(previous);
});

describe("anchored menu geometry", () => {
  it("flips above its trigger near the lower right edge and keeps the origin on the trigger", () => {
    expect(menuPosition({ x: 1008, y: 740, width: 208, height: 160, viewportWidth: 1024, viewportHeight: 768, anchorTop: 708 })).toEqual({ left: 800, top: 544, origin: "208px 160px" });
  });
  it("keeps a context menu inside the viewport without negative origins", () => {
    expect(menuPosition({ x: 4, y: 4, width: 208, height: 160, viewportWidth: 320, viewportHeight: 240 })).toEqual({ left: 16, top: 16, origin: "0px 0px" });
  });
});

describe("toast reading time", () => {
  const toast = { id: 1, message: "目录已更新", error: false };
  beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); });
  it("waits for focus when a toast appears in an already blurred window", () => {
    vi.useFakeTimers();
    const focused = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    fireEvent(window, new Event("blur"));
    const dismiss = vi.fn();
    render(<Toasts toasts={[toast]} onDismiss={dismiss} />);
    act(() => vi.advanceTimersByTime(10000));
    expect(dismiss).not.toHaveBeenCalled();
    focused.mockReturnValue(true); fireEvent(window, new Event("focus"));
    act(() => vi.advanceTimersByTime(4999));
    expect(dismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(dismiss).toHaveBeenCalledExactlyOnceWith(1);
  });
  it("keeps an initially hidden and blurred toast paused until both conditions clear", () => {
    vi.useFakeTimers();
    const focused = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const dismiss = vi.fn();
    render(<Toasts toasts={[toast]} onDismiss={dismiss} />);
    act(() => vi.advanceTimersByTime(10000));
    hidden.mockReturnValue(false); fireEvent(document, new Event("visibilitychange"));
    act(() => vi.advanceTimersByTime(10000));
    expect(dismiss).not.toHaveBeenCalled();
    focused.mockReturnValue(true); fireEvent(window, new Event("focus"));
    act(() => vi.advanceTimersByTime(5000));
    expect(dismiss).toHaveBeenCalledExactlyOnceWith(1);
  });
  it("does not reset the deadline when a parent renders with a new callback", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    const view = render(<Toasts toasts={[toast]} onDismiss={id => dismiss(id)} />);
    act(() => vi.advanceTimersByTime(4000));
    view.rerender(<Toasts toasts={[toast]} onDismiss={id => dismiss(id)} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(dismiss).toHaveBeenCalledExactlyOnceWith(1);
  });
  it("pauses on hover and resumes with the remaining time", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    render(<Toasts toasts={[toast]} onDismiss={dismiss} />);
    act(() => vi.advanceTimersByTime(3000));
    fireEvent.mouseEnter(screen.getByRole("status"));
    act(() => vi.advanceTimersByTime(10000));
    expect(dismiss).not.toHaveBeenCalled();
    fireEvent.mouseLeave(screen.getByRole("status"));
    act(() => vi.advanceTimersByTime(1999));
    expect(dismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(dismiss).toHaveBeenCalledExactlyOnceWith(1);
  });
  it("keeps a toast while one of its actions has keyboard focus", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    render(<Toasts toasts={[toast]} onDismiss={dismiss} />);
    fireEvent.focus(screen.getByRole("button", { name: "关闭" }));
    act(() => vi.advanceTimersByTime(10000));
    expect(dismiss).not.toHaveBeenCalled();
    fireEvent.blur(screen.getByRole("button", { name: "关闭" }), { relatedTarget: document.body });
    act(() => vi.advanceTimersByTime(5000));
    expect(dismiss).toHaveBeenCalledExactlyOnceWith(1);
  });
  it("does not consume reading time while the document is hidden", () => {
    vi.useFakeTimers();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const dismiss = vi.fn();
    render(<Toasts toasts={[toast]} onDismiss={dismiss} />);
    act(() => vi.advanceTimersByTime(4500));
    hidden.mockReturnValue(true); fireEvent(document, new Event("visibilitychange"));
    act(() => vi.advanceTimersByTime(60000)); expect(dismiss).not.toHaveBeenCalled();
    hidden.mockReturnValue(false); fireEvent(document, new Event("visibilitychange"));
    act(() => vi.advanceTimersByTime(500)); expect(dismiss).toHaveBeenCalledExactlyOnceWith(1);
  });
  it("keeps errors until dismissed explicitly", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    render(<Toasts toasts={[{ ...toast, error: true }]} onDismiss={dismiss} />);
    act(() => vi.advanceTimersByTime(60000)); expect(dismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "关闭" })); expect(dismiss).toHaveBeenCalledExactlyOnceWith(1);
  });
});
