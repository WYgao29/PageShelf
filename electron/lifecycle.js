/**
 * @param {{
 *   app: { on: (event: "before-quit", listener: (event?: { preventDefault?: () => void }) => void) => void, quit: () => void },
 *   shutdown: () => Promise<void> | void,
 * }} input
 */
export function bindQuitCleanup({ app, shutdown }) {
  let quitting = false;
  const onBeforeQuit = (event) => {
    if (quitting) return;
    quitting = true;
    event?.preventDefault?.();
    Promise.resolve()
      .then(() => shutdown())
      .finally(() => app.quit());
  };
  app.on("before-quit", onBeforeQuit);
  return { onBeforeQuit };
}

/**
 * @param {{
 *   requestLock: () => boolean,
 *   quit: () => void,
 *   onSecond: () => void,
 *   on: (event: string, listener: () => void) => void,
 * }} input
 */
export function claimSingleInstance({ requestLock, quit, onSecond, on }) {
  if (!requestLock()) {
    quit();
    return { primary: false };
  }
  on("second-instance", () => onSecond());
  return { primary: true };
}
