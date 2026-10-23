import { shellProbeSource, sameColor } from "../shared/shell-audit.js";
import { DARK_WINDOW_BACKGROUND, LIGHT_WINDOW_BACKGROUND } from "./window-policy.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate, attempts = 30) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await predicate()) return true;
    await delay(50);
  }
  return false;
}

/**
 * @param {{ isVisible: () => boolean, show: () => void, setContentSize: (width: number, height: number) => void, getBackgroundColor: () => string, webContents: { executeJavaScript: (code: string) => Promise<any> } }} win
 */
export async function measureShellLayouts(win) {
  if (!win.isVisible()) win.show();
  await delay(80);
  const probe = shellProbeSource();
  const records = [];
  for (const width of [1440, 1280, 960]) {
    win.setContentSize(width, 900);
    await waitUntil(
      async () => (await win.webContents.executeJavaScript("window.innerWidth")) === width,
    );
    await win.webContents.executeJavaScript(
      "(() => { window.dispatchEvent(new Event('resize')); return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); })()",
    );
    const sidebarState = width === 960 ? "collapsed" : "open";
    await waitUntil(
      async () =>
        (await win.webContents.executeJavaScript(
          "document.querySelector('.app-shell') && document.querySelector('.app-shell').getAttribute('data-sidebar')",
        )) === sidebarState,
    );
    for (const [label, theme] of [
      ["亮色", "light"],
      ["暗色", "dark"],
    ]) {
      await win.webContents.executeJavaScript(
        `(() => {
          const button = [...document.querySelectorAll("[role=radio]")].find((el) => el.textContent === ${JSON.stringify(label)});
          if (button) button.click();
        })()`,
      );
      // click() returns before React commits useLayoutEffect, so the theme
      // attribute still shows the previous appearance until the next frame.
      await waitUntil(
        async () =>
          (await win.webContents.executeJavaScript(
            "document.documentElement.dataset.theme || ''",
          )) === theme,
      );
      const applied = await win.webContents.executeJavaScript(
        "document.documentElement.dataset.theme || ''",
      );
      const expected = theme === "dark" ? DARK_WINDOW_BACKGROUND : LIGHT_WINDOW_BACKGROUND;
      await waitUntil(async () => sameColor(win.getBackgroundColor(), expected));
      const measured = await win.webContents.executeJavaScript(probe);
      records.push({
        ...measured,
        requestedWidth: width,
        requestedTheme: theme,
        appliedTheme: applied,
        backgroundColor: win.getBackgroundColor(),
      });
    }
  }
  return records;
}
