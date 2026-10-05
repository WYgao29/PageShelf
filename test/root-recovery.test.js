import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "../src/server.js";
import { withTempFixture } from "./helpers/fixture.js";

async function withRoots(callback) {
  return withTempFixture(async (directory) => {
    const parent = path.join(directory, "parent"),
      child = path.join(parent, "child"),
      dataDir = path.join(directory, "data");
    await mkdir(parent);
    await mkdir(dataDir);
    await writeFile(path.join(parent, "parent.md"), "# Parent\n\nParent body.");
    await writeFile(
      path.join(dataDir, "config.json"),
      JSON.stringify({
        version: 2,
        roots: [
          { id: "parent", path: parent, label: "Parent", enabled: true },
          { id: "child", path: child, label: "Child", enabled: true },
        ],
      }),
    );
    const server = createServer({ dataDir });
    try {
      await server.ready;
      await server.library().scheduler.waitForIdle();
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const origin = "http://127.0.0.1:" + server.address().port;
      const mutate = async (route, method, body) => {
        const response = await fetch(origin + route, {
          method,
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        assert.equal(response.status, 200);
        const result = await response.json();
        await server.library().scheduler.waitForIdle();
        return result;
      };
      await callback({
        parent,
        child,
        origin,
        library: server.library(),
        mutate,
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
}

for (const change of [
  {
    name: "rename",
    route: "/api/roots/parent",
    method: "PATCH",
    body: { label: "Renamed" },
  },
  {
    name: "order",
    route: "/api/roots/order",
    method: "PUT",
    body: { ids: ["child", "parent"] },
  },
]) {
  test(`restored child root is indexed after ${change.name}`, () =>
    withRoots(async ({ parent, child, origin, library, mutate }) => {
      assert.equal(library.registry.get("child").state, "missing");
      await mkdir(child);
      await writeFile(path.join(child, "child.md"), "# Child\n\nChild body.");
      await library.scanRoot("parent");
      assert.equal(library.getSnapshot().items.length, 2);
      assert.equal(library.registry.get("child").state, "missing");

      const changed = await mutate(change.route, change.method, change.body);
      const listed = await (await fetch(origin + "/api/items")).json();
      assert.equal(listed.total, 2, "restored child's article disappeared");
      assert.deepEqual(
        listed.items.map((item) => [item.title, item.rootId]).sort(),
        [
          ["Child", "child"],
          ["Parent", "parent"],
        ],
      );
      const roots = await (await fetch(origin + "/api/roots")).json();
      assert.equal(
        roots.roots.find((root) => root.id === "child").counts.items,
        1,
      );
      assert.ok(changed.scan.queued.includes("child"));
      assert.equal(
        await readFile(path.join(parent, "parent.md"), "utf8"),
        "# Parent\n\nParent body.",
      );
      assert.equal(
        await readFile(path.join(child, "child.md"), "utf8"),
        "# Child\n\nChild body.",
      );
    }));
}

test("ordinary rename and order do not enqueue scans", () =>
  withRoots(async ({ library, mutate }) => {
    const scannedAt = library.registry.get("parent").lastScan.completedAt;
    const renamed = await mutate("/api/roots/parent", "PATCH", {
      label: "Renamed",
    });
    assert.deepEqual(renamed.scan.queued, []);
    const ordered = await mutate("/api/roots/order", "PUT", {
      ids: ["child", "parent"],
    });
    assert.deepEqual(ordered.scan?.queued || [], []);
    assert.equal(
      library.registry.get("parent").lastScan.completedAt,
      scannedAt,
    );
  }));
