export function wrapWorkerProcess(
  child,
  { signalProcess = (pid, signal) => process.kill(pid, signal) } = {},
) {
  let resolveReady = () => {};
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const listeners = { message: [], exit: [] };
  child.on("message", (message) => {
    if (message && message.event === "worker-ready") {
      resolveReady();
      return;
    }
    for (const listener of listeners.message) listener(message);
  });
  child.on("exit", (code) => {
    for (const listener of listeners.exit) listener(code);
  });
  return {
    get pid() {
      return child.pid ?? null;
    },
    ready,
    send(message) {
      child.postMessage(message);
    },
    kill() {
      if (child.pid) signalProcess(child.pid, "SIGTERM");
      else child.kill();
    },
    on(event, listener) {
      listeners[event].push(listener);
    },
  };
}
