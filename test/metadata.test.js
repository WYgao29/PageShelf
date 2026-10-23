import assert from "node:assert/strict";
import test from "node:test";
import { extractCandidates, finalizeRootMetadata } from "../src/metadata.js";
const item = (stem, html) => ({
  id: stem,
  rootId: "r",
  relativePath: stem,
  directory: stem.includes("/") ? stem.slice(0, stem.lastIndexOf("/")) : "/",
  sourceFiles: [],
  ...extractCandidates({ html, filename: stem, format: "html" }),
});
test("title priority, repeated generic title, suffix emoji cleanup and content excerpt", () => {
  const items = new Map([
    [
      "a",
      item(
        "笔记_01_唯有中间层值得长期投入",
        '<title>知识星球 | 深度连接铁杆粉丝，运营高品质社群，知识变现的工具</title><nav>导航</nav><div class="topic-detail"><p>署名 正文</p></div>',
      ),
    ],
    [
      "b",
      item(
        "笔记_02_继续",
        '<title>知识星球 | 深度连接铁杆粉丝，运营高品质社群，知识变现的工具</title><div class="topic-detail"><p>正文</p></div>',
      ),
    ],
    [
      "c",
      item(
        "笔记_03_结束",
        "<title>知识星球 | 深度连接铁杆粉丝，运营高品质社群，知识变现的工具</title>",
      ),
    ],
    [
      "d",
      item(
        "plain",
        "<title>🐴 正题 - newtype</title><article><p>" +
          "正文".repeat(100) +
          "</p></article>",
      ),
    ],
  ]);
  const result = finalizeRootMetadata(items, { rootId: "r" });
  assert.equal(result.items.get("a").title, "唯有中间层值得长期投入");
  assert.equal(result.items.get("d").title, "正题");
  assert.match(result.items.get("d").titleRaw, /🐴/);
  assert.ok(
    [...result.items.values()].every((x) => [...x.excerpt].length <= 120),
  );
  assert.doesNotMatch(result.items.get("a").searchText, /导航/);
});
test("series requires two in same folder, R2 avoids root and numeric natural ordering", () => {
  const items = new Map(
    [
      "课程/10_十",
      "课程/02_二",
      "课程/02_二b",
      "01_根目录",
      "only_01_单篇",
    ].map((stem) => [stem, item(stem, "")]),
  );
  const result = finalizeRootMetadata(items, { rootId: "r" });
  assert.equal(result.series.size, 1);
  const series = [...result.series.values()][0];
  assert.deepEqual(series.itemIds, ["课程/02_二", "课程/02_二b", "课程/10_十"]);
  assert.equal(result.items.get("01_根目录").series, null);
  assert.equal(result.items.get("only_01_单篇").title, "单篇");
  assert.equal(
    finalizeRootMetadata(items, { rootId: "r", seriesMode: "off" }).series.size,
    0,
  );
});
test("site detection uses content containers before unrelated outbound links and prefers article heading", () => {
  const extracted = extractCandidates({
    html: '<title>第一讲</title><h1 class="title">第一讲</h1><a href="https://zsxq.com">出处</a><div class="ql-editor"><h1>第一讲：从决策出发</h1><h2>小节</h2><p>正文</p></div>',
    filename: "course_03_第一讲",
    format: "mhtml",
  });
  const result = finalizeRootMetadata(
    new Map([
      [
        "id",
        {
          id: "id",
          rootId: "r",
          relativePath: "course_03_第一讲",
          directory: "/",
          ...extracted,
        },
      ],
    ]),
    { rootId: "r" },
  );
  assert.equal(result.items.get("id").site, "newtype");
  assert.equal(result.items.get("id").title, "第一讲：从决策出发");
  assert.equal(result.items.get("id").headings.length, 1);
});
