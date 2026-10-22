import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect } from "@playwright/test";
import { JSDOM } from "jsdom";
import { createLibraryHost } from "../electron/backend/host.js";
import { createDocumentCache, documentIdentity } from "../src/cache.js";
import { parseMhtml, renderMhtml } from "../src/formats/mhtml.js";
import { mhtmlWithImage } from "../test/helpers/mhtml-image.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv.slice(2).find(value => !value.startsWith("--"));
const packaged = process.argv.includes("--packaged");
const temporary = await mkdtemp(path.join(os.tmpdir(), "pageshelf-mhtml-images-"));
const data = path.join(temporary, "data"), source = path.join(temporary, "source");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
let application;
try {
  await mkdir(data); await mkdir(source);
  const archive = file ? await readFile(file) : Buffer.from(mhtmlWithImage("MHTML 图片"));
  const archivedImages = new JSDOM(renderMhtml(archive)).window.document.querySelectorAll('img[src^="data:image/"]').length;
  assert.ok(archivedImages > 0, "fixture has no embedded image references");
  const copy = path.join(source, "archive.mhtml");
  if (file) await copyFile(file, copy); else await writeFile(copy, archive);
  await writeFile(path.join(data, "config.json"), JSON.stringify({ version: 2, roots: [{ id: "image-fixture", path: source, label: "离线图片验证", enabled: true, options: { series: "off" } }] }));

  // Simulate a previous installation whose cached document still contains remote URLs.
  const host = await createLibraryHost({ dataDir: data });
  try {
    const item = (await host.call("items.search", { query: {} })).items[0];
    const original = await host.library.readSource(item.id, "mhtml");
    const oldKey = documentIdentity({ itemId: item.id, format: "mhtml", path: original.path, stat: original.stat });
    await createDocumentCache({ directory: path.join(data, "cache/doc") }).getOrCreate(oldKey, () => parseMhtml(archive).html, { itemId: item.id });
  } finally { await host.close(); }

  const env = { ...process.env, HTML_LIBRARY_DATA_DIR: data };
  for (const name of ["ELECTRON_RUN_AS_NODE", "PAGESHELF_DEV", "PAGESHELF_SMOKE", "PAGESHELF_SCAN_SMOKE", "PAGESHELF_TEST", "PAGESHELF_TEST_TRASH"]) delete env[name];
  env.PAGESHELF_TEST = "1"; // Isolate the UI profile as well as library data; the trash double stays disabled.
  application = await _electron.launch({ ...(packaged ? { executablePath: path.join(root, "release/PageShelf-darwin-arm64/PageShelf.app/Contents/MacOS/PageShelf"), args: [] } : { args: [root] }), cwd: root, env });
  await application.evaluate(({ session }) => {
    globalThis.__imageExternalRequests = [];
    session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => { globalThis.__imageExternalRequests.push(details.url); callback({ cancel: true }); });
  });
  const page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  await expect(page.locator(".item-row")).toHaveCount(1);
  await page.locator(".item-row").click();
  await page.locator(".reading-article, #original-frame").first().waitFor();
  const readerImages = page.locator('.reading-article img[src^="data:image/"]');
  const readerCount = await readerImages.count();
  if (readerCount) {
    await readerImages.evaluateAll(images => images.forEach(image => { image.loading = "eager"; }));
    await expect.poll(() => readerImages.evaluateAll(images => images.filter(image => image.complete && image.naturalWidth > 0).length)).toBe(readerCount);
  }
  await page.getByRole("tab", { name: "原网页", exact: true }).click();
  const images = page.frameLocator("#original-frame").locator('img[src^="data:image/"]');
  await expect(images).toHaveCount(archivedImages);
  await images.evaluateAll(nodes => nodes.forEach(image => { image.loading = "eager"; }));
  await expect.poll(() => images.evaluateAll(nodes => nodes.filter(image => image.complete && image.naturalWidth > 0).length)).toBe(archivedImages);
  const visibleOriginalImages = await images.evaluateAll(nodes => nodes.filter(image => image.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })).length);
  assert.ok(visibleOriginalImages > 0, "decoded images are not visible in the source document");
  assert.deepEqual(await application.evaluate(() => globalThis.__imageExternalRequests), []);
  if (file) assert.equal(hash(await readFile(file)), hash(archive), "source archive was modified");
  console.log("MHTML_IMAGE_SMOKE_OK " + JSON.stringify({ packaged, archivedImages, readerImages: readerCount, originalImagesLoaded: archivedImages, visibleOriginalImages, legacyCacheRefreshed: true, externalRequests: 0, sourceUnchanged: true, screenshots: false }));
} finally {
  try { await application?.close(); }
  finally { await rm(temporary, { recursive: true, force: true }); }
}
