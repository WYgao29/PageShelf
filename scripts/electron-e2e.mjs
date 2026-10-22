import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, readFile, access, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect } from "@playwright/test";
import { html } from "../test/helpers/fixture.js";
import { mhtmlWithImage } from "../test/helpers/mhtml-image.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(os.tmpdir(), "pageshelf-e2e-"));
const data = path.join(temporary, "data");
const source = path.join(temporary, "source");
await mkdir(data); await mkdir(source);
await mkdir(path.join(source, "assets")); await mkdir(path.join(source, "notes"));
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQEBAI3CrcUAAAAASUVORK5CYII=", "base64");
await writeFile(path.join(source, "assets/pixel.png"), pixel);
await writeFile(path.join(temporary, "outside.png"), pixel);
await writeFile(path.join(source, "notes/child.md"), "# 嵌套笔记\n\n![相邻本地图](../assets/pixel.png)");
await writeFile(path.join(data, "config.json"), JSON.stringify({ version: 2, roots: [], ui: {} }));
await writeFile(path.join(source, "alpha.html"), html("HTML 样例"));
await writeFile(path.join(source, "alpha.md"), "# HTML 样例\n\n## Markdown 备用\n这是另一种 Markdown 正文。");
await writeFile(path.join(source, "archive.mhtml"), mhtmlWithImage("MHTML 样例"));
await writeFile(path.join(source, "note.md"), "# Markdown 样例\n\n## 小节\n短笔记，证据与**方法**。\n\n![外部](https://example.test/blocked.png)\n![本地图](assets/pixel.png)");
await writeFile(path.join(source, "short.html"), html("短文样例", "短文"));
await writeFile(path.join(source, "evil.html"), html("恶意样例", "正文证据。".repeat(80)) + '<h2>恶意样例原文</h2><script>globalThis.__xss = 1; fetch("https://example.test/evil")</script><img src="https://example.test/evil.png" onerror="globalThis.__xss=1"><a href="https://example.test/article">原文外链</a>');

const env = { ...process.env, HTML_LIBRARY_DATA_DIR: data, PAGESHELF_TEST: "1", PAGESHELF_TEST_TRASH: "1" };
delete env.ELECTRON_RUN_AS_NODE; delete env.PAGESHELF_DEV; delete env.PAGESHELF_SMOKE;
let application = await _electron.launch({ args: [root], cwd: root, env, timeout: 30000 });
let page = await application.firstWindow();
page.setDefaultTimeout(15000);
let passed = 0;
async function check(name, test) {
  await test(); passed++; console.log("PASS " + name);
}
async function open(title) {
  await page.getByRole("searchbox", { name: "搜索资料" }).fill(title);
  await expect(page.locator("#list-rows")).toHaveAttribute("data-query", title);
  await expect(page.locator("#list-rows")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("option", { name: new RegExp("^" + title + " ") }).click();
}
try {
  await application.evaluate(({ session }) => {
    globalThis.__externalRequests = [];
    session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
      globalThis.__externalRequests.push(details.url); callback({ cancel: true });
    });
  });
  await check("production custom-protocol shell and native-folder preflight", async () => {
    assert.ok(page.url().startsWith("pageshelf://app/"));
    await page.getByRole("button", { name: "添加来源目录" }).click();
    const manager = page.getByRole("dialog", { name: "目录管理" });
    await manager.getByLabel("目录路径", { exact: true }).fill(source);
    await manager.getByLabel("新目录显示名").fill("验收夹具");
    await expect(manager.locator("#add-root")).toBeEnabled();
    await manager.locator("#add-root").click();
    await manager.getByRole("button", { name: "完成", exact: true }).click();
    await expect(page.locator(".item-row")).toHaveCount(6);
  });
  await check("HTML extracted article, headings and hit navigation", async () => {
    await open("HTML 样例");
    await expect(page.locator(".reading-article")).toContainText("证据应当可复核");
    await page.getByLabel("本页目录", { exact: true }).click();
    await expect(page.getByRole("dialog", { name: "本页目录" })).toContainText("研究问题");
    await page.getByRole("button", { name: "关闭弹窗" }).click();
    await page.getByRole("searchbox").fill("证据");
    await expect(page.locator(".reader-hit").first()).toBeVisible();
    await page.getByLabel("下一个正文命中").click();
    await expect(page.locator(".current-hit").first()).toBeVisible();
  });
  await check("all three views and toolbars fit at three widths in both themes", async () => {
    await page.getByRole("tab", { name: "Markdown", exact: true }).click();
    await expect(page.locator(".reading-article")).toContainText("另一种 Markdown 正文");
    await expect(page.getByRole("tablist", { name: "阅读视图", exact: true }).getByRole("tab")).toHaveCount(3);
    for (const width of [1440, 1280, 960]) {
      await application.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width);
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
      for (const [label, theme] of [["亮色", "light"], ["暗色", "dark"]]) {
        await page.getByRole("radio", { name: label, exact: true }).click();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const geometry = await page.evaluate(() => {
          const toolbar = document.querySelector(".reader-toolbar").getBoundingClientRect();
          const children = [...document.querySelector(".reader-toolbar").children].map(child => child.getBoundingClientRect());
          return { search: document.querySelector(".search-box").getBoundingClientRect().width, reader: document.querySelector("#reader-pane").getBoundingClientRect().width,
            tabs: document.querySelector(".view-tabs").getBoundingClientRect().height, fits: children.every(child => child.left >= toolbar.left && child.right <= toolbar.right && child.top >= toolbar.top && child.bottom <= toolbar.bottom), rootOverflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.ok(geometry.search >= 240 && geometry.reader >= 480 && geometry.tabs === 32 && geometry.fits && !geometry.rootOverflow, JSON.stringify({ width, theme, geometry }));
      }
    }
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
    await page.getByRole("radio", { name: "跟随系统", exact: true }).click();
    await page.getByRole("tab", { name: "阅读视图", exact: true }).click();
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => {
    globalThis.__motionSamples = [];
    const seen = new WeakSet();
    globalThis.__motionObserver = new MutationObserver(() => {
      for (const element of document.querySelectorAll(".menu, dialog[open]")) {
        if (seen.has(element)) continue;
        seen.add(element);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (!element.isConnected) return;
          globalThis.__motionSamples.push({ kind: element.matches(".menu") ? "menu" : "dialog", input: document.documentElement.dataset.input,
            animations: element.getAnimations().map(animation => ({ property: animation.transitionProperty, duration: animation.effect.getTiming().duration })),
            transform: getComputedStyle(element).transform, origin: getComputedStyle(element).transformOrigin });
        }));
      }
    });
    globalThis.__motionObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
  });
  await check("pointer overlays have short compositor transitions and anchored menu origins", async () => {
    await page.getByLabel("文章操作", { exact: true }).click();
    await expect.poll(() => page.evaluate(() => globalThis.__motionSamples.filter(sample => sample.kind === "menu").length)).toBeGreaterThan(0);
    const menu = await page.evaluate(() => globalThis.__motionSamples.filter(sample => sample.kind === "menu").at(-1));
    assert.equal(menu.input, "pointer");
    assert.ok(menu.animations.some(animation => animation.property === "transform" && animation.duration === 160), JSON.stringify(menu));
    assert.ok(menu.animations.every(animation => ["transform", "opacity"].includes(animation.property)), JSON.stringify(menu));
    const position = await page.getByRole("menu").evaluate(menu => ({ box: menu.getBoundingClientRect().toJSON(), origin: getComputedStyle(menu).transformOrigin }));
    assert.ok(position.box.left >= 15 && position.box.right <= 1440 - 15 && position.box.width <= 280, JSON.stringify(position));
    await page.getByRole("menuitem", { name: "条目信息" }).click();
    await expect.poll(() => page.evaluate(() => globalThis.__motionSamples.filter(sample => sample.kind === "dialog").length)).toBeGreaterThan(0);
    const dialog = await page.evaluate(() => globalThis.__motionSamples.filter(sample => sample.kind === "dialog").at(-1));
    assert.equal(dialog.input, "pointer");
    assert.deepEqual(dialog.animations, [{ property: "opacity", duration: 200 }]);
    await page.getByRole("button", { name: "关闭弹窗" }).click();
  });
  await check("keyboard commands open overlays instantly without animation", async () => {
    await page.keyboard.press("Shift+m");
    const dialog = page.getByRole("dialog", { name: "目录管理" });
    await expect(dialog).toBeVisible();
    assert.equal(await page.locator("html").getAttribute("data-input"), "keyboard");
    assert.equal(await dialog.evaluate(node => node.getAnimations().length), 0);
    assert.equal(await dialog.evaluate(node => getComputedStyle(node).transitionDuration), "0s");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
  await check("reduced motion keeps pointer overlays free of movement", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const button = page.getByLabel("文章操作", { exact: true });
    const box = await button.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    assert.equal(await button.evaluate(node => getComputedStyle(node).transform), "none");
    await page.mouse.up();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const animations = await menu.evaluate(node => node.getAnimations().map(animation => ({ property: animation.transitionProperty, duration: animation.effect.getTiming().duration })));
    assert.ok(animations.every(animation => animation.property === "opacity" && animation.duration <= 100), JSON.stringify(animations));
    assert.equal(await menu.evaluate(node => getComputedStyle(node).transform), "none");
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: null });
  });
  await page.evaluate(() => globalThis.__motionObserver.disconnect());
  await check("all three original-page entry points open a restricted application window", async () => {
    await open("HTML 样例");
    async function verify(trigger) {
      const ready = application.waitForEvent("window"); await trigger(); const original = await ready;
      await original.waitForLoadState("domcontentloaded");
      assert.ok(original.url().startsWith("pageshelf://source/"));
      assert.deepEqual(await original.evaluate(() => ({ bridge: typeof window.pageshelf, node: typeof require })), { bridge: "undefined", node: "undefined" });
      await expect(original.locator("body")).toContainText("HTML 样例"); await original.close();
    }
    await verify(() => page.getByRole("option", { name: /^HTML 样例 / }).click({ modifiers: ["Meta"] }));
    await verify(async () => { await page.getByRole("option", { name: /^HTML 样例 / }).click({ button: "right" }); await page.getByRole("menuitem", { name: "在新窗口打开原网页" }).click(); });
    await verify(async () => { await page.getByLabel("文章操作", { exact: true }).click(); await page.getByRole("menuitem", { name: "在新窗口打开原网页" }).click(); });
  });
  await check("MHTML decoded through worker and reader", async () => {
    await open("MHTML 样例"); await expect(page.locator(".reading-article")).toContainText("证据应当可复核");
    await expect.poll(() => page.locator('.reading-article img[alt="归档图片"]').evaluate(image => image.naturalWidth)).toBe(1);
    await page.getByRole("tab", { name: "原网页", exact: true }).click();
    await expect.poll(() => page.frameLocator("#original-frame").locator('img[alt="归档图片"]').evaluate(image => image.naturalWidth)).toBe(1);
    await page.getByRole("tab", { name: "阅读视图", exact: true }).click();
  });
  await check("Markdown short-note reading and raw source text", async () => {
    await open("Markdown 样例"); await expect(page.locator(".reading-article")).toContainText("短笔记");
    await expect(page.locator(".image-placeholder")).toContainText("外部图片未加载");
    await expect.poll(() => page.locator('img[alt="本地图"]').evaluate(image => image.naturalWidth)).toBe(1);
    await page.getByRole("tab", { name: "源文本", exact: true }).click();
    await expect(page.locator(".source-text")).toContainText("证据与**方法**");
    await page.getByRole("tab", { name: "阅读视图", exact: true }).click();
  });
  await check("nested Markdown images load within the root and reject escaping paths", async () => {
    await open("嵌套笔记");
    await expect.poll(() => page.locator('img[alt="相邻本地图"]').evaluate(image => image.naturalWidth)).toBe(1);
    const escaped = await page.evaluate(async () => {
      const id = new URLSearchParams(location.hash.split("?")[1]).get("item");
      try { await window.pageshelf.invoke("items.asset", { id, path: "../../outside.png" }); return "allowed"; }
      catch { return "denied"; }
    });
    assert.equal(escaped, "denied");
  });
  await check("short HTML falls back to a functioning sandbox iframe", async () => {
    await open("短文样例");
    await expect(page.locator(".fallback-banner")).toContainText("不足 200 字");
    await expect(page.locator("iframe")).toHaveAttribute("sandbox", "");
    await expect(page.frameLocator("iframe").locator("body")).toContainText("短文");
  });
  await check("hostile HTML never executes scripts or accesses the desktop bridge", async () => {
    await open("恶意样例");
    await expect(page.locator(".reading-article")).toBeVisible();
    await page.getByRole("tab", { name: "原网页", exact: true }).click();
    await expect(page.frameLocator("iframe").locator("body")).toContainText("恶意样例原文");
    const frame = page.frames().find(value => value.url().startsWith("pageshelf://source/"));
    assert.ok(frame, "source frame missing");
    assert.deepEqual(await frame.evaluate(() => ({ xss: globalThis.__xss || 0, bridge: typeof window.pageshelf, node: typeof require })), { xss: 0, bridge: "undefined", node: "undefined" });
    assert.equal(await page.evaluate(() => globalThis.__xss || 0), 0);
  });
  await check("source iframe links require confirmation before opening a browser", async () => {
    await application.evaluate(({ shell }) => { globalThis.__openedExternal = []; shell.openExternal = async url => { globalThis.__openedExternal.push(url); }; });
    await page.frameLocator("iframe").getByRole("link", { name: "原文外链" }).click();
    const dialog = page.getByRole("dialog", { name: "打开外部链接？" });
    await expect(dialog).toBeVisible(); assert.deepEqual(await application.evaluate(() => globalThis.__openedExternal), []);
    await dialog.getByRole("button", { name: "打开链接" }).click();
    await expect.poll(() => application.evaluate(() => globalThis.__openedExternal)).toEqual(["https://example.test/article"]);
    await expect(dialog).toBeHidden();
  });
  await check("native menu and keyboard accelerator fire once", async () => {
    const ids = await application.evaluate(({ Menu }) => ["focus-search", "back", "forward", "next-item", "manage-roots"].map(id => Boolean(Menu.getApplicationMenu().getMenuItemById(id))));
    assert.deepEqual(ids, [true, true, true, true, true]);
    await application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById("focus-search").click());
    await expect(page.getByRole("searchbox")).toBeFocused();
    await page.keyboard.press("Meta+k"); await expect(page.getByRole("searchbox")).toBeFocused();
    await page.evaluate(() => { document.activeElement.blur(); });
    const before = await page.locator(".app-shell").getAttribute("data-sidebar");
    await page.keyboard.press("Meta+\\");
    await expect(page.locator(".app-shell")).toHaveAttribute("data-sidebar", before === "open" ? "collapsed" : "open");
    await page.keyboard.press("Meta+\\");
    await expect(page.locator(".app-shell")).toHaveAttribute("data-sidebar", before);
  });
  await check("native save dialog exports the original source bytes", async () => {
    await open("Markdown 样例"); await page.getByRole("tab", { name: "阅读视图", exact: true }).click();
    const saved = path.join(temporary, "export.md");
    await application.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, saved);
    await page.getByLabel("文章操作", { exact: true }).click();
    await page.getByRole("menuitem", { name: "下载 MARKDOWN 原文件" }).click();
    await expect(page.getByText("原文件已保存", { exact: true })).toBeVisible();
    assert.equal(await readFile(saved, "utf8"), await readFile(path.join(source, "note.md"), "utf8"));
    await page.getByLabel("文章操作", { exact: true }).click();
    await page.getByRole("menuitem", { name: "复制本地路径" }).click();
    const canonical = await realpath(path.join(source, "note.md"));
    await expect.poll(() => application.evaluate(({ clipboard }) => clipboard.readText())).toBe(canonical);
  });
  await check("trash confirmation can cancel, then moves only fixture files through the double", async () => {
    await page.getByLabel("文章操作", { exact: true }).click(); await page.getByRole("menuitem", { name: "移入废纸篓…" }).click();
    const dialog = page.getByRole("dialog", { name: "移入废纸篓？" });
    await expect(dialog).toContainText(path.join(source, "note.md")); await expect(dialog.getByRole("button", { name: "取消" })).toBeFocused();
    await dialog.getByRole("button", { name: "取消" }).click(); await access(path.join(source, "note.md"));
    await page.getByLabel("文章操作", { exact: true }).click(); await page.getByRole("menuitem", { name: "移入废纸篓…" }).click();
    await dialog.getByRole("button", { name: "移入废纸篓", exact: true }).click();
    await expect(dialog).toBeHidden(); await access(path.join(source, "note.md.trashed-test"));
    await expect(page.getByRole("option", { name: /^Markdown 样例 / })).toHaveCount(0);
  });
  await check("production renderer and source documents make no external requests", async () => {
    assert.deepEqual(await application.evaluate(() => globalThis.__externalRequests), []);
  });
  await check("native back and forward restore filters", async () => {
    const original = await page.getByLabel("格式", { exact: true }).inputValue();
    await page.getByLabel("格式", { exact: true }).selectOption("html");
    await application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById("back").click());
    await expect(page.getByLabel("格式", { exact: true })).toHaveValue(original);
    await application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById("forward").click());
    await expect(page.getByLabel("格式", { exact: true })).toHaveValue("html");
  });
  await check("restarting the application restores navigation and local preferences", async () => {
    const saved = await page.evaluate(() => ({ hash: location.hash, theme: localStorage.getItem("ui.theme"), font: localStorage.getItem("ui.readerFont") }));
    await application.close();
    application = await _electron.launch({ args: [root], cwd: root, env, timeout: 30000 });
    page = await application.firstWindow(); page.setDefaultTimeout(15000);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(saved.hash);
    assert.deepEqual(await page.evaluate(() => ({ theme: localStorage.getItem("ui.theme"), font: localStorage.getItem("ui.readerFont") })), { theme: saved.theme, font: saved.font });
  });
  await check("a real utility-process crash restarts the library without closing the window", async () => {
    const worker = await application.evaluate(({ app }) => app.getAppMetrics().find(metric => metric.name === "PageShelf Library" || metric.serviceName === "PageShelf Library"));
    assert.ok(worker?.pid, "library utility process missing");
    await application.evaluate((_electron, pid) => { process.kill(pid, "SIGKILL"); }, worker.pid);
    await expect.poll(() => application.evaluate(({ app }, oldPid) => app.getAppMetrics().some(metric => (metric.name === "PageShelf Library" || metric.serviceName === "PageShelf Library") && metric.pid !== oldPid), worker.pid)).toBe(true);
    await expect.poll(() => page.evaluate(async () => { try { return (await window.pageshelf.invoke("items.search", { query: {} })).total; } catch { return -1; } })).toBe(5);
    await expect(page.getByRole("searchbox")).toBeVisible();
  });
  console.log(`ELECTRON_E2E ${passed} passed, 0 failed`);
} catch (error) {
  console.error(`ELECTRON_E2E ${passed} passed, 1 failed`);
  throw error;
} finally {
  await application.close();
  await rm(temporary, { recursive: true, force: true });
}
