import assert from "node:assert/strict";
import test from "node:test";
import { createScheduler } from "../src/scheduler.js";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
test("same root scans serially with one merged rerun and global concurrency two", async () => {
  let active = 0,
    max = 0;
  const runs = [],
    gates = [];
  const scheduler = createScheduler({
    concurrency: 2,
    scanRoot: async (id, options) => {
      active++;
      max = Math.max(max, active);
      runs.push({ id, options });
      const gate = deferred();
      gates.push(gate);
      await gate.promise;
      active--;
    },
  });
  scheduler.enqueue("a", { subtree: "x" });
  scheduler.enqueue("b", {});
  scheduler.enqueue("c", {});
  await new Promise((r) => setImmediate(r));
  assert.equal(max, 2);
  scheduler.enqueue("a", { subtree: "y" });
  scheduler.enqueue("a", { full: true });
  assert.equal(
    scheduler.status().queued.filter((x) => x.rootId === "a").length,
    1,
  );
  gates[0].resolve();
  gates[1].resolve();
  await new Promise((r) => setImmediate(r));
  gates.slice(2).forEach((g) => g.resolve());
  await scheduler.waitForIdle();
  assert.equal(runs.filter((x) => x.id === "a").length, 2);
  assert.equal(runs.findLast((x) => x.id === "a").options.full, true);
  assert.equal(max, 2);
});
test("scan failure releases slots and idle waiters", async () => {
  const seen = [];
  const scheduler = createScheduler({
    scanRoot: async (id) => {
      seen.push(id);
      if (id === "a") throw Error("no access");
    },
  });
  scheduler.enqueue("a", {});
  scheduler.enqueue("b", {});
  await scheduler.waitForIdle();
  assert.deepEqual(seen, ["a", "b"]);
  assert.equal(scheduler.status().running.length, 0);
});
