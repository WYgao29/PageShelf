import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer } from "../src/server.js";

test("end-to-end flow indexes and serves a paired conversation", async () => {
  const dataDir = await mkdtemp(
    path.join(os.tmpdir(), "html-library-e2e-data-"),
  );
  const sourceDir = await mkdtemp(
    path.join(os.tmpdir(), "html-library-e2e-source-"),
  );
  await writeFile(
    path.join(sourceDir, "旅行计划.html"),
    "<title>旅行计划</title><p>周末去海边。</p>",
  );
  await writeFile(
    path.join(sourceDir, "旅行计划.md"),
    "# 旅行计划\n\n周末去海边。",
  );
  const server = createServer({ dataDir });
  await server.ready;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = "http://127.0.0.1:" + port;

  try {
    const add = await fetch(baseUrl + "/api/roots", {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: JSON.stringify({ path: sourceDir, label: "生活" }),
    });
    assert.equal(add.status, 201);
    await server.library().scheduler.waitForIdle();
    const indexed = await (await fetch(baseUrl + "/api/items?q=海边")).json();
    assert.equal(indexed.items.length, 1);
    assert.equal(indexed.items[0].html.extension, ".html");
    assert.equal(indexed.items[0].markdown.extension, ".md");

    const itemId = encodeURIComponent(indexed.items[0].id);
    const download = await fetch(
      baseUrl + "/api/items/" + itemId + "/download/markdown",
    );
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition"), /attachment/);
    assert.match(await download.text(), /旅行计划/);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
