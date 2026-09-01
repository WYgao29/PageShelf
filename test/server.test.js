import assert from "node:assert/strict";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer } from "../src/server.js";

async function withServer(callback) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "html-library-data-"));
  const sourceDir = await mkdtemp(path.join(os.tmpdir(), "html-library-source-"));
  await writeFile(
    path.join(sourceDir, "远程阅读.html"),
    "<html><head><title>远程阅读</title></head><body><p>这是 API 搜索内容。</p></body></html>",
  );
  const server = createServer({ dataDir });
  await server.ready;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = "http://127.0.0.1:" + address.port;
  try {
    await callback({ baseUrl, sourceDir });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function withConfiguredServer(options, callback) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "html-library-auth-data-"));
  const server = createServer({ dataDir, ...options });
  await server.ready;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = "http://127.0.0.1:" + server.address().port;
  try {
    await callback({ baseUrl });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function jsonRequest(baseUrl, route, options = {}) {
  const response = await fetch(baseUrl + route, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  return { response, body: await response.json() };
}

test("API adds a root, scans it, searches it, and reads its source", async () => {
  await withServer(async ({ baseUrl, sourceDir }) => {
    const added = await jsonRequest(baseUrl, "/api/settings/roots", {
      method: "POST",
      body: JSON.stringify({ path: sourceDir, label: "API 样例" }),
    });
    assert.equal(added.response.status, 201);
    assert.equal(added.body.scan.stats.items, 1);

    const library = await jsonRequest(baseUrl, "/api/library?q=API%20搜索");
    assert.equal(library.response.status, 200);
    assert.equal(library.body.items.length, 1);
    const item = library.body.items[0];

    const source = await fetch(baseUrl + "/api/items/" + encodeURIComponent(item.id) + "/source/html");
    assert.equal(source.status, 200);
    assert.equal(source.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(await source.text(), /远程阅读/);
  });
});

test("API rejects invalid roots and unknown source formats", async () => {
  await withServer(async ({ baseUrl }) => {
    const invalid = await jsonRequest(baseUrl, "/api/settings/roots", {
      method: "POST",
      body: JSON.stringify({ path: path.join(os.tmpdir(), "does-not-exist") }),
    });
    assert.equal(invalid.response.status, 400);
    assert.match(invalid.body.error, /目录|路径/);

    const unknown = await fetch(baseUrl + "/api/items/nope/source/html");
    assert.equal(unknown.status, 404);
  });
});

test("serves the unified library app shell", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(baseUrl + "/");
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /我的对话库/);
    assert.match(html, /删除记录/);
  });
});

test("API removes a root without touching its source files", async () => {
  await withServer(async ({ baseUrl, sourceDir }) => {
    const added = await jsonRequest(baseUrl, "/api/settings/roots", {
      method: "POST",
      body: JSON.stringify({ path: sourceDir, label: "待移除" }),
    });
    const rootId = added.body.root.id;
    const removed = await fetch(baseUrl + "/api/settings/roots/" + encodeURIComponent(rootId), { method: "DELETE" });
    assert.equal(removed.status, 200);
    const settings = await (await fetch(baseUrl + "/api/settings")).json();
    assert.equal(settings.roots.length, 0);
    assert.equal((await (await fetch(baseUrl + "/api/library")).json()).items.length, 0);
  });
});

test("API deletes a record's source file and index entry", async () => {
  await withServer(async ({ baseUrl, sourceDir }) => {
    const added = await jsonRequest(baseUrl, "/api/settings/roots", {
      method: "POST",
      body: JSON.stringify({ path: sourceDir, label: "待删除" }),
    });
    const item = added.body.scan.items[0];
    const deleted = await fetch(baseUrl + "/api/items/" + encodeURIComponent(item.id), { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).scan.stats.items, 0);
    await assert.rejects(access(path.join(sourceDir, "远程阅读.html")), { code: "ENOENT" });
    assert.equal((await (await fetch(baseUrl + "/api/library")).json()).items.length, 0);
  });
});

test("protected servers reject unauthenticated requests and support token bootstrap", async () => {
  await withConfiguredServer({ authToken: "review-secret" }, async ({ baseUrl }) => {
    const denied = await fetch(baseUrl + "/api/settings");
    assert.equal(denied.status, 401);

    const bootstrap = await fetch(baseUrl + "/?token=review-secret", { redirect: "manual" });
    assert.equal(bootstrap.status, 302);
    assert.match(bootstrap.headers.get("set-cookie"), /html_library_token=review-secret/);

    const cookie = bootstrap.headers.get("set-cookie").split(";", 1)[0];
    const allowed = await fetch(baseUrl + "/api/settings", { headers: { cookie } });
    assert.equal(allowed.status, 200);
  });
});

test("source responses prevent executable HTML and unknown formats are not server errors", async () => {
  await withServer(async ({ baseUrl, sourceDir }) => {
    const added = await jsonRequest(baseUrl, "/api/settings/roots", {
      method: "POST",
      body: JSON.stringify({ path: sourceDir }),
    });
    const item = added.body.scan.items[0];
    const source = await fetch(baseUrl + "/api/items/" + encodeURIComponent(item.id) + "/source/html");
    assert.equal(source.status, 200);
    assert.match(source.headers.get("content-security-policy"), /sandbox/);
    assert.match(source.headers.get("content-security-policy"), /frame-ancestors 'self'/);
    assert.equal(source.headers.get("x-content-type-options"), "nosniff");

    const unknown = await fetch(baseUrl + "/api/items/" + encodeURIComponent(item.id) + "/source/toString");
    assert.equal(unknown.status, 404);
  });
});

test("API rejects null JSON bodies with a client error", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(baseUrl + "/api/settings/roots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });
    assert.equal(response.status, 400);
  });
});

test("startup ignores invalid persisted roots instead of crashing", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "html-library-invalid-config-"));
  await writeFile(path.join(dataDir, "config.json"), JSON.stringify({ roots: [null, { label: "缺路径" }] }));
  const server = createServer({ dataDir });
  await assert.doesNotReject(server.ready);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/settings");
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).roots, []);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("API returns the folder selected by the native folder picker", async () => {
  await withConfiguredServer({ chooseDirectory: async () => "/Users/example/Documents/对话" }, async ({ baseUrl }) => {
    const response = await fetch(baseUrl + "/api/settings/choose-folder", { method: "POST" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { cancelled: false, path: "/Users/example/Documents/对话" });
  });
});

test("API reports when the native folder picker is cancelled", async () => {
  await withConfiguredServer({ chooseDirectory: async () => null }, async ({ baseUrl }) => {
    const response = await fetch(baseUrl + "/api/settings/choose-folder", { method: "POST" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { cancelled: true });
  });
});
