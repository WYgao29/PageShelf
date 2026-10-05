import assert from "node:assert/strict";
import test from "node:test";
import { parseRoute, serializeRoute } from "../public/js/router.js";
import { createStore } from "../public/js/store.js";
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
test("store publishes immutable state transitions and unsubscribe stops updates", () => {
  const store = createStore({ value: 0 }),
    seen = [];
  const off = store.subscribe((state) => seen.push(state.value));
  const previous = store.getState();
  store.set({ value: 1 });
  assert.equal(previous.value, 0);
  off();
  store.set({ value: 2 });
  assert.deepEqual(seen, [1]);
});
