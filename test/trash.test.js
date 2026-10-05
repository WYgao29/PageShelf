import assert from "node:assert/strict";
import test from "node:test";
import {
  writeFile,
  rename,
  access,
  symlink,
  mkdir,
  readFile,
} from "node:fs/promises";
import path from "node:path";
import { withTempFixture } from "./helpers/fixture.js";
import { createTrashService } from "../src/trash.js";

test("trash uses cli then Finder only for remaining files", () =>
  withTempFixture(async (root) => {
    const a = path.join(root, 'a "quote".html'),
      b = path.join(root, "-b.md");
    await writeFile(a, "a");
    await writeFile(b, "b");
    const calls = [];
    const service = createTrashService({
      execFile: async (command, args) => {
        calls.push({ command, args });
        if (command === "/usr/bin/trash") {
          await rename(a, a + ".moved");
          throw new Error("partial");
        }
        await rename(args.at(-1), args.at(-1) + ".moved");
        return {};
      },
    });
    const result = await service.trashFiles({ rootPath: root, paths: [a, b] });
    assert.deepEqual(result.trashed, [a, b]);
    assert.deepEqual(result.failed, []);
    assert.equal(calls[0].command, "/usr/bin/trash");
    assert.deepEqual(calls[0].args, ["--", a, b]);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].args.at(-1), b);
    assert.equal(await readFile(a + ".moved", "utf8"), "a");
  }));
test("partial trash reports surviving sources without claiming no changes", () =>
  withTempFixture(async (root) => {
    const a = path.join(root, "a.html"),
      b = path.join(root, "a.md");
    await writeFile(a, "a");
    await writeFile(b, "b");
    const service = createTrashService({
      execFile: async (command) => {
        if (command === "/usr/bin/trash") await rename(a, a + ".moved");
        throw new Error("permission denied");
      },
    });
    const result = await service.trashFiles({ rootPath: root, paths: [a, b] });
    assert.deepEqual(result.trashed, [a]);
    assert.equal(result.failed[0].path, b);
    await access(b);
  }));
test("trash rejects symlinks before invoking any command", () =>
  withTempFixture(async (root) => {
    const outside = path.join(root, "outside");
    const inside = path.join(root, "inside");
    await mkdir(inside);
    await writeFile(outside, "untouched");
    await symlink(outside, path.join(inside, "link.md"));
    let calls = 0;
    const service = createTrashService({
      execFile: async () => {
        calls++;
      },
    });
    await assert.rejects(
      service.trashFiles({
        rootPath: inside,
        paths: [path.join(inside, "link.md")],
      }),
      { code: "SOURCE_NOT_FOUND" },
    );
    assert.equal(calls, 0);
    assert.equal(await readFile(outside, "utf8"), "untouched");
  }));
test("failed trash never falls back to unlink", () =>
  withTempFixture(async (root) => {
    const a = path.join(root, "a.md");
    await writeFile(a, "still here");
    let unlinkCalls = 0;
    const service = createTrashService({
      execFile: async () => {
        throw new Error("denied");
      },
      fsOps: {
        unlink: () => {
          unlinkCalls++;
          throw new Error("forbidden");
        },
      },
    });
    await assert.rejects(service.trashFiles({ rootPath: root, paths: [a] }), {
      code: "TRASH_FAILED",
    });
    assert.equal(unlinkCalls, 0);
    assert.equal(await readFile(a, "utf8"), "still here");
  }));
