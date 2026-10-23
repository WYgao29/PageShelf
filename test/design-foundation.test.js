import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const brand = [
  "pageshelf-mark.svg",
  "pageshelf-mark-dark.svg",
  "pageshelf-mark-small.svg",
  "pageshelf-mark-small-dark.svg",
  "pageshelf-logo.svg",
  "pageshelf-logo-dark.svg",
  "pageshelf-appicon-light-1024.png",
  "pageshelf-appicon-dark-1024.png",
];

const fonts = [
  "InterVariable.woff2",
  "Inter-LICENSE.txt",
  "SpaceGrotesk-Variable.woff2",
  "SpaceGrotesk-OFL.txt",
];

const tokens = [
  "--bg",
  "--surface",
  "--surface-sunken",
  "--surface-hover",
  "--surface-selected",
  "--sidebar-bg",
  "--overlay-backdrop",
  "--text",
  "--text-2",
  "--text-3",
  "--brand-text",
  "--border",
  "--border-strong",
  "--border-width",
  "--accent",
  "--accent-hover",
  "--accent-pressed",
  "--accent-subtle",
  "--accent-text",
  "--on-accent",
  "--danger",
  "--danger-subtle",
  "--success",
  "--info",
  "--warning",
  "--callout-tint",
  "--status-queued",
  "--status-running",
  "--status-waiting",
  "--status-failed",
  "--status-done",
  "--code-bg",
  "--code-text",
  "--code-cmd",
  "--code-flag",
  "--code-comment",
  "--focus-ring",
  "--shadow-xs",
  "--shadow-overlay",
  "--font-heading",
  "--font-ui",
  "--font-reading",
  "--font-mono",
  "--fs-12",
  "--fs-13",
  "--fs-14",
  "--fs-16",
  "--fs-20",
  "--fs-28",
  "--fs-40",
  "--fs-reading",
  "--lh-reading",
  "--measure",
  "--fw-regular",
  "--fw-medium",
  "--fw-semibold",
  "--space-1",
  "--space-2",
  "--space-3",
  "--space-4",
  "--space-6",
  "--space-8",
  "--space-12",
  "--space-16",
  "--radius",
  "--radius-sm",
  "--radius-lg",
  "--dur-fast",
  "--dur-base",
  "--dur-panel",
  "--dur-dialog",
  "--dur-exit",
  "--ease",
  "--ease-in-out",
  "--ease-panel",
  "--transition-control",
  "--z-base",
  "--z-main",
  "--z-sticky",
  "--z-panel",
  "--z-popover",
  "--z-modal",
  "--z-toast",
  "--sidebar-width",
  "--panel-width",
  "--header-height",
  "--titlebar-height",
  "--row-height",
  "--form-width",
  "--list-width",
  "--mark-size",
  "--window-min-width",
];

test("desktop shell boots the theme before css and ships local brand files", async () => {
  const html = await readFile(new URL("../src-ui/index.html", import.meta.url), "utf8");
  assert.ok(html.indexOf("theme-boot.js") < html.indexOf("app.css"));
  assert.match(html, /<script src="\/theme-boot\.js"><\/script>/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>/);
  const css = await readFile(new URL("../src-ui/assets/tokens.css", import.meta.url), "utf8");
  for (const token of tokens) assert.match(css, new RegExp(token + String.raw`:?\s`));
  assert.match(css, /--bg:\s*#FFFFFF/);
  assert.match(css, /--bg:\s*#111214/);
  assert.match(css, /--accent:\s*#1E40AF/);
  assert.match(css, /--accent:\s*#93C5FD/);
  assert.match(css, /--panel-width:\s*360px/);
  assert.deepEqual(css.match(/--sidebar-width\s*:/g), ["--sidebar-width:"]);
  assert.match(css, /--sidebar-width:\s*252px/);
  assert.doesNotMatch(css, /--sidebar-width:\s*240px/);
  assert.match(css, /--list-width:\s*384px/);
  assert.match(css, /url\("\.\/fonts\/InterVariable\.woff2"\)/);
  assert.match(css, /url\("\.\/fonts\/SpaceGrotesk-Variable\.woff2"\)/);
  assert.match(css, /font-weight:\s*100 900/);
  assert.match(css, /font-weight:\s*300 700/);
  assert.match(css, /:where\(button, a, input, textarea, \[tabindex\]:not\(\[tabindex="-1"\]\)\):focus-visible/);
  const shell = await readFile(new URL("../src-ui/src/styles/shell.css", import.meta.url), "utf8");
  assert.match(shell, /letter-spacing:\s*-0\.065em/);
  assert.match(shell, /\.wordmark\s*\{[^}]*font-weight:\s*var\(--fw-brand\)/s);
  assert.match(css, /--fw-brand:\s*700/);
  assert.match(shell, /height:\s*var\(--titlebar-height\)/);
  assert.match(shell, /\.list-pane > \.titlebar\s*\{[^}]*display:\s*none/s);
  assert.match(shell, /\[data-sidebar="collapsed"\] \.list-pane > \.titlebar\s*\{[^}]*display:\s*block/s);
  assert.match(shell, /height:\s*var\(--header-height\)/);
  assert.match(shell, /@media \(hover: hover\) and \(pointer: fine\)/);
  for (const name of brand) {
    await access(new URL("../src-ui/assets/brand/" + name, import.meta.url));
    await access(new URL("../build/brand/" + name, import.meta.url));
  }
  for (const name of fonts) await access(new URL("../src-ui/assets/fonts/" + name, import.meta.url));
  await assert.rejects(access(new URL("../build/brand/preview.png", import.meta.url)));
  await assert.rejects(access(new URL("../build/brand/pageshelf.icns", import.meta.url)));
});
