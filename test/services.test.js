import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDocumentCache } from "../src/cache.js";
import { createConfigStore } from "../src/config.js";
import { createLibrary } from "../src/library.js";
import { createRootRegistry } from "../src/roots.js";
import {
  SOURCE_CSP,
  clearCache,
  getItem,
  readAsset,
  readDocument,
  readItemFile,
  requireItem,
  search,
  trashItem,
} from "../src/services/items.js";
import {
  assertKnownRoot,
  listRoots,
  orderRoots,
  removeRoot,
  saveRoot,
  scanAll,
  scanStatus,
} from "../src/services/roots.js";
import { chooseFolder, reveal } from "../src/services/system.js";
import { mhtml, testTrashService, withTempFixture } from "./helpers/fixture.js";

async function openLibrary(directory, { trashService = testTrashService, files = [], roots } = {}) {
  const dataDir = path.join(directory, "data"),
    sourceDir = path.join(directory, "source");
  await mkdir(dataDir, { recursive: true });
  await mkdir(sourceDir, { recursive: true });
  for (const [name, content] of files) {
    const target = path.join(sourceDir, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  if (roots)
    await writeFile(
      path.join(dataDir, "config.json"),
      JSON.stringify({ version: 2, roots: roots(sourceDir) }),
    );
  const registry = createRootRegistry({
    configStore: createConfigStore({ dataDir }),
  });
  await registry.load();
  const library = createLibrary({ rootRegistry: registry, trashService });
  const cache = createDocumentCache({
    directory: path.join(dataDir, "cache", "doc"),
  });
  const listed = registry.list();
  listed.forEach((root) => library.scheduler.enqueue(root.id, {}));
  if (listed.length) await library.scheduler.waitForRoot(listed[0].id);
  await library.scheduler.waitForIdle();
  return { dataDir, sourceDir, library, registry, cache };
}

test("root services preview, add, scan, and remove without changing source bytes", async () => {
  await withTempFixture(async (directory) => {
    const opened = await openLibrary(directory, {
      files: [["远程阅读.html", "<html><head><title>远程阅读</title></head><body><p>这是 API 搜索内容。</p></body></html>"]],
    });
    const { sourceDir, library, registry } = opened;
    const sourceFile = path.join(sourceDir, "远程阅读.html");
    const before = await readFile(sourceFile);
    const missing = path.join(sourceDir, "missing");
    await assert.rejects(
      () =>
        saveRoot({
          library,
          registry,
          mode: "add",
          body: { path: missing },
        }),
      (error) => error.code === "ROOT_MISSING",
    );
    const preview = await saveRoot({
      library,
      registry,
      mode: "add",
      body: { path: sourceDir, label: "API 样例" },
      dryRun: true,
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.json.valid, true);
    assert.equal(preview.json.checks.isDirectory, true);
    assert.equal(preview.json.checks.indexable.items, 1);
    assert.equal(registry.list().length, 0);

    const added = await saveRoot({
      library,
      registry,
      mode: "add",
      body: { path: sourceDir, label: "API 样例" },
    });
    assert.equal(added.status, 201);
    assert.ok(added.json.scan.queued.length);
    await library.scheduler.waitForIdle();
    const listed = listRoots({ library, registry });
    assert.equal(listed.status, 200);
    assert.equal(listed.json.totals.items, 1);
    assert.equal(listed.json.readOnly, false);
    const found = search({ library, query: { q: "API 搜索" } });
    assert.equal(found.status, 200);
    assert.equal(found.json.items.length, 1);
    const source = await readItemFile({
      library,
      id: found.json.items[0].id,
      format: "html",
      action: "source",
    });
    assert.equal(source.status, 200);
    assert.equal(source.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(source.headers["content-security-policy"], SOURCE_CSP);
    assert.equal(source.headers["x-content-type-options"], "nosniff");
    assert.match(source.headers["content-disposition"], /^inline; filename\*=UTF-8''/);
    assert.match(String(source.body), /远程阅读/);
    assert.match(SOURCE_CSP, /script-src 'none'/);

    const queued = scanAll({ library, registry, full: false });
    assert.equal(queued.status, 202);
    assert.deepEqual(queued.json.queued, [added.json.root.id]);
    await library.scheduler.waitForIdle();
    assert.deepEqual(scanStatus({ library }).json, { running: [], queued: [] });

    const removed = await removeRoot({
      library,
      registry,
      id: added.json.root.id,
    });
    assert.equal(removed.status, 200);
    assert.equal(removed.json.removed, added.json.root.id);
    await library.scheduler.waitForIdle();
    assert.equal(listRoots({ library, registry }).json.roots.length, 0);
    assert.equal(search({ library, query: {} }).json.items.length, 0);
    assert.deepEqual(await readFile(sourceFile), before);
    assert.throws(
      () => assertKnownRoot({ registry, id: added.json.root.id }),
      (error) => error.code === "ROOT_NOT_FOUND",
    );
  });
});

test("root preview reports child overlap and does not save", async () => {
  await withTempFixture(async (directory) => {
    const { sourceDir, library, registry } = await openLibrary(directory);
    const child = path.join(sourceDir, "child");
    await mkdir(child);
    await writeFile(path.join(sourceDir, "parent.md"), "# Parent\n\nParent body.");
    await writeFile(path.join(child, "child.md"), "# Child\n\nChild body.");
    const added = await saveRoot({
      library,
      registry,
      mode: "add",
      body: { path: sourceDir, label: "Parent" },
    });
    await library.scheduler.waitForIdle();
    const preview = await saveRoot({
      library,
      registry,
      mode: "add",
      body: { path: child, label: "Child" },
      dryRun: true,
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.json.valid, true);
    assert.equal(preview.json.overlap.type, "child_of");
    assert.equal(preview.json.overlap.parent.id, added.json.root.id);
    assert.equal(preview.json.overlap.moved, 1);
    assert.ok(Array.isArray(preview.json.overlap.affectedSeries));
    assert.equal(registry.list().length, 1);
    await assert.rejects(
      () => orderRoots({ library, registry, ids: [added.json.root.id, "missing"] }),
      (error) => error.code === "ORDER_MISMATCH",
    );
  });
});

test("item services keep source CSP, ETags, image checks, and boundaries", async () => {
  await withTempFixture(async (directory) => {
    const nested = path.join("nested");
    const { sourceDir, library, registry, cache } = await openLibrary(directory, {
      files: [
        [
          "远程阅读.html",
          "<html><head><title>远程阅读</title></head><body><p>正文。</p></body></html>",
        ],
        [path.join(nested, "notes.md"), "# 图片\n![图](image.png)"],
        [
          path.join(nested, "image.png"),
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        ],
        [path.join(nested, "fake.png"), "secret text"],
      ],
    });
    await symlink("/etc/passwd", path.join(sourceDir, nested, "link.png"));
    const added = await saveRoot({
      library,
      registry,
      mode: "add",
      body: { path: sourceDir },
    });
    await library.scheduler.waitForIdle();
    const list = search({ library, query: {} }).json;
    assert.equal(list.total, 2);
    const item = list.items.find((entry) => entry.html),
      markdown = list.items.find((entry) => entry.markdown);
    const detail = getItem({ library, id: item.id });
    assert.equal(detail.status, 200);
    assert.equal(detail.json.files.length, 1);
    assert.throws(
      () => requireItem({ library, id: "missing" }),
      (error) => error.code === "SOURCE_NOT_FOUND",
    );
    await assert.rejects(
      () =>
        readItemFile({
          library,
          id: item.id,
          format: "toString",
          action: "source",
        }),
      (error) => error.code === "SOURCE_NOT_FOUND",
    );

    const document = await readDocument({
      library,
      cache,
      id: item.id,
      action: "document",
    });
    assert.equal(document.status, 200);
    assert.equal(document.headers["content-type"], "text/plain; charset=utf-8");
    assert.equal(document.headers["x-content-type-options"], "nosniff");
    assert.equal(document.headers["content-security-policy"], undefined);
    assert.equal(document.headers["x-source-format"], "html");
    const etag = document.headers.etag;
    const cached = await readDocument({
      library,
      cache,
      id: item.id,
      action: "document",
      ifNoneMatch: etag,
    });
    assert.equal(cached.status, 304);
    assert.equal(cached.body, undefined);
    assert.equal(cached.headers.etag, etag);
    const original = await readDocument({
      library,
      cache,
      id: item.id,
      action: "original",
      ifNoneMatch: etag,
    });
    assert.equal(original.status, 304);
    assert.equal(original.headers["content-security-policy"], SOURCE_CSP);

    const info = await import("node:fs/promises").then((fs) =>
      fs.stat(path.join(sourceDir, "远程阅读.html")),
    );
    await rename(
      path.join(sourceDir, "远程阅读.html"),
      path.join(sourceDir, "old-test"),
    );
    await writeFile(
      path.join(sourceDir, "远程阅读.html"),
      "<p>replacement body</p>".padEnd(info.size, " "),
    );
    await utimes(
      path.join(sourceDir, "远程阅读.html"),
      info.atime,
      info.mtime,
    );
    const replaced = await readDocument({
      library,
      cache,
      id: item.id,
      action: "document",
      ifNoneMatch: etag,
    });
    assert.equal(replaced.status, 200);
    assert.notEqual(replaced.headers.etag, etag);
    assert.match(String(replaced.body), /replacement body/);

    const asset = await readAsset({
      library,
      registry,
      id: markdown.id,
      assetPath: "image.png",
    });
    assert.equal(asset.status, 200);
    assert.equal(asset.headers["content-type"], "image/png");
    assert.equal(asset.headers["content-security-policy"], SOURCE_CSP);
    assert.equal(asset.headers["x-content-type-options"], "nosniff");
    for (const assetPath of [
      "../../../../etc/passwd",
      "../遠程.md",
      "fake.png",
      "link.png",
      "image.png\0",
    ])
      await assert.rejects(
        () => readAsset({ library, registry, id: markdown.id, assetPath }),
        (error) => error.code === "SOURCE_NOT_FOUND",
      );
    await assert.rejects(
      () =>
        readAsset({
          library,
          registry,
          id: markdown.id,
          assetPath: "fake.png",
        }),
      (error) => error.message === "仅支持本地图片",
    );
    const download = await readItemFile({
      library,
      id: markdown.id,
      format: "markdown",
      action: "download",
    });
    assert.match(download.headers["content-disposition"], /^attachment; filename\*=UTF-8''/);
    assert.equal(download.headers["content-security-policy"], SOURCE_CSP);
    assert.match(String(download.body), /图片/);
    const cleared = await clearCache({ cache });
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.json, { cleared: true });
    assert.equal(added.status, 201);
  });
});

test("HTML downloads preserve the original bytes for non-UTF-8 files", async () => {
  await withTempFixture(async (directory) => {
    const fixtures = [
      ["latin.html", "windows-1252", Buffer.from([0x43, 0x61, 0x66, 0xe9]), "Café"],
      ["chinese.html", "gbk", Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), "中文"],
    ];
    const { sourceDir, library, registry } = await openLibrary(directory, {
      files: fixtures.map(([name, charset, title]) => [name, Buffer.concat([
        Buffer.from(`<meta charset="${charset}"><title>`), title,
        Buffer.from("</title><p>Original source bytes</p>"),
      ])]),
    });
    await saveRoot({ library, registry, mode: "add", body: { path: sourceDir } });
    await library.scheduler.waitForIdle();
    for (const [name, , , title] of fixtures) {
      const item = library.getSnapshot().items.find(entry => entry.title === title);
      assert.ok(item, "the declared source encoding should still be read correctly");
      const result = await readItemFile({ library, id: item.id, format: "html", action: "download" });
      assert.deepEqual(Buffer.from(result.body), await readFile(path.join(sourceDir, name)));
    }
  });
});

test("MHTML source is rendered HTML and download keeps the archive", async () => {
  await withTempFixture(async (directory) => {
    const { sourceDir, library, registry } = await openLibrary(directory);
    const archive = mhtml("MHTML 服务");
    await writeFile(path.join(sourceDir, "离线页面.mhtml"), archive);
    await saveRoot({
      library,
      registry,
      mode: "add",
      body: { path: sourceDir, label: "MHTML" },
    });
    await library.scheduler.waitForIdle();
    const item = search({ library, query: { fmt: "html" } }).json.items.find(
      (entry) => entry.mhtml,
    );
    assert.equal(item.title, "MHTML 服务");
    const source = await readItemFile({
      library,
      id: item.id,
      format: "mhtml",
      action: "source",
    });
    assert.equal(source.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(source.headers["content-security-policy"], SOURCE_CSP);
    assert.equal(source.headers["x-content-type-options"], "nosniff");
    assert.match(String(source.body), /MHTML 服务/);
    assert.doesNotMatch(String(source.body), /multipart\/related/);
    const download = await readItemFile({
      library,
      id: item.id,
      format: "mhtml",
      action: "download",
    });
    assert.match(download.headers["content-type"], /multipart\/related/);
    assert.match(download.headers["content-disposition"], /^attachment;/);
    assert.equal(download.headers["content-security-policy"], SOURCE_CSP);
    assert.equal(download.headers["x-content-type-options"], "nosniff");
    assert.equal(String(download.body), archive);
    assert.notEqual(String(download.body), String(source.body));
  });
});

test("trash requires confirmation, keeps partial survivors, and preserves files on total failure", async () => {
  await withTempFixture(async (directory) => {
    let failAll = false,
      invalidations = 0;
    const root = path.join(directory, "source");
    await mkdir(root);
    await writeFile(path.join(root, "paired.html"), "<article>HTML</article>");
    await writeFile(path.join(root, "paired.md"), "# Markdown");
    const trashService = {
      async trashFiles({ paths }) {
        if (failAll)
          throw Object.assign(new Error("全部失败，文件未改动"), {
            code: "TRASH_FAILED",
          });
        const html = paths.find((file) => file.endsWith(".html"));
        await rename(html, html + ".trashed-test");
        return {
          trashed: [html],
          failed: paths
            .filter((file) => file !== html)
            .map((file) => ({ path: file, message: "permission denied" })),
          method: "test",
        };
      },
    };
    const { library, registry, cache } = await openLibrary(directory, {
      trashService,
      roots: (sourceDir) => [
        {
          id: "r",
          path: sourceDir,
          label: "R",
          enabled: true,
          options: { series: "auto" },
        },
      ],
    });
    const counting = {
      clear: () => cache.clear(),
      getOrCreate: (...args) => cache.getOrCreate(...args),
      invalidateItem: async (id) => {
        invalidations += 1;
        await cache.invalidateItem(id);
      },
    };
    const item = search({ library, query: {} }).json.items[0];
    await assert.rejects(
      () =>
        trashItem({
          library,
          cache: counting,
          id: item.id,
          confirm: false,
        }),
      (error) => error.code === "CONFIRM_REQUIRED" && error.status === 400,
    );
    assert.equal(invalidations, 0);
    const partial = await trashItem({
      library,
      cache: counting,
      id: item.id,
      confirm: true,
    });
    assert.equal(partial.status, 207);
    assert.equal(partial.json.itemId, item.id);
    assert.equal(partial.json.failed.length, 1);
    const survivor = getItem({ library, id: item.id }).json;
    assert.equal(survivor.files.length, 1);
    assert.equal(survivor.item.html, null);
    assert.ok(survivor.item.markdown);
    failAll = true;
    await assert.rejects(
      () =>
        trashItem({
          library,
          cache: counting,
          id: item.id,
          confirm: true,
        }),
      (error) => error.code === "TRASH_FAILED",
    );
    assert.equal(invalidations, 2);
    assert.equal(
      await readFile(path.join(root, "paired.md"), "utf8"),
      "# Markdown",
    );
    assert.equal(registry.get("r").id, "r");
  });
});

test("system services trim chosen folders and reveal only known targets", async () => {
  await withTempFixture(async (directory) => {
    const calls = [];
    const cancelled = await chooseFolder({ chooseDirectory: async () => null });
    assert.deepEqual(cancelled.json, { cancelled: true });
    const chosen = await chooseFolder({
      chooseDirectory: async () => "  /Users/example/Documents/对话  ",
    });
    assert.deepEqual(chosen.json, {
      cancelled: false,
      path: "/Users/example/Documents/对话",
    });
    await assert.rejects(
      () => chooseFolder({ chooseDirectory: async () => "   " }),
      (error) => error.code === "FOLDER_PICKER_UNAVAILABLE",
    );
    const { sourceDir, library, registry } = await openLibrary(directory, {
      files: [["note.md", "# Note\n\nBody."]],
    });
    const added = await saveRoot({
      library,
      registry,
      mode: "add",
      body: { path: sourceDir, label: "Notes" },
    });
    await library.scheduler.waitForIdle();
    const exec = async (...args) => {
      calls.push(args);
    };
    const trash = await reveal({
      body: { trash: true },
      registry,
      library,
      systemExecFile: exec,
    });
    assert.equal(trash.status, 200);
    assert.deepEqual(trash.json, { revealed: true });
    assert.deepEqual(calls[0], [
      "/usr/bin/open",
      ["-a", "Finder", path.join(os.homedir(), ".Trash")],
      { timeout: 15000 },
    ]);
    await assert.rejects(
      () =>
        reveal({
          body: { path: "/etc/passwd" },
          registry,
          library,
          systemExecFile: exec,
        }),
      (error) => error.code === "INVALID_REVEAL",
    );
    assert.equal(calls.length, 1);
    const item = search({ library, query: {} }).json.items[0];
    await reveal({
      body: { itemId: item.id },
      registry,
      library,
      systemExecFile: exec,
    });
    assert.equal(calls[1][0], "/usr/bin/open");
    assert.deepEqual(calls[1][1], [
      "-R",
      await realpath(path.join(sourceDir, "note.md")),
    ]);
    await reveal({
      body: { rootId: added.json.root.id },
      registry,
      library,
      systemExecFile: exec,
    });
    assert.deepEqual(calls[2][1], ["-R", await realpath(sourceDir)]);
    await assert.rejects(
      () =>
        reveal({
          body: { rootId: "missing" },
          registry,
          library,
          systemExecFile: exec,
        }),
      (error) => error.code === "ROOT_NOT_FOUND",
    );
    assert.equal(calls.length, 3);
  });
});
