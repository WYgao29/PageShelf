import assert from "node:assert/strict";
import test from "node:test";
import { writeFile, readFile, readdir, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { withTempFixture } from "./helpers/fixture.js";
import { createConfigStore } from "../src/config.js";
test("migration preserves ids and unknown fields and backs up original bytes once", () =>
  withTempFixture(async (directory) => {
    const original = JSON.stringify({
      custom: "keep",
      roots: [
        {
          id: "root-2e61579df9d2",
          path: "/tmp/notes",
          label: "笔记",
          extra: 42,
          options: { custom: true },
        },
      ],
    });
    await writeFile(path.join(directory, "config.json"), original);
    const store = createConfigStore({ dataDir: directory });
    const loaded = await store.load();
    assert.equal(loaded.config.version, 2);
    assert.equal(loaded.config.roots[0].id, "root-2e61579df9d2");
    await assert.rejects(access(path.join(directory, "config.v1.bak.json")));
    await store.update((config) => {
      config.roots[0].label = "新名";
    });
    await store.update((config) => {
      config.roots[0].enabled = false;
    });
    const saved = JSON.parse(
      await readFile(path.join(directory, "config.json"), "utf8"),
    );
    assert.equal(saved.custom, "keep");
    assert.equal(saved.roots[0].extra, 42);
    assert.equal(saved.roots[0].options.custom, true);
    assert.equal(
      await readFile(path.join(directory, "config.v1.bak.json"), "utf8"),
      original,
    );
  }));
test("concurrent configuration updates retain both roots", () =>
  withTempFixture(async (directory) => {
    const store = createConfigStore({ dataDir: directory });
    await store.load();
    await Promise.all(
      ["a", "b"].map((id) =>
        store.update((config) => {
          config.roots.push({ id, path: "/tmp/" + id, label: id });
        }),
      ),
    );
    const loaded = await store.load();
    assert.deepEqual(
      loaded.config.roots.map((x) => x.id),
      ["a", "b"],
    );
    assert.deepEqual(
      loaded.config.roots.map((x) => x.order),
      [0, 1],
    );
  }));
test("broken config boots empty with a backup warning", () =>
  withTempFixture(async (directory) => {
    await writeFile(path.join(directory, "config.json"), "{bad");
    const result = await createConfigStore({ dataDir: directory }).load();
    assert.equal(result.config.roots.length, 0);
    assert.match(result.startupWarning, /配置文件损坏/);
    assert.equal(
      (await readdir(directory)).filter((x) => x.startsWith("config.broken-"))
        .length,
      1,
    );
  }));
test("future configuration is read only and remains byte identical", () =>
  withTempFixture(async (directory) => {
    const original = '{"version":9,"roots":[],"custom":true}';
    await writeFile(path.join(directory, "config.json"), original);
    const store = createConfigStore({ dataDir: directory });
    assert.equal((await store.load()).readOnly, true);
    await assert.rejects(
      store.update((x) => x),
      { code: "CONFIG_READ_ONLY" },
    );
    assert.equal(
      await readFile(path.join(directory, "config.json"), "utf8"),
      original,
    );
  }));
test("unsupported future schema remains untouched with a read-only warning", () =>
  withTempFixture(async (directory) => {
    const original =
      '{"version":9,"roots":{"future":"structure"},"custom":true}';
    await writeFile(path.join(directory, "config.json"), original);
    const store = createConfigStore({ dataDir: directory }),
      loaded = await store.load();
    assert.equal(loaded.readOnly, true);
    assert.equal(loaded.config.roots.length, 0);
    assert.match(loaded.startupWarning, /版本较新/);
    assert.equal(
      await readFile(path.join(directory, "config.json"), "utf8"),
      original,
    );
    await assert.rejects(
      store.update((config) => config),
      { code: "CONFIG_READ_ONLY" },
    );
  }));
test("invalid known-version labels and duplicate IDs are backed up instead of crashing or duplicating counts", async () => {
  for (const roots of [
    [{ id: "a", path: "/tmp/a", label: 12 }],
    [
      { id: "a", path: "/tmp/a" },
      { id: "a", path: "/tmp/b" },
    ],
  ])
    await withTempFixture(async (directory) => {
      await writeFile(
        path.join(directory, "config.json"),
        JSON.stringify({ version: 2, roots }),
      );
      const loaded = await createConfigStore({ dataDir: directory }).load();
      assert.equal(loaded.config.roots.length, 0);
      assert.match(loaded.startupWarning, /配置文件损坏/);
      assert.equal(
        (await readdir(directory)).filter((name) =>
          name.startsWith("config.broken-"),
        ).length,
        1,
      );
    });
});
