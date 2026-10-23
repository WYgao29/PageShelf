import { randomUUID } from "node:crypto";
import { FORCE_KILL_MS } from "../shared/pageshelf-contract.js";

const crashed = () =>
  Object.assign(new Error("库进程已退出"), { code: "WORKER_CRASHED" });
const stopped = () =>
  Object.assign(new Error("库进程正在退出"), { code: "WORKER_STOPPED" });

/**
 * @param {{
 *   spawnWorker: () => {
 *     pid: number | null,
 *     ready: Promise<unknown>,
 *     send: (message: unknown) => void,
 *     kill: () => void,
 *     on: (event: "message" | "exit", listener: (value?: unknown) => void) => void,
 *   },
 *   onEvent?: (message: { event?: string, payload?: unknown }) => void,
 *   forceKillAfterMs?: number,
 *   killProcess?: (pid: number) => void,
 *   schedule?: (fn: () => void, ms: number) => unknown,
 *   clear?: (timer: unknown) => void,
 * }} [options]
 */
export function createWorkerSupervisor({
  spawnWorker,
  onEvent = (_message) => {},
  forceKillAfterMs = FORCE_KILL_MS,
  killProcess = (pid) => process.kill(pid, "SIGKILL"),
  schedule = setTimeout,
  clear = clearTimeout,
} = {}) {
  let generation = 0;
  let worker = null;
  let ready = false;
  let stopping = false;
  let starting = null;
  const pending = new Map();
  const queue = [];

  function failPending(error) {
    queue.length = 0;
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  }

  function deliver(message) {
    if (!message || typeof message !== "object") return;
    if (typeof message.id === "string" && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.ok)
        entry.resolve(message.result);
      else
        entry.reject(
          Object.assign(new Error(message.error?.message || "库进程错误"), {
            code: message.error?.code || "INTERNAL_ERROR",
            details: message.error?.details || {},
          }),
        );
      return;
    }
    if (typeof message.event === "string") onEvent(message);
  }

  function flush() {
    if (!worker || !ready) return;
    while (queue.length) worker.send(queue.shift());
  }

  // Ready may never arrive. Settling here lets the caller continue, and the
  // identity check keeps this attempt from clearing a replacement's startup.
  function finishStartup(attempt, error) {
    if (!attempt || attempt.settled) return;
    attempt.settled = true;
    if (starting === attempt.promise) starting = null;
    if (error) attempt.fail(error);
    else attempt.settle();
  }

  function attach(child, attempt) {
    const current = ++generation;
    worker = child;
    ready = false;
    const onMessage = (message) => {
      if (current !== generation) return;
      deliver(message);
    };
    const onExit = () => {
      if (current !== generation) return;
      worker = null;
      ready = false;
      const error = stopping ? stopped() : crashed();
      failPending(error);
      finishStartup(attempt);
      if (!stopping) {
        onEvent({
          event: "worker-status",
          payload: { state: "crashed" },
        });
        void start();
      } else {
        onEvent({
          event: "worker-status",
          payload: { state: "stopped" },
        });
      }
    };
    child.on("message", onMessage);
    child.on("exit", onExit);
  }

  function start() {
    if (starting) return starting;
    stopping = false;
    const child = spawnWorker();
    let settle = () => {};
    let fail = () => {};
    const promise = new Promise((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    const attempt = { promise, settle, fail, settled: false };
    starting = promise;
    attach(child, attempt);
    Promise.resolve(child.ready)
      .then(() => {
        if (attempt.settled || stopping || worker !== child) return;
        ready = true;
        flush();
        onEvent({ event: "worker-status", payload: { state: "ready" } });
      })
      .then(
        () => finishStartup(attempt),
        (error) => finishStartup(attempt, error),
      );
    return promise;
  }

  function request(payload) {
    if (stopping) return Promise.reject(stopped());
    const id = randomUUID();
    const message = {
      id,
      method: payload.method,
      params: payload.params ?? {},
    };
    const promise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    if (!worker || !ready) queue.push(message);
    else worker.send(message);
    return promise;
  }

  function shutdown() {
    stopping = true;
    failPending(stopped());
    if (!worker) return Promise.resolve();
    const child = worker;
    let settled = false;
    let timer = null;
    return new Promise((resolve) => {
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer !== null) clear(timer);
        resolve();
      };
      child.on("exit", finish);
      child.kill();
      if (!worker) {
        finish();
        return;
      }
      timer = schedule(() => {
        if (child.pid) {
          try {
            killProcess(child.pid);
          } catch {
            // The process can exit between the check and the signal.
          }
        }
        finish();
      }, forceKillAfterMs);
    });
  }

  return {
    start,
    request,
    shutdown,
    pid: () => worker?.pid ?? null,
  };
}
