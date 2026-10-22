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
