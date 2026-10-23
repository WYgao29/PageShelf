import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createLibraryHost,
  handleWorkerEnvelope,
} from "../electron/backend/host.js";
import { testTrashService } from "./helpers/fixture.js";

test("worker indexes a paired conversation and returns its markdown download", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "html-library-e2e-data-"));
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
  const host = await createLibraryHost({
    dataDir,
    trashService: testTrashService,
  });
  try {
    const added = await ask(host, "roots.add", {
      path: sourceDir,
      label: "生活",
    });
    assert.equal(typeof added.root.id, "string");
    await host.library.scheduler.waitForIdle();
    const indexed = await ask(host, "items.search", { query: { q: "海边" } });
    assert.equal(indexed.items.length, 1);
    assert.equal(indexed.items[0].html.extension, ".html");
    assert.equal(indexed.items[0].markdown.extension, ".md");
    const download = await ask(host, "items.download", {
      id: indexed.items[0].id,
      format: "markdown",
    });
    assert.match(download.headers["content-disposition"], /attachment/);
    assert.match(Buffer.from(download.body).toString("utf8"), /旅行计划/);
  } finally {
    await host.close();
  }
});

async function ask(host, method, params) {
  const reply = await handleWorkerEnvelope(host, {
    id: method,
    method,
    params,
  });
  assert.equal(reply.ok, true, reply.error?.message);
  return reply.result;
}
