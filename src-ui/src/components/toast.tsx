import { useEffect, useRef } from "react";
import { Icon } from "./icons";

export type ToastAction = { label: string; run: () => Promise<unknown> | void };
export type ToastItem = { id: number; message: string; error: boolean; action?: ToastAction };

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
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const pauseRef = useRef<(reason: string, paused: boolean) => void>(() => {});
  useEffect(() => {
    if (toast.error) return;
    let remaining = TOAST_MS;
    let started = 0;
    let timer: number | undefined;
    const paused = new Set<string>();
    if (!document.hasFocus()) paused.add("window");
    const stop = () => {
      if (timer === undefined) return;
      window.clearTimeout(timer);
      timer = undefined;
      remaining = Math.max(0, remaining - (Date.now() - started));
    };
    const resume = () => {
      if (paused.size || timer !== undefined) return;
      started = Date.now();
      timer = window.setTimeout(() => { timer = undefined; dismissRef.current(toast.id); }, remaining);
    };
    const setPaused = (reason: string, value: boolean) => {
      if (value) { paused.add(reason); stop(); }
      else { paused.delete(reason); resume(); }
    };
    pauseRef.current = setPaused;
    const visibility = () => setPaused("hidden", document.hidden);
    const blur = () => setPaused("window", true);
    const focus = () => setPaused("window", false);
    visibility();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    return () => {
      stop();
      pauseRef.current = () => {};
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
    };
  }, [toast.error, toast.id]);

  return (
    <div className={toast.error ? "toast toast-error" : "toast"} role={toast.error ? "alert" : "status"}
      onMouseEnter={() => pauseRef.current("pointer", true)} onMouseLeave={() => pauseRef.current("pointer", false)}
      onFocusCapture={() => pauseRef.current("focus", true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) pauseRef.current("focus", false); }}>
      <span className="toast-icon"><Icon name={toast.error ? "alert" : "check"} /></span>
      <p>{toast.message}</p>
      {toast.action ? <button type="button" className="text-button" onClick={() => { void Promise.resolve(toast.action?.run()).catch(() => {}); }}>{toast.action.label}</button> : null}
      <button type="button" className="icon-button toast-close" aria-label="关闭" title="关闭通知" onClick={() => onDismiss(toast.id)}>
        <Icon name="close" />
      </button>
    </div>
  );
}
