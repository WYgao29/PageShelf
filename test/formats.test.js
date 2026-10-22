import assert from "node:assert/strict";
import test from "node:test";
import { parseMhtml, renderMhtml } from "../src/formats/mhtml.js";
import { parseMarkdownSource } from "../shared/markdown-source.js";
import { stripPresentation } from "../src/html-scan.js";
test("presentation pre-pass preserves quoted text, code and selector attributes", () => {
  const source =
    '<style>p{color:red}</style><link rel="stylesheet" href="https://example.test/a.css"><article class="ql-editor" style="color:red"><p title="text style=blue > remains" STYLE=blue>正文</p><pre>&lt;span style="color:red"&gt;</pre></article>';
  const result = stripPresentation(source);
  assert.match(result, /class="ql-editor"/);
  assert.match(result, /title="text style=blue > remains"/);
  assert.match(result, /&lt;span style="color:red"&gt;/);
  assert.doesNotMatch(result, /<style|<link|<article[^>]*style=|<p[^>]*STYLE=/);
});
test("MIME decoding preserves UTF8 base64, quoted printable and inline cid resources", () => {
  const html = '<article><h1>标题</h1><img src="cid:pic"></article>';
  for (const [encoding, body] of [
    ["base64", Buffer.from(html).toString("base64")],
    [
      "quoted-printable",
      [...Buffer.from(html)]
        .map((x) => "=" + x.toString(16).padStart(2, "0"))
        .join(""),
    ],
  ]) {
    const source = Buffer.from(
      [
        'Content-Type: multipart/related; boundary="abc"',
        "",
        "--abc",
        "Content-Type: text/html; charset=utf-8",
        "Content-Transfer-Encoding: " + encoding,
        "",
        body,
        "--abc",
        "Content-Type: image/png",
        "Content-ID: <pic>",
        "Content-Transfer-Encoding: base64",
        "",
        "iVBORw0KGgo=",
        "--abc--",
        "",
      ].join("\r\n"),
    );
    assert.equal(parseMhtml(source).html, html);
    assert.match(renderMhtml(source), /data:image\/png;base64,/);
  }
});
test("Markdown front matter only strips closed supported metadata", () => {
  const result = parseMarkdownSource(
    '---\ntitle: "文档"\ntags: [学习, "资料"]\n---\n# 内容',
  );
  assert.equal(result.title, "文档");
  assert.deepEqual(result.tags, ["学习", "资料"]);
  assert.equal(result.body, "# 内容");
  assert.match(
    parseMarkdownSource("---\ntitle: broken\n# text").body,
    /title:/,
  );
  assert.match(
    parseMarkdownSource("---\ncomplex:\n  nested: true\n---\n正文").body,
    /nested/,
  );
});
