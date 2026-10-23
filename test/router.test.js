import assert from "node:assert/strict";
import test from "node:test";
import { parseRoute, serializeRoute } from "../shared/routes.js";
test("routes round trip unicode ids query filters view and settings", () => {
  for (const route of [
    {
      rootId: "目录:a",
      seriesKey: "s",
      q: '"证据 方法" -旧',
      scope: "all",
      fmt: "html",
      kind: "series",
      sort: "relevance",
      item: "r:😀",
      view: "original",
    },
    { settings: true, view: "reader" },
  ]) {
    const parsed = parseRoute(serializeRoute(route));
    for (const key of Object.keys(route)) assert.equal(parsed[key], route[key]);
  }
  assert.equal(parseRoute("/").scope, "all");
  assert.equal(parseRoute("/r/a/s/b").sort, "series");
  assert.equal(parseRoute("/r/a?q=term").sort, "relevance");
  assert.equal(parseRoute("/r/a?item=x&view=markdown").item, "x");
});
