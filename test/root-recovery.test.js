import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { createConfigStore } from "../src/config.js";
import { createLibrary } from "../src/library.js";
import { createRootRegistry } from "../src/roots.js";
import { search } from "../src/services/items.js";
import { listRoots, orderRoots, saveRoot } from "../src/services/roots.js";
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
    const registry = createRootRegistry({
      configStore: createConfigStore({ dataDir }),
    });
    await registry.load();
    const library = createLibrary({ rootRegistry: registry });
    const roots = registry.list();
    roots.forEach((root) => library.scheduler.enqueue(root.id, {}));
    if (roots.length) await library.scheduler.waitForRoot(roots[0].id);
    await library.scheduler.waitForIdle();
    const mutate = async (run) => {
      const result = await run();
      assert.equal(result.status, 200);
      await library.scheduler.waitForIdle();
      return result.json;
    };
    await callback({ parent, child, library, mutate });
  });
}

for (const change of [
  {
    name: "rename",
    run: (library) =>
      saveRoot({
        library,
        registry: library.registry,
        mode: "patch",
        id: "parent",
        body: { label: "Renamed" },
      }),
  },
  {
    name: "order",
    run: (library) =>
      orderRoots({
        library,
        registry: library.registry,
        ids: ["child", "parent"],
      }),
  },
]) {
  test(`restored child root is indexed after ${change.name}`, () =>
    withRoots(async ({ parent, child, library, mutate }) => {
      assert.equal(library.registry.get("child").state, "missing");
      await mkdir(child);
      await writeFile(path.join(child, "child.md"), "# Child\n\nChild body.");
      await library.scanRoot("parent");
      assert.equal(library.getSnapshot().items.length, 2);
      assert.equal(library.registry.get("child").state, "missing");

      const changed = await mutate(() => change.run(library));
      const listed = search({ library, query: {} }).json;
      assert.equal(listed.total, 2, "restored child's article disappeared");
      assert.deepEqual(
        listed.items.map((item) => [item.title, item.rootId]).sort(),
        [
          ["Child", "child"],
          ["Parent", "parent"],
        ],
      );
      const roots = listRoots({ library, registry: library.registry }).json;
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

test("ordinary rename and order do not enqueue scans for available roots", () =>
  withRoots(async ({ library, mutate }) => {
    const scannedAt = library.registry.get("parent").lastScan.completedAt;
    for (const state of ["ok", "warning", "scanning"]) {
      library.registry.setIndexState("parent", { state });
      const renamed = await mutate(() =>
        saveRoot({
          library,
          registry: library.registry,
          mode: "patch",
          id: "parent",
          body: { label: "Renamed " + state },
        }),
      );
      assert.deepEqual(renamed.scan.queued, []);
      library.registry.setIndexState("parent", { state });
      const ordered = await mutate(() =>
        orderRoots({
          library,
          registry: library.registry,
          ids: ["child", "parent"],
        }),
      );
      assert.deepEqual(ordered.scan.queued, []);
    }
    assert.equal(
      library.registry.get("parent").lastScan.completedAt,
      scannedAt,
    );
  }));
