export async function runReaderTests({ test }) {
  const { buildReader } = await import("/assets/js/reader/pipeline.js");
  const item = {
    id: "r:1",
    rootId: "r",
    relativePath: "notes/a",
    title: "文章",
  };
  const text = "这是用于验证安全正文抽取的内容，研究需要证据。".repeat(30);
  for (const [name, html] of [
    ["article", "<article><h2>章节</h2><p>" + text + "</p></article>"],
    [
      "newtype",
      '<h1 class="title">文章</h1><a href="https://zsxq.com">出处</a><div class="ql-editor"><h2>章节</h2><p>' +
        text +
        "</p></div>",
    ],
    [
      "zsxq",
      '<title>知识星球</title><div class="topic-detail"><h2>章节</h2><p>' +
        text +
        '</p><div class="comment-container">评论不应显示</div></div>',
    ],
    [
      "readability",
      '<html><body><div id="content"><h2>章节</h2><p>' +
        text +
        "</p><p>" +
        text +
        "</p></div></body></html>",
    ],
  ])
    await test("extract " + name, async (assert) => {
      const result = await buildReader({ item, html, query: "证据" });
      assert(result.status === "reader", result.reason);
      assert(result.toc.length >= 1);
      if (name === "newtype") assert(result.site === "newtype");
      assert(!result.article.textContent.includes("评论不应显示"));
      assert(result.find.total > 0);
      result.find.destroy();
    });
  await test("short HTML falls back and short Markdown remains readable", async (assert) => {
    assert(
      (await buildReader({ item, html: "<article><p>短文</p></article>" }))
        .status === "fallback",
    );
    const result = await buildReader({
      item,
      markdown: "---\ntitle: 文档\ntags: [测试]\n---\n# 文档\n短笔记",
    });
    assert(result.status === "reader");
    assert(!result.article.textContent.includes("tags:"));
  });
  await test("Markdown GFM tables tasks nested lists headings images and wikilinks", async (assert) => {
    const result = await buildReader({
      item,
      items: [{ id: "r:2", rootId: "r", relativePath: "notes/target" }],
      markdown:
        "# 文档\n\n## 小节\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- [x] 完成\n- 一级\n  - 二级\n\n[[target|双链]] [[missing]]\n\n![图](image.png)\n![远程](https://example.test/image.png)",
    });
    assert(result.article.querySelector("table"));
    assert(
      result.article.querySelector("input[disabled][type=checkbox]"),
      "checkbox missing: " + result.article.outerHTML,
    );
    assert(result.article.querySelector("ul ul"));
    assert(result.article.querySelector('a[data-wikilink="r:2"]'));
    assert(result.article.querySelector('[data-wikilink="missing"]'));
    assert(
      result.article
        .querySelector("img")
        .getAttribute("src")
        .includes("/asset?path=image.png"),
    );
    assert(result.article.textContent.includes("外部图片未加载"));
  });
  await test("find highlights inline phrases, repeated matches and reverse wrap", async (assert) => {
    const result = await buildReader({
      item,
      markdown: "## 重复\n\n证据与**方法**，证据与方法。",
      query: '"证据与方法"',
    });
    document.querySelector("#test-host").replaceChildren(result.article);
    assert(result.find.total === 2);
    assert(result.find.next(-1) === 2);
    assert(result.find.next(1) === 1);
    result.find.destroy();
    assert(!result.article.querySelector("mark.reader-hit"));
  });
  await test("source presentation is removed before parsing without CSP style errors", async (assert) => {
    const violations = [];
    const observe = (event) => {
      if (event.effectiveDirective.startsWith("style-src"))
        violations.push(event.effectiveDirective);
    };
    document.addEventListener("securitypolicyviolation", observe);
    try {
      const result = await buildReader({
        item,
        html:
          '<style>p{color:red}</style><article style="color:red"><h2 style="padding:2px">章节</h2><p style="color:blue">' +
          text +
          "</p></article>",
      });
      document.querySelector("#test-host").replaceChildren(result.article);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      assert(result.status === "reader");
      assert(
        violations.length === 0,
        "CSP style violations: " + violations.length,
      );
    } finally {
      document.removeEventListener("securitypolicyviolation", observe);
    }
  });
  const fixtures = await (await fetch("/test/fixtures/xss/cases.json")).json(),
    probe = await (await fetch("/test/probe-info")).json();
  for (const fixture of fixtures)
    await test("XSS " + fixture.name, async (assert) => {
      globalThis.__xss = 0;
      const html =
        "<article><p>" +
        text +
        "</p>" +
        fixture.html.replaceAll("__EXTERNAL__", probe.url) +
        "</article>";
      const result = await buildReader({ item, html });
      assert(result.status === "reader");
      document.querySelector("#test-host").replaceChildren(result.article);
      assert(
        !result.article.querySelector(
          "script,style,iframe,object,embed,form,link,meta,svg,math,video",
        ),
      );
      for (const element of result.article.querySelectorAll("*"))
        for (const attr of element.attributes)
          assert(
            !/^on/i.test(attr.name) && !["style", "srcset"].includes(attr.name),
            attr.name,
          );
      for (const anchor of result.article.querySelectorAll("a"))
        assert(!/^(javascript|data):/i.test(anchor.getAttribute("href") || ""));
      assert(!result.article.querySelector("input:not([type=checkbox])"));
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      assert(globalThis.__xss === 0);
      assert((await (await fetch("/test/probe-info")).json()).count === 0);
      result.find.destroy();
    });
}
