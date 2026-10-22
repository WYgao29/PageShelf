import assert from "node:assert/strict";
import test from "node:test";
import { searchItems } from "../src/search.js";
import {
  normalizeWithMap,
  findRanges,
  parseQuery,
} from "../shared/text-search.js";
const make = (id, title, body, extra = {}) => ({
  id,
  title,
  relativePath: id,
  searchText: body,
  rootId: "r",
  rootLabel: "R",
  rootOrder: 0,
  updatedAt: "2026-10-01T00:00:00Z",
  tags: [],
  html: { size: 1 },
  ...extra,
});
const snapshot = {
  items: [
    make("a", "证据", "方法 证据 资料"),
    make("b", "方法", "正文 证据 方法 证据"),
    make("c", "ＣＯＤＥＸ", "有用方法 排除"),
  ],
  roots: [{ id: "r" }],
};
test("AND phrase exclusions pure exclusions and weighted NFKC search", () => {
  assert.deepEqual(
    searchItems(snapshot, { q: "证据 方法", sort: "updated" }).items.map(
      (x) => x.id,
    ),
    ["a", "b"],
  );
  assert.equal(searchItems(snapshot, { q: '"正文 证据"' }).total, 1);
  assert.equal(searchItems(snapshot, { q: "方法 -排除" }).total, 2);
  assert.equal(searchItems(snapshot, { q: "-排除" }).total, 2);
  assert.equal(searchItems(snapshot, { q: "codex" }).items[0].id, "c");
  const result = searchItems(
    snapshot,
    { q: "证据" },
    { now: Date.parse("2026-10-01") },
  );
  assert.equal(result.items[0].id, "a");
  assert.equal(result.items[0].score, 28);
  assert.equal(result.items.find((x) => x.id === "b").hits, 2);
  assert.equal(Object.hasOwn(result.items[0], "searchText"), false);
});
test("highlights use original UTF16 ranges for ligature fullwidth emoji and combining marks", () => {
  const text = "😀 Ａﬃ Cafe\u0301";
  for (const [term, expected] of [
    ["affi", "Ａﬃ"],
    ["café", "Cafe\u0301"],
    ["😀", "😀"],
  ]) {
    const ranges = findRanges(text, [term]);
    assert.equal(text.slice(...ranges[0]), expected);
  }
  assert.equal(normalizeWithMap("ﬃ").normalized, "ffi");
  assert.deepEqual(parseQuery('"完整 短语" -词'), {
    include: ["完整 短语"],
    exclude: ["词"],
  });
});
test("root filters series ordering grouping and pagination remain consistent", () => {
  const values = {
    items: [
      make("x", "高分", "证据 证据", {
        series: { key: "s", name: "系列", index: 3, total: 2 },
      }),
      make("y", "低分", "证据", {
        series: { key: "s", name: "系列", index: 1, total: 2 },
      }),
      make("z", "其他", "证据", {
        rootId: "z",
        rootOrder: 1,
        markdown: { size: 1 },
        html: null,
      }),
    ],
    roots: [{ id: "r" }, { id: "z" }],
  };
  const result = searchItems(values, { q: "证据", limit: 1, offset: 1 });
  assert.equal(result.total, 3);
  assert.ok(
    result.groups
      .flatMap((x) => x.itemIds)
      .every((id) => result.items.some((x) => x.id === id)),
  );
  assert.equal(searchItems(values, { fmt: "markdown" }).total, 1);
  assert.equal(searchItems(values, { roots: "r", kind: "series" }).total, 2);
  assert.deepEqual(
    searchItems(values, { sort: "series" }).items.map((x) => x.id),
    ["y", "x", "z"],
  );
  assert.throws(() => searchItems(values, { sort: "bad" }), {
    code: "INVALID_FILTER",
  });
});
