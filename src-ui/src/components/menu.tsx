import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { MenuEntry } from "../library";

let menuCloser: (() => void) | null = null;

export function closeOpenMenu() {
  if (!menuCloser) return false;
  menuCloser();
  return true;
}

function menuRoot() {
  return document.querySelector("dialog[open]") ?? document.body;
}

export function menuPosition({ x, y, width, height, viewportWidth, viewportHeight, anchorTop }: {
  x: number; y: number; width: number; height: number; viewportWidth: number; viewportHeight: number; anchorTop?: number;
}) {
  const margin = 16;
  const left = Math.max(margin, Math.min(x, viewportWidth - width - margin));
  const below = y + (anchorTop === undefined ? 0 : 4);
  const above = (anchorTop ?? y) - height - (anchorTop === undefined ? 0 : 4);
  const top = Math.max(margin, Math.min(below + height > viewportHeight - margin && above >= margin ? above : below, viewportHeight - height - margin));
  return { left, top, origin: `${Math.max(0, Math.min(width, x - left))}px ${top < y ? height : 0}px` };
}

export function Menu({
  items,
  x,
  y,
  onClose,
  onSelect,
  returnFocus,
}: {
  items: MenuEntry[];
  x: number;
  y: number;
  onClose: () => void;
  onSelect: (id: string) => void;
  returnFocus: HTMLElement | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const anchor = returnFocus?.getBoundingClientRect();
    const position = menuPosition({ x, y, width: menu.offsetWidth || rect.width, height: menu.offsetHeight || rect.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, ...(anchor && Math.abs(anchor.bottom - y) < 2 ? { anchorTop: anchor.top } : {}) });
    menu.style.left = position.left + "px";
    menu.style.top = position.top + "px";
    menu.style.setProperty("--menu-origin", position.origin);
    menu.style.setProperty("--menu-enter-direction", position.top < y ? "1" : "-1");
  }, [x, y, items, returnFocus]);

  useEffect(() => {
    const close = () => closeRef.current();
    menuCloser = close;
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) closeRef.current();
    };
    const onBlur = () => closeRef.current();
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pageshelf-route", onBlur);
    return () => {
      if (menuCloser === close) menuCloser = null;
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pageshelf-route", onBlur);
      returnFocus?.focus();
    };
  }, [returnFocus]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    buttons[(index + delta + buttons.length) % buttons.length]?.focus();
  }

  return createPortal(
    <div
      ref={ref}
      className="menu"
      role="menu"
      style={{ left: x, top: y }}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {items.map((item, index) =>
        item.kind === "separator" ? (
          <hr key={"separator-" + index} />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={item.danger ? "danger-text" : undefined}
            disabled={item.disabled}
            onClick={() => {
              closeRef.current();
              if (!item.disabled) onSelect(item.id);
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>,
    menuRoot(),
  );
}
