import assert from "node:assert/strict";
import { mkdtemp, mkdir, rename, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLibrary } from "../src/library.js";

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "html-library-"));
  await mkdir(path.join(root, "nested"));
  await writeFile(
    path.join(root, "统一入口.html"),
    "<!doctype html><html><head><title>统一入口</title></head><body><h1>本地知识库</h1><p>扫描和搜索说明</p></body></html>",
  );
  await writeFile(
    path.join(root, "统一入口.md"),
    "# 统一入口\n\n这里介绍如何搜索本地知识库。",
  );
  await writeFile(
    path.join(root, "nested", "only-markdown.md"),
    "# 只有 Markdown\n\n这是一份嵌套笔记。",
  );
  await writeFile(path.join(root, "ignored.txt"), "不应被索引");
  return root;
}

test("scan merges matching HTML and Markdown files into one item", async () => {
  const root = await createFixture();
  const library = createLibrary({ roots: [{ id: "root-a", path: root, label: "我的对话" }] });

  const result = await library.scan();
  assert.equal(result.items.length, 2);

  const paired = result.items.find((item) => item.relativePath === "统一入口");
  assert.ok(paired);
  assert.equal(paired.title, "统一入口");
  assert.equal(paired.html.extension, ".html");
  assert.equal(paired.markdown.extension, ".md");
  assert.match(paired.snippet, /本地知识库|搜索本地知识库/);

  const markdownOnly = result.items.find((item) => item.relativePath === "nested/only-markdown");
  assert.ok(markdownOnly);
  assert.equal(markdownOnly.html, null);
  assert.equal(markdownOnly.markdown.extension, ".md");
});

test("search matches title, path, and body content", async () => {
  const root = await createFixture();
  const library = createLibrary({ roots: [{ id: "root-a", path: root, label: "我的对话" }] });
  await library.scan();

  assert.equal(library.search("本地知识库").length, 1);
  assert.equal(library.search("nested").length, 1);
  assert.equal(library.search("ONLY MARKDOWN").length, 1);
  assert.equal(library.search("没有这个词").length, 0);
});

test("readSource rejects paths outside the configured root", async () => {
  const root = await createFixture();
  const library = createLibrary({ roots: [{ id: "root-a", path: root, label: "我的对话" }] });
  await library.scan();

  const item = library.search("统一入口")[0];
  await assert.rejects(
    library.readSource(item.id, "html", "../outside.html"),
    (error) => error.code === "SOURCE_NOT_FOUND",
  );
});

test("readSource rejects a source file replaced by a symlink outside the root", async () => {
  const root = await createFixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), "html-library-outside-"));
  const outsideFile = path.join(outside, "secret.md");
  const sourceFile = path.join(root, "统一入口.md");
  await writeFile(outsideFile, "# 不应被读取");
  const library = createLibrary({ roots: [{ id: "root-a", path: root, label: "我的对话" }] });
  await library.scan();
  await unlink(sourceFile);
  await symlink(outsideFile, sourceFile);

  const item = library.search("统一入口")[0];
  await assert.rejects(
    library.readSource(item.id, "markdown"),
    (error) => error.code === "SOURCE_NOT_FOUND",
  );
});

test("readSource rejects unknown formats and files removed after scanning", async () => {
  const root = await createFixture();
  const library = createLibrary({ roots: [{ id: "root-a", path: root, label: "我的对话" }] });
  await library.scan();
  const item = library.search("统一入口")[0];

  await assert.rejects(
    library.readSource(item.id, "toString"),
    (error) => error.code === "SOURCE_NOT_FOUND",
  );
  await unlink(path.join(root, "统一入口.html"));
  await assert.rejects(
    library.readSource(item.id, "html"),
    (error) => error.code === "SOURCE_NOT_FOUND",
  );
});

test("scan chooses .html deterministically when a stem has duplicate HTML formats", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "html-library-duplicate-"));
  await writeFile(path.join(root, "same.html"), "<title>优先 HTML</title>");
  await writeFile(path.join(root, "same.htm"), "<title>不应优先</title>");
  const library = createLibrary({ roots: [{ id: "root-a", path: root, label: "重复测试" }] });

  const result = await library.scan();
  assert.equal(result.items[0].html.extension, ".html");
  assert.equal(result.items[0].title, "优先 HTML");
  assert.match(result.errors[0].message, /重复/);
});

test("a scan queued after removing a root cannot be overwritten by the earlier scan", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "html-library-slow-"));
  await Promise.all(
    Array.from({ length: 1200 }, (_, index) =>
      writeFile(path.join(root, `item-${index}.md`), `# item ${index}\n`),
    ),
  );
  const library = createLibrary({ roots: [{ id: "root-a", path: root, label: "临时目录" }] });
  const firstScan = library.scan();
  await new Promise((resolve) => setImmediate(resolve));
  library.removeRoot("root-a");
  const secondScan = library.scan();
  await Promise.all([firstScan, secondScan]);

  assert.equal(library.search().length, 0);
});
