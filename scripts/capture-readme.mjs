import { _electron, expect } from "@playwright/test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Use only the bundled sample articles and an isolated configuration.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp("/tmp/pageshelf-preview-");
const output = path.join(root, "docs/images");
await mkdir(output, { recursive: true });
await cp(path.join(root, "examples/library"), path.join(temporary, "library"), { recursive: true });
const data = path.join(temporary, "data");
await mkdir(data);
await writeFile(path.join(data, "config.json"), JSON.stringify({
  version: 2, ui: {}, roots: [
    { id: "demo-reading", label: "阅读与整理", path: path.join(temporary, "library/reading") },
    { id: "demo-design", label: "设计笔记", path: path.join(temporary, "library/design") },
    { id: "demo-projects", label: "项目资料", path: path.join(temporary, "library/projects") },
  ],
}));
const env = { ...process.env, HTML_LIBRARY_DATA_DIR: data, PAGESHELF_TEST: "1" };
for (const key of ["ELECTRON_RUN_AS_NODE", "PAGESHELF_DEV", "PAGESHELF_SMOKE"]) delete env[key];
let application;
try {
  application = await _electron.launch({ args: [root], cwd: root, env, timeout: 30000 });
  const page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await expect(page.locator(".item-row")).toHaveCount(9);
  await page.getByLabel("排序", { exact: true }).selectOption("series");
  await expect(page.locator("#list-rows")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("option", { name: /^把收藏变成随时可查的资料库 / }).click();
  await expect(page.locator(".reading-article")).toContainText("从一个文件夹开始");
  await page.evaluate(() => document.fonts.ready);
  for (const [label, theme] of [["亮色", "light"], ["暗色", "dark"]]) {
    await page.getByRole("radio", { name: label, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.screenshot({ path: path.join(output, `reader-${theme}.png`), animations: "disabled" });
  }
  await page.getByRole("radio", { name: "亮色", exact: true }).click();
  await page.getByRole("searchbox", { name: "搜索资料" }).fill("搜索");
  await expect(page.locator("#list-rows")).toHaveAttribute("data-query", "搜索");
  await expect(page.locator("#list-rows")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("option", { name: /^让搜索找到真正需要的内容 / }).click();
  await expect(page.locator(".reader-hit").first()).toBeVisible();
  await page.screenshot({ path: path.join(output, "search.png"), animations: "disabled" });
  await page.getByRole("searchbox").fill("");
  await expect(page.locator(".item-row")).toHaveCount(9);
  await page.getByRole("button", { name: "添加来源目录" }).click();
  await expect(page.getByRole("dialog", { name: "目录管理" })).toBeVisible();
  await page.screenshot({ path: path.join(output, "sources.png"), animations: "disabled" });
  await page.getByRole("button", { name: "完成", exact: true }).click();

  const logo = (await readFile(path.join(root, "build/brand/pageshelf-logo.svg"))).toString("base64");
  const font = (await readFile(path.join(root, "src-ui/assets/fonts/SpaceGrotesk-Variable.woff2"))).toString("base64");
  const bannerReady = application.waitForEvent("window");
  const banner = await application.evaluate(async ({ BrowserWindow }) => {
    const win = new BrowserWindow({ width: 1600, height: 500, frame: false, useContentSize: true, show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    await win.loadURL("about:blank");
    return win.webContents.id;
  });
  const bannerPage = await bannerReady;
  for (const language of ["en", "zh"]) {
    const chinese = language === "zh";
    const html = `<!doctype html><html><meta charset="utf-8"><style>
      @font-face{font-family:Space;src:url(data:font/woff2;base64,${font})}
      *{box-sizing:border-box}body{margin:0;width:1600px;height:500px;display:flex;align-items:center;justify-content:center;text-align:center;background:#fff;background-image:radial-gradient(#e1e5ee 1.4px,transparent 1.4px);background-size:27px 27px;font-family:Space,-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#16171a}
      .inner{display:flex;align-items:center;flex-direction:column}img{width:380px;height:auto;margin-bottom:34px}h1{font-size:32px;letter-spacing:-.8px;margin:0 0 16px;font-weight:700}p{font-size:22px;line-height:1.65;color:#626773;margin:0}.tags{display:flex;gap:12px;justify-content:center;margin-top:30px}.tags span{font-size:16px;font-weight:600;padding:8px 18px;border:1px solid #dfe3eb;border-radius:99px;background:white;color:#454b57}.tags span:first-child{background:#eef2ff;border-color:#c7d2fe;color:#1e40af}
      </style><div class="inner"><img src="data:image/svg+xml;base64,${logo}" alt="PageShelf"><h1>${chinese ? "为你的本地资料，留一个安静的书架。" : "A quiet home for your saved pages."}</h1><p>${chinese ? "把网页存档与 Markdown 笔记放在一起。<br>在 Mac 上搜索、阅读，沿着系列继续思考。" : "Keep web archives and Markdown notes together.<br>Search, read, and follow the thread — right on your Mac."}</p><div class="tags"><span>Local-first</span><span>HTML</span><span>MHTML</span><span>Markdown</span><span>macOS</span></div></div></html>`;
    await application.evaluate(async ({ webContents }, { id, html }) => {
      await webContents.fromId(id).loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    }, { id: banner, html });
    await bannerPage.evaluate(() => document.fonts.ready);
    await expect(bannerPage.locator("img")).toHaveJSProperty("complete", true);
    await bannerPage.screenshot({ path: path.join(output, chinese ? "banner-zh.png" : "banner.png"), animations: "disabled" });
  }
  console.log("README_ASSETS_OK: 2 banners, 4 screenshots; sample library only");
} finally {
  if (application) await application.close();
  await rm(temporary, { recursive: true, force: true });
}
