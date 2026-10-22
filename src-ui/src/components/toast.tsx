import { useEffect } from "react";

export type ToastItem = { id: number; message: string; error: boolean };

const TOAST_MS = 5000;

export function Toasts({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <ToastView key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    if (toast.error) return;
    const handle = window.setTimeout(() => onDismiss(toast.id), TOAST_MS);
    return () => window.clearTimeout(handle);
  }, [onDismiss, toast.error, toast.id]);

  return (
    <div className={toast.error ? "toast toast-error" : "toast"} role={toast.error ? "alert" : "status"}>
      <p>{toast.message}</p>
      <button type="button" className="text-button" onClick={() => onDismiss(toast.id)}>
        关闭
      </button>
    </div>
  );
}
