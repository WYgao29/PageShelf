import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexHtml = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const appJs = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const stylesCss = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

test("article cards use hover actions instead of the legacy preview dialog", () => {
  assert.doesNotMatch(indexHtml, /itemDialog|打开记录|HTML 阅读内容/);
  assert.doesNotMatch(appJs, /openItem|renderReader|itemDialog|打开记录/);
  assert.match(appJs, /card-actions/);
  assert.match(appJs, /HTML 打开/);
  assert.match(appJs, /Markdown 打开/);
  assert.match(appJs, /删除/);
  assert.match(appJs, /target\s*=\s*["']_blank["']/);
  assert.match(stylesCss, /\.item-card:hover \.card-actions/);
  assert.match(stylesCss, /rgba\([^)]*,\s*0\.7\)/);
});

test("opens Markdown records in a dedicated rendered reader", async () => {
  const viewerHtmlPath = new URL("../public/markdown-viewer.html", import.meta.url);
  const viewerJsPath = new URL("../public/markdown-viewer.js", import.meta.url);
  assert.equal(existsSync(viewerHtmlPath), true, "Markdown 阅读页不存在");
  assert.equal(existsSync(viewerJsPath), true, "Markdown 渲染器不存在");
  assert.match(appJs, /markdown-viewer\.html\?source=/);
  const viewerHtml = await readFile(viewerHtmlPath, "utf8");
  const viewerJs = await readFile(viewerJsPath, "utf8");
  assert.match(viewerHtml, /markdown-viewer\.js/);
  assert.match(viewerHtml, /markdownContent/);
  assert.match(viewerHtml, /markdown-content table/);
  assert.match(viewerHtml, /markdown-content blockquote/);
  assert.match(viewerJs, /renderMarkdown/);
  assert.match(viewerJs, /escapeHtml/);
  assert.match(viewerJs, /parseTableRow/);
  assert.match(viewerJs, /blockquote/);
});

test("supports MHTML as the web source action", () => {
  assert.match(appJs, /item\.mhtml/);
  assert.match(appJs, /MHTML 打开/);
  assert.match(appJs, /sourceUrl\(item, selectedFormat, "source"\)/);
  assert.match(indexHtml, /HTML 阅读/);
});
