function merge(left = {}, right = {}) {
  return {
    full: Boolean(left.full || right.full),
    subtrees: [
      ...new Set([
        ...(left.subtrees || []),
        ...(right.subtrees || []),
        ...(left.subtree ? [left.subtree] : []),
        ...(right.subtree ? [right.subtree] : []),
      ]),
    ],
  };
}
export function createScheduler({ scanRoot, concurrency = 2 }) {
  const queued = new Map(),
    running = new Map(),
    idleWaiters = [],
    rootWaiters = new Map();
  let scheduled = false;
  function settle() {
    if (!running.size && !queued.size)
      idleWaiters.splice(0).forEach((resolve) => resolve());
  }
  function pump() {
    scheduled = false;
    for (const [rootId, options] of queued) {
      if (running.size >= concurrency) break;
      if (running.has(rootId)) continue;
      queued.delete(rootId);
      const entry = { rootId, files: { done: 0, total: 0 } };
      running.set(rootId, entry);
      Promise.resolve()
        .then(() =>
          scanRoot(rootId, {
            ...options,
            onProgress: (files) => {
              entry.files = files;
            },
          }),
        )
        .catch((error) => {
          entry.error = error.message;
        })
        .finally(() => {
          running.delete(rootId);
          const waiters = rootWaiters.get(rootId) || [];
          rootWaiters.delete(rootId);
          waiters.forEach((resolve) => resolve());
          pump();
          settle();
        });
    }
    settle();
  }
  function enqueue(rootId, options = {}) {
    queued.set(rootId, merge(queued.get(rootId), options));
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(pump);
    }
    return { queued: true, position: [...queued.keys()].indexOf(rootId) + 1 };
  }
  return {
    enqueue,
    status: () => ({
      running: [...running.values()].map((x) => ({
        ...x,
        files: { ...x.files },
      })),
      queued: [...queued.keys()].map((rootId, i) => ({
        rootId,
        position: i + 1,
      })),
    }),
    waitForIdle: () =>
      !running.size && !queued.size
        ? Promise.resolve()
        : new Promise((resolve) => idleWaiters.push(resolve)),
    waitForRoot: (rootId) =>
      !running.has(rootId) && !queued.has(rootId)
        ? Promise.resolve()
        : new Promise((resolve) =>
            rootWaiters.set(rootId, [
              ...(rootWaiters.get(rootId) || []),
              resolve,
            ]),
          ),
  };
}
