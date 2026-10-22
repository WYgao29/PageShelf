import { useEffect, useId, useRef } from "react";
import { closeOpenMenu } from "./menu";

function showDialog(dialog: HTMLDialogElement) {
  if (typeof dialog.showModal === "function") {
    try {
      dialog.showModal();
    } catch {
      dialog.setAttribute("open", "");
    }
  } else dialog.setAttribute("open", "");
  if (!dialog.open) dialog.setAttribute("open", "");
}

export function Dialog({
  title,
  children,
  footer,
  className = "",
  onClose,
  autoFocusSelector,
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  onClose: () => void;
  autoFocusSelector?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    showDialog(dialog);
    if (autoFocusSelector) dialog.querySelector<HTMLElement>(autoFocusSelector)?.focus();
    const onCancel = (event: Event) => {
      event.preventDefault();
      if (closeOpenMenu()) return;
      onCloseRef.current();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      previous?.focus?.();
    };
  }, [autoFocusSelector]);

  return (
    <dialog
      ref={ref}
      className={"dialog" + (className ? " " + className : "")}
      aria-labelledby={titleId}
    >
      <header className="dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭弹窗"
          title="关闭弹窗"
          onClick={() => onCloseRef.current()}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div className="dialog-body">{children}</div>
      {footer ? <footer className="dialog-footer">{footer}</footer> : null}
    </dialog>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  onSettle,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onSettle: (value: boolean) => void;
}) {
  return (
    <Dialog
      title={title}
      onClose={() => onSettle(false)}
      autoFocusSelector="[data-confirm-cancel]"
      footer={
        <>
          <button type="button" data-confirm-cancel onClick={() => onSettle(false)}>
            取消
          </button>
          <button
            type="button"
            className={danger ? "button-danger" : "button-primary"}
            onClick={() => onSettle(true)}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Dialog>
  );
}
