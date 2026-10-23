import { isItemId } from "../shared/pageshelf-contract.js";

export const APP_WINDOW_PREFERENCES = Object.freeze({
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  webviewTag: false,
});

export const LIGHT_WINDOW_BACKGROUND = "#FFFFFF";
export const DARK_WINDOW_BACKGROUND = "#111214";

export function windowBackground(prefersDark) {
  return prefersDark ? DARK_WINDOW_BACKGROUND : LIGHT_WINDOW_BACKGROUND;
}

export function titlebarMode(platform, fullscreen) {
  return platform === "darwin" && fullscreen !== true ? "inset" : "hidden";
}

/**
 * @returns {{ action: "deny" }}
 */
export function windowOpenDecision() {
  return { action: "deny" };
}

export function permissionDecision() {
  return false;
}

/**
 * @param {{ preloadPath: string, backgroundColor: string, title?: string }} options
 * @returns {import("electron").BrowserWindowConstructorOptions}
 */
export function appWindowOptions({
  preloadPath,
  backgroundColor,
  title = "PageShelf",
}) {
  return {
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 720,
    show: false,
    title,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor,
    webPreferences: {
      ...APP_WINDOW_PREFERENCES,
      preload: preloadPath,
    },
  };
}

/**
 * @param {string} itemId
 * @param {{ backgroundColor?: string }} [options]
 * @returns {{ url: string, options: import("electron").BrowserWindowConstructorOptions }}
 */
export function planOriginalWindow(itemId, { backgroundColor = "#FFFFFF" } = {}) {
  if (!isItemId(itemId))
    throw Object.assign(new Error("参数无效"), { code: "INVALID_PARAMS" });
  return {
    url: "pageshelf://source/" + encodeURIComponent(itemId) + "/original",
    options: {
      width: 960,
      height: 800,
      minWidth: 960,
      minHeight: 640,
      show: true,
      title: "原网页",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 18 },
      backgroundColor,
      webPreferences: { ...APP_WINDOW_PREFERENCES },
    },
  };
}
