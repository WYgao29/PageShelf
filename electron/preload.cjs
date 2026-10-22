const { contextBridge, ipcRenderer } = require("electron");

const INVOKE = "pageshelf:invoke";
const EVENT = "pageshelf:event";
const EVENTS = new Set(["scan-progress", "library-changed", "worker-status"]);

function invoke(method, params) {
  return ipcRenderer.invoke(INVOKE, { method, params });
}

contextBridge.exposeInMainWorld("pageshelf", {
  invoke,
  on(eventName, callback) {
    if (!EVENTS.has(eventName) || typeof callback !== "function")
      throw new Error("事件无效");
    const listener = (_event, message) => {
      if (message && message.event === eventName) callback(message.payload);
    };
    ipcRenderer.on(EVENT, listener);
    return () => ipcRenderer.removeListener(EVENT, listener);
  },
  pickFolder() {
    return invoke("system.chooseFolder", {});
  },
  revealInFinder(target) {
    return invoke("system.reveal", target);
  },
  openTrash() {
    return invoke("system.openTrash", {});
  },
  openOriginal(itemId) {
    return invoke("window.openOriginal", { itemId });
  },
  openExternal(url, confirmed) {
    return invoke("system.openExternal", { url, confirmed });
  },
});

const BACKGROUND_CHANNEL = "pageshelf:window-background";
const CHROME_CHANNEL = "pageshelf:chrome";
let watchingTheme = false;

function applyTitlebar(mode) {
  if ((mode !== "inset" && mode !== "hidden") || !document.documentElement) return;
  document.documentElement.dataset.titlebar = mode;
}

function publishAppearance() {
  if (!document.documentElement) return;
  const appearance = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  ipcRenderer.send(BACKGROUND_CHANNEL, appearance);
}

function installChrome() {
  const root = document.documentElement;
  if (!root) return;
  root.dataset.platform = process.platform;
  if (!root.dataset.titlebar) applyTitlebar(process.platform === "darwin" ? "inset" : "hidden");
  publishAppearance();
  if (watchingTheme) return;
  watchingTheme = true;
  new MutationObserver(publishAppearance).observe(root, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installChrome, { once: true });
} else {
  installChrome();
}

ipcRenderer.on(CHROME_CHANNEL, (_event, payload) => {
  applyTitlebar(payload && payload.titlebar);
});
