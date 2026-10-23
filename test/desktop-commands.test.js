import assert from "node:assert/strict";
import test from "node:test";
import { commandForInput, COMMANDS } from "../shared/commands.js";
import { rewriteExternalAnchors, sourceExternalLink } from "../electron/external-links.js";
import { createLibraryHost } from "../electron/backend/host.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { withTempFixture, html } from "./helpers/fixture.js";
import { testTrashFor } from "../electron/test-trash.js";

test("native accelerators have one owner and single letters stay in the renderer", () => {
  assert.equal(commandForInput({ type: "keyDown", key: "K", meta: true }, "darwin"), "focus-search");
  assert.equal(commandForInput({ type: "keyUp", key: "K", meta: true }, "darwin"), null);
  assert.equal(commandForInput({ type: "keyDown", key: "k", control: true }, "darwin"), null);
  assert.equal(commandForInput({ type: "keyDown", key: "k", control: true }, "win32"), "focus-search");
  assert.equal(commandForInput({ type: "keyDown", key: "t" }, "darwin"), null);
  assert.equal(new Set(COMMANDS.map(command => command.id)).size, COMMANDS.length);
});
test("trash double is opt-in and refuses data outside an E2E temporary tree", async () => {
  assert.equal(await testTrashFor({}), undefined);
  await assert.rejects(() => testTrashFor({ PAGESHELF_TEST: "1", PAGESHELF_TEST_TRASH: "1", HTML_LIBRARY_DATA_DIR: process.cwd() }), /E2E 临时目录/);
});

test("original-document external anchors use a validated local navigation without scripts", () => {
  const rewritten = rewriteExternalAnchors('<a href="https://example.test/a?x=1&amp;y=2" target="_blank">外链</a><a href="#section">目录</a>', "a");
  const local = rewritten.match(/href="([^"]+)"/)[1];
  assert.equal(sourceExternalLink(local), "https://example.test/a?x=1&y=2");
  assert.doesNotMatch(rewritten, /target=/);
  assert.match(rewritten, /href="#section"/);
  assert.equal(sourceExternalLink("pageshelf://source/a/external?url64=" + Buffer.from("javascript:alert(1)").toString("base64url")), null);
  assert.equal(sourceExternalLink("https://example.test"), null);
});

test("desktop worker becomes available while the first configured root is scanning", async () => {
  await withTempFixture(async directory => {
    const source = path.join(directory, "source"), data = path.join(directory, "data");
    await mkdir(source); await mkdir(data);
    await writeFile(path.join(source, "article.html"), html("启动扫描"));
    await writeFile(path.join(data, "config.json"), JSON.stringify({ version: 2, roots: [{ id: "r", path: source, label: "来源", enabled: true, options: { series: "off" } }] }));
    const host = await createLibraryHost({ dataDir: data, waitForInitialScan: false });
    try {
      const status = await host.call("scan.status");
      assert.equal(status.running.length, 1);
      assert.equal((await host.call("roots.list")).roots[0].label, "来源");
      await host.library.scheduler.waitForIdle();
      assert.equal((await host.call("items.search", { query: {} })).items[0].title, "启动扫描");
    } finally { await host.close(); }
  });
});
