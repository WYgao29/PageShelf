import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { markdownText } from "../src/formats/markdown.js";
import { createLibrary } from "../src/library.js";
import { searchItems } from "../src/search.js";
import { withTempFixture } from "./helpers/fixture.js";

test("Markdown index retains fenced, indented and inline code as literal text", () => {
  const source = [
    "````javascript",
    "const BACKTICK_KEY = `<widget>`;",
    "```literal nested fence```",
    "[[code-target|code-label]]",
    "````",
    "",
    "~~~shell",
    "export TILDE_KEY=release-notes",
    "~~~",
    "",
    "    const INDENTED_KEY = 'indented-value';",
    "",
    "行内 `INLINE_KEY <component> &amp;` 和 ``literal `tick` value``。",
  ].join("\n");
  const text = markdownText(source);
  for (const literal of [
    "const BACKTICK_KEY = `<widget>`;",
    "```literal nested fence```",
    "[[code-target|code-label]]",
    "export TILDE_KEY=release-notes",
    "const INDENTED_KEY = 'indented-value';",
    "INLINE_KEY <component> &amp;",
    "literal `tick` value",
  ])
    assert.ok(text.includes(literal), `missing literal code: ${literal}`);
  assert.doesNotMatch(text, /javascript|~~~|shell/);
});

test("Markdown index preserves visible labels, punctuation and nested formatting", () => {
  const source = [
    "# 正文 API_KEY 与 release-notes",
    "",
    "**加粗**、_斜体_、~~旧文字~~ 和 API_**KEY**。",
    "",
    "[链接 **标签**](https://hidden-destination.test)",
    "![图片说明](hidden-image.png)",
    "[[notes/target|双链标签]] [[目标文档]]",
    "",
    "> 引用内容",
    "",
    "- [x] 列表内容",
    "",
    "| 表头 | 值 |",
    "| --- | --- |",
    "| 表格内容 | `TABLE_KEY` |",
    "",
    "转义 \\*literal\\* 与 A &amp; B。",
  ].join("\n");
  const text = markdownText(source);
  for (const visible of [
    "正文 API_KEY 与 release-notes",
    "加粗、斜体、旧文字 和 API_KEY。",
    "链接 标签",
    "图片说明",
    "双链标签 目标文档",
    "引用内容",
    "列表内容",
    "表头 值 表格内容 TABLE_KEY",
    "转义 *literal* 与 A & B。",
  ])
    assert.ok(text.includes(visible), `missing visible text: ${visible}`);
  assert.doesNotMatch(text, /hidden-destination|hidden-image|notes\/target|\[\[|\*\*|~~/);
});

test("library search finds code and unmodified Markdown words in the body", () =>
  withTempFixture(async (directory) => {
    const notes = [
      ["BACKTICK_KEY", "```js\nconst BACKTICK_KEY = 1;\n```"],
      ["TILDE_KEY", "~~~sh\nexport TILDE_KEY=1\n~~~"],
      ["INDENTED_KEY", "    const INDENTED_KEY = 1;"],
      ["INLINE_KEY", "配置项 `INLINE_KEY`。"],
      ["API_KEY", "环境变量 API_KEY。"],
      ["release-notes", "请阅读 release-notes。"],
    ];
    await Promise.all(
      notes.map(([, body], index) =>
        writeFile(path.join(directory, `note-${index}.md`), `# 记录 ${index}\n\n${body}`),
      ),
    );
    const library = createLibrary({ roots: [{ id: "notes", path: directory }] });
    await library.scan();
    const snapshot = library.getSnapshot();
    for (const [index, [term]] of notes.entries()) {
      const found = searchItems(snapshot, { q: term });
      assert.deepEqual(
        found.items.map((item) => item.relativePath),
        [`note-${index}`],
        `body search missed ${term}`,
      );
      assert.equal(found.items[0].hits, 1);
    }
  }));
