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
    const margin = 16;
    menu.style.left = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin)) + "px";
    menu.style.top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin)) + "px";
  }, [x, y, items]);

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
    return () => {
      if (menuCloser === close) menuCloser = null;
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("blur", onBlur);
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
