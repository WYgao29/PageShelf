import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, readFile, access, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect } from "@playwright/test";
import { html, mhtml } from "../test/helpers/fixture.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(os.tmpdir(), "pageshelf-e2e-"));
const data = path.join(temporary, "data");
const source = path.join(temporary, "source");
await mkdir(data); await mkdir(source);
await writeFile(path.join(data, "config.json"), JSON.stringify({ version: 2, roots: [], ui: {} }));
await writeFile(path.join(source, "alpha.html"), html("HTML 样例"));
await writeFile(path.join(source, "archive.mhtml"), mhtml("MHTML 样例"));
await writeFile(path.join(source, "note.md"), "# Markdown 样例\n\n## 小节\n短笔记，证据与**方法**。\n\n![外部](https://example.test/blocked.png)");
await writeFile(path.join(source, "short.html"), html("短文样例", "短文"));
await writeFile(path.join(source, "evil.html"), html("恶意样例", "正文证据。".repeat(80)) + '<h2>恶意样例原文</h2><script>globalThis.__xss = 1; fetch("https://example.test/evil")</script><img src="https://example.test/evil.png" onerror="globalThis.__xss=1"><a href="https://example.test/article">原文外链</a>');

const env = { ...process.env, HTML_LIBRARY_DATA_DIR: data, PAGESHELF_TEST: "1", PAGESHELF_TEST_TRASH: "1" };
delete env.ELECTRON_RUN_AS_NODE; delete env.PAGESHELF_DEV; delete env.PAGESHELF_SMOKE;
const application = await _electron.launch({ args: [root], cwd: root, env, timeout: 30000 });
const page = await application.firstWindow();
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
    await page.getByRole("button", { name: "＋ 添加目录" }).click();
    const manager = page.getByRole("dialog", { name: "目录管理" });
    await manager.getByLabel("目录路径", { exact: true }).fill(source);
    await manager.getByLabel("新目录显示名").fill("验收夹具");
    await expect(manager.locator("#add-root")).toBeEnabled();
    await manager.locator("#add-root").click();
    await manager.getByRole("button", { name: "完成", exact: true }).click();
    await expect(page.locator(".item-row")).toHaveCount(5);
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
  await check("MHTML decoded through worker and reader", async () => {
    await open("MHTML 样例"); await expect(page.locator(".reading-article")).toContainText("证据应当可复核");
  });
  await check("Markdown short-note reading and raw source text", async () => {
    await open("Markdown 样例"); await expect(page.locator(".reading-article")).toContainText("短笔记");
    await expect(page.locator(".image-placeholder")).toContainText("外部图片未加载");
    await page.getByRole("tab", { name: "源文本", exact: true }).click();
    await expect(page.locator(".source-text")).toContainText("证据与**方法**");
    await page.getByRole("tab", { name: "阅读视图", exact: true }).click();
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
    await expect(page.locator(".item-row")).toHaveCount(0);
  });
  await check("production renderer and source documents make no external requests", async () => {
    assert.deepEqual(await application.evaluate(() => globalThis.__externalRequests), []);
  });
  console.log(`ELECTRON_E2E ${passed} passed, 0 failed`);
} catch (error) {
  console.error(`ELECTRON_E2E ${passed} passed, 1 failed`);
  throw error;
} finally {
  await application.close();
  await rm(temporary, { recursive: true, force: true });
}
