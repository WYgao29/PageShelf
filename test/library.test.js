import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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
