import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createLibraryHost,
  handleWorkerEnvelope,
} from "../electron/backend/host.js";
import {
  DESKTOP_SURFACE,
  desktopWorkerEnv,
} from "../shared/pageshelf-contract.js";
import { testTrashService } from "./helpers/fixture.js";

const text = (body) => Buffer.from(body).toString("utf8");

async function invoke(host, method, params) {
  const reply = await handleWorkerEnvelope(host, {
    id: method + ":" + Math.random().toString(16).slice(2),
    method,
    params,
  });
  if (!reply.ok)
    throw Object.assign(new Error(reply.error.message), {
      code: reply.error.code,
      details: reply.error.details,
    });
  return reply.result;
}

async function rejection(host, method, params) {
  try {
    await invoke(host, method, params);
  } catch (error) {
    return error;
  }
  throw new Error("应当失败");
}

async function withHost(callback, options = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "html-library-data-"));
  const sourceDir = await mkdtemp(path.join(os.tmpdir(), "html-library-source-"));
  await writeFile(
    path.join(sourceDir, "远程阅读.html"),
    "<html><head><title>远程阅读</title></head><body><p>这是 API 搜索内容。</p></body></html>",
  );
  const host = await createLibraryHost({
    dataDir,
    trashService: testTrashService,
    ...options,
  });
  try {
    await callback({ host, sourceDir, dataDir });
  } finally {
    await host.close();
  }
}

async function addRoot(host, sourceDir, extra = {}) {
  const added = await invoke(host, "roots.add", { path: sourceDir, ...extra });
  await host.library.scheduler.waitForIdle();
  return added;
}

function mhtmlFixture() {
  return [
    "MIME-Version: 1.0",
    'Content-Type: multipart/related; type="text/html"; boundary="mhtml-boundary"',
    "",
    "--mhtml-boundary",
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "Content-Location: http://example.test/index.html",
    "",
    '<html><head><title>MHTML 服务</title></head><body><p>通过服务读取。</p><img src="cid:image@example.test"></body></html>',
    "--mhtml-boundary",
    "Content-Type: image/png",
    "Content-Transfer-Encoding: base64",
    "Content-Location: http://example.test/image.png",
    "Content-ID: <image@example.test>",
    "",
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64"),
    "--mhtml-boundary--",
    "",
  ].join("\r\n");
}

test("worker adds a root, scans it, searches it, and reads its source", async () => {
  await withHost(async ({ host, sourceDir }) => {
    const added = await addRoot(host, sourceDir, { label: "API 样例" });
    assert.ok(added.scan.queued.length);
    assert.equal((await invoke(host, "roots.list")).totals.items, 1);
    const library = await invoke(host, "items.search", {
      query: { q: "API 搜索" },
    });
    assert.equal(library.items.length, 1);
    const source = await invoke(host, "items.source", {
      id: library.items[0].id,
      format: "html",
    });
    assert.equal(source.headers["content-type"], "text/html; charset=utf-8");
    assert.match(text(source.body), /远程阅读/);
  });
});

test("worker opens MHTML as HTML and keeps the original archive for download", async () => {
  await withHost(async ({ host, sourceDir }) => {
    const content = mhtmlFixture();
    await writeFile(path.join(sourceDir, "离线页面.mhtml"), content);
    await addRoot(host, sourceDir, { label: "MHTML" });
    const indexed = await invoke(host, "items.search", { query: {} });
    assert.equal(indexed.items.length, 2);
    const item = indexed.items.find((entry) => entry.mhtml);
    assert.equal(item.title, "MHTML 服务");
    const source = await invoke(host, "items.source", {
      id: item.id,
      format: "mhtml",
    });
    assert.equal(source.headers["content-type"], "text/html; charset=utf-8");
    const rendered = text(source.body);
    assert.match(rendered, /MHTML 服务/);
    assert.match(rendered, /data:image\/png;base64,/);
    assert.doesNotMatch(rendered, /multipart\/related|mhtml-boundary/);
    const download = await invoke(host, "items.download", {
      id: item.id,
      format: "mhtml",
    });
    assert.equal(
      download.headers["content-type"],
      'multipart/related; type="text/html"; boundary="mhtml-boundary"',
    );
    assert.match(text(download.body), /MHTML 服务/);
    const htmlRecords = await invoke(host, "items.search", {
      query: { fmt: "html" },
    });
    assert.equal(
      htmlRecords.items.some((entry) => entry.id === item.id),
      true,
    );
  });
});

test("worker rejects invalid roots and unknown source formats", async () => {
  await withHost(async ({ host }) => {
    const invalid = await rejection(host, "roots.add", {
      path: path.join(os.tmpdir(), "does-not-exist-" + Date.now()),
    });
    assert.match(invalid.message, /目录|路径/);
    const unknown = await rejection(host, "items.source", {
      id: "nope",
      format: "html",
    });
    assert.equal(unknown.code, "SOURCE_NOT_FOUND");
  });
});

test("worker removes a root without touching its source files", async () => {
  await withHost(async ({ host, sourceDir }) => {
    const added = await addRoot(host, sourceDir, { label: "待移除" });
    const removed = await invoke(host, "roots.remove", { id: added.root.id });
    assert.equal(removed.removed, added.root.id);
    await host.library.scheduler.waitForIdle();
    assert.equal((await invoke(host, "roots.list")).roots.length, 0);
    assert.equal((await invoke(host, "items.search", { query: {} })).items.length, 0);
    await access(path.join(sourceDir, "远程阅读.html"));
  });
});

test("worker moves a record to trash and drops its index entry", async () => {
  await withHost(async ({ host, sourceDir }) => {
    await addRoot(host, sourceDir, { label: "待删除" });
    const item = (await invoke(host, "items.search", { query: {} })).items[0];
    const deleted = await invoke(host, "items.trash", {
      id: item.id,
      confirm: true,
    });
    assert.equal(deleted.trashed.length, 1);
    await assert.rejects(access(path.join(sourceDir, "远程阅读.html")), {
      code: "ENOENT",
    });
    assert.equal((await invoke(host, "items.search", { query: {} })).items.length, 0);
  });
});

test("desktop surface has no auth token and worker env drops token, port, and host", async () => {
  assert.deepEqual(DESKTOP_SURFACE, {
    listens: false,
    authToken: null,
    cookies: false,
  });
  const env = desktopWorkerEnv(
    {
      AUTH_TOKEN: "review-secret",
      PORT: "4321",
      HOST: "0.0.0.0",
      PATH: "/usr/bin",
      FORCE_COLOR: "1",
      NO_COLOR: "1",
    },
    "/tmp/pageshelf-data",
  );
  assert.equal(env.AUTH_TOKEN, undefined);
  assert.equal(env.PORT, undefined);
  assert.equal(env.HOST, undefined);
  assert.equal(env.NO_COLOR, undefined);
  assert.equal(env.HTML_LIBRARY_DATA_DIR, "/tmp/pageshelf-data");
  assert.equal(env.PATH, "/usr/bin");
});

test("desktop library host does not listen on a TCP port", async () => {
  const calls = [];
  const original = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    calls.push(args);
    return original.apply(this, args);
  };
  const previous = process.env.AUTH_TOKEN;
  process.env.AUTH_TOKEN = "desktop-must-ignore";
  try {
    await withHost(async ({ host }) => {
      const listed = await invoke(host, "roots.list");
      assert.equal(listed.roots.length, 0);
      assert.equal("authToken" in listed && listed.authToken, false);
    });
    assert.equal(calls.length, 0);
  } finally {
    net.Server.prototype.listen = original;
    if (previous === undefined) delete process.env.AUTH_TOKEN;
    else process.env.AUTH_TOKEN = previous;
  }
});

test("source responses prevent executable HTML and unknown formats are not found", async () => {
  await withHost(async ({ host, sourceDir }) => {
    await addRoot(host, sourceDir);
    const item = (await invoke(host, "items.search", { query: {} })).items[0];
    const source = await invoke(host, "items.source", {
      id: item.id,
      format: "html",
    });
    assert.match(source.headers["content-security-policy"], /sandbox/);
    assert.match(
      source.headers["content-security-policy"],
      /frame-ancestors 'self'/,
    );
    assert.equal(source.headers["x-content-type-options"], "nosniff");
    const unknown = await rejection(host, "items.source", {
      id: item.id,
      format: "toString",
    });
    assert.equal(unknown.code, "SOURCE_NOT_FOUND");
  });
});

test("startup ignores invalid persisted roots instead of crashing", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "html-library-invalid-config-"));
  await writeFile(
    path.join(dataDir, "config.json"),
    JSON.stringify({ roots: [null, { label: "缺路径" }] }),
  );
  const host = await createLibraryHost({ dataDir, trashService: testTrashService });
  try {
    assert.deepEqual((await invoke(host, "roots.list")).roots, []);
  } finally {
    await host.close();
  }
});

test("worker returns the folder selected by the injected picker", async () => {
  await withHost(
    async ({ host }) => {
      assert.deepEqual(await invoke(host, "system.chooseFolder"), {
        cancelled: false,
        path: "/Users/example/Documents/对话",
      });
    },
    { chooseDirectory: async () => "/Users/example/Documents/对话" },
  );
});

test("worker reports when the folder picker is cancelled", async () => {
  await withHost(
    async ({ host }) => {
      assert.deepEqual(await invoke(host, "system.chooseFolder"), {
        cancelled: true,
      });
    },
    { chooseDirectory: async () => null },
  );
});

test("worker previews, renames, orders, disables, rescans, and removes without touching files", async () => {
  await withHost(async ({ host, sourceDir }) => {
    const stamp = (await import("node:fs/promises")).stat(
      path.join(sourceDir, "远程阅读.html"),
    );
    const mtime = (await stamp).mtimeMs;
    const preview = await invoke(host, "roots.preflight", { path: sourceDir });
    assert.equal(preview.valid, true);
    assert.equal((await invoke(host, "roots.list")).roots.length, 0);
    const add = await addRoot(host, sourceDir, { label: "资料" });
    const id = add.root.id;
    const renamed = await invoke(host, "roots.update", { id, label: "新名" });
    assert.equal(renamed.root.label, "新名");
    assert.equal(renamed.root.id, id);
    const mismatch = await rejection(host, "roots.order", { ids: [] });
    assert.equal(mismatch.code, "ORDER_MISMATCH");
    await invoke(host, "roots.order", { ids: [id] });
    await invoke(host, "roots.update", { id, enabled: false });
    await host.library.scheduler.waitForIdle();
    assert.equal((await invoke(host, "roots.list")).totals.items, 0);
    await invoke(host, "roots.update", { id, enabled: true });
    await host.library.scheduler.waitForIdle();
    assert.equal((await invoke(host, "roots.list")).totals.items, 1);
    const queued = await invoke(host, "roots.rescan", { id });
    assert.equal(queued.queued, true);
    await host.library.scheduler.waitForIdle();
    await invoke(host, "roots.remove", { id });
    await host.library.scheduler.waitForIdle();
    assert.equal((await invoke(host, "roots.list")).roots.length, 0);
    assert.equal(
      (await (await import("node:fs/promises")).stat(path.join(sourceDir, "远程阅读.html")))
        .mtimeMs,
      mtime,
    );
  });
});

test("worker documents use text/plain ETags, safe images, sandbox, and series details", async () => {
  await withHost(async ({ host, sourceDir }) => {
    const { mkdir, symlink, rename, utimes, stat } = await import("node:fs/promises");
    await mkdir(path.join(sourceDir, "nested"));
    await writeFile(path.join(sourceDir, "nested", "notes.md"), "# 图片\n![图](image.png)");
    await writeFile(
      path.join(sourceDir, "nested", "image.png"),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    await writeFile(path.join(sourceDir, "nested", "fake.png"), "secret text");
    await symlink("/etc/passwd", path.join(sourceDir, "nested", "link.png"));
    await addRoot(host, sourceDir);
    const list = await invoke(host, "items.search", { query: {} });
    assert.equal(list.total, 2);
    const item = list.items.find((entry) => entry.html);
    const markdown = list.items.find((entry) => entry.markdown);
    const detail = await invoke(host, "items.get", { id: item.id });
    assert.equal(detail.files.length, 1);
    const doc = await invoke(host, "items.document", { id: item.id });
    assert.equal(doc.headers["content-type"], "text/plain; charset=utf-8");
    const etag = doc.headers.etag;
    const cached = await invoke(host, "items.document", {
      id: item.id,
      ifNoneMatch: etag,
    });
    assert.equal(cached.notModified, true);
    assert.equal(cached.body, null);
    const original = await invoke(host, "items.original", { id: item.id });
    assert.match(original.headers["content-security-policy"], /sandbox/);
    const info = await stat(path.join(sourceDir, "远程阅读.html"));
    await rename(
      path.join(sourceDir, "远程阅读.html"),
      path.join(sourceDir, "old-test"),
    );
    await writeFile(
      path.join(sourceDir, "远程阅读.html"),
      "<p>replacement body</p>".padEnd(info.size, " "),
    );
    await utimes(path.join(sourceDir, "远程阅读.html"), info.atime, info.mtime);
    const replaced = await invoke(host, "items.document", {
      id: item.id,
      ifNoneMatch: etag,
    });
    assert.equal(replaced.notModified, false);
    assert.notEqual(replaced.headers.etag, etag);
    assert.match(text(replaced.body), /replacement body/);
    const image = await invoke(host, "items.asset", {
      id: markdown.id,
      path: "image.png",
    });
    assert.equal(image.headers["content-type"], "image/png");
    assert.equal(image.headers["x-content-type-options"], "nosniff");
    for (const assetPath of ["../../../../etc/passwd", "../遠程.md", "fake.png", "link.png"]) {
      const missing = await rejection(host, "items.asset", {
        id: markdown.id,
        path: assetPath,
      });
      assert.equal(missing.code, "SOURCE_NOT_FOUND");
    }
    const unconfirmed = await rejection(host, "items.trash", {
      id: item.id,
      confirm: false,
    });
    assert.equal(unconfirmed.code, "CONFIRM_REQUIRED");
    const trash = await invoke(host, "items.trash", { id: item.id, confirm: true });
    assert.equal(trash.trashed.length, 1);
  });
});

test("system reveal accepts only known targets and uses fixed argv", async () => {
  const calls = [];
  await withHost(
    async ({ host }) => {
      const allowed = await invoke(host, "system.openTrash");
      assert.equal(allowed.revealed, true);
      assert.equal(calls[0][0], "/usr/bin/open");
      assert.deepEqual(calls[0][1], ["-a", "Finder", path.join(os.homedir(), ".Trash")]);
      const refused = await rejection(host, "system.reveal", {
        path: "/etc/passwd",
      });
      assert.equal(refused.code, "INVALID_PARAMS");
      assert.equal(calls.length, 1);
    },
    {
      systemExecFile: async (...args) => {
        calls.push(args);
      },
    },
  );
});

test("future config stays byte identical while browsing, scanning, and cache maintenance work", async () => {
  const { withTempFixture } = await import("./helpers/fixture.js");
  await withTempFixture(async (directory) => {
    const source = path.join(directory, "source");
    await (await import("node:fs/promises")).mkdir(source);
    await writeFile(path.join(source, "notes.md"), "# readonly");
    const config = JSON.stringify({
      version: 9,
      roots: [
        {
          id: "future",
          path: source,
          label: "未来版本",
          enabled: true,
          options: { series: "auto" },
        },
      ],
    });
    await writeFile(path.join(directory, "config.json"), config);
    const host = await createLibraryHost({
      dataDir: directory,
      trashService: testTrashService,
      chooseDirectory: async () => source,
    });
    try {
      assert.equal((await invoke(host, "roots.list")).readOnly, true);
      const item = (await invoke(host, "items.search", { query: {} })).items[0];
      assert.equal(
        (await rejection(host, "roots.update", { id: "future", label: "no" })).code,
        "CONFIG_READ_ONLY",
      );
      assert.equal(
        (await rejection(host, "items.trash", { id: item.id, confirm: true })).code,
        "CONFIG_READ_ONLY",
      );
      const scan = await invoke(host, "scan.all", {});
      assert.ok(scan.queued.includes("future"));
      await host.library.scheduler.waitForIdle();
      await invoke(host, "system.clearCache");
      assert.deepEqual(await invoke(host, "system.chooseFolder"), {
        cancelled: false,
        path: source,
      });
      assert.equal(
        await readFile(path.join(directory, "config.json"), "utf8"),
        config,
      );
    } finally {
      await host.close();
    }
  });
});

test("partial trash retains surviving formats and failed trash preserves files", async () => {
  const { withTempFixture } = await import("./helpers/fixture.js");
  const { mkdir, rename } = await import("node:fs/promises");
  await withTempFixture(async (directory) => {
    const root = path.join(directory, "source");
    await mkdir(root);
    await writeFile(path.join(root, "paired.html"), "<article>HTML</article>");
    await writeFile(path.join(root, "paired.md"), "# Markdown");
    await writeFile(
      path.join(directory, "config.json"),
      JSON.stringify({
        version: 2,
        roots: [
          {
            id: "r",
            path: root,
            label: "R",
            enabled: true,
            options: { series: "auto" },
          },
        ],
      }),
    );
    let failAll = false;
    const trashService = {
      async trashFiles({ paths }) {
        if (failAll)
          throw Object.assign(Error("全部失败，文件未改动"), { code: "TRASH_FAILED" });
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
    const host = await createLibraryHost({ dataDir: directory, trashService });
    try {
      const item = (await invoke(host, "items.search", { query: {} })).items[0];
      const partial = await invoke(host, "items.trash", {
        id: item.id,
        confirm: true,
      });
      assert.equal(partial.failed.length, 1);
      assert.equal(partial.trashed.length, 1);
      const survivor = await invoke(host, "items.get", { id: item.id });
      assert.equal(survivor.files.length, 1);
      assert.equal(survivor.item.html, null);
      assert.ok(survivor.item.markdown);
      failAll = true;
      const failed = await rejection(host, "items.trash", {
        id: item.id,
        confirm: true,
      });
      assert.equal(failed.code, "TRASH_FAILED");
      assert.equal(await readFile(path.join(root, "paired.md"), "utf8"), "# Markdown");
    } finally {
      await host.close();
    }
  });
});

test("root contract exposes scan totals, affected series, and validation codes", async () => {
  const { withTempFixture, createLegacyFixture } = await import("./helpers/fixture.js");
  await withTempFixture(async (directory) => {
    const fixture = await createLegacyFixture(directory);
    const host = await createLibraryHost({
      dataDir: fixture.dataDir,
      trashService: testTrashService,
    });
    try {
      await host.library.scheduler.waitForIdle();
      const roots = (await invoke(host, "roots.list")).roots;
      assert.equal(roots[0].state.lastScan.files, 48);
      assert.equal(roots[0].state.lastScan.items, 48);
      assert.ok(roots[0].state.lastScan.startedAt);
      const preview = await invoke(host, "roots.preflight", {
        path: path.join(fixture.rootPath, "腾讯云ADP-FDE认证课程"),
      });
      assert.deepEqual(preview.overlap.affectedSeries, [
        { name: "腾讯云ADP-FDE认证课程", count: 4 },
      ]);
      const label = await rejection(host, "roots.update", {
        id: roots[0].id,
        label: "",
      });
      assert.equal(label.code, "LABEL_INVALID");
      const order = await rejection(host, "roots.order", { ids: [] });
      assert.equal(order.code, "ORDER_MISMATCH");
    } finally {
      await host.close();
    }
  });
});
