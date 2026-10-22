import { searchItems } from "../src/search.js";
import { performance } from "node:perf_hooks";
import os from "node:os";
const items = Array.from({ length: 500 }, (_, index) => ({
  id: String(index),
  title: "研究问题" + index,
  rootId: "r",
  rootOrder: 0,
  relativePath: "研究/" + index,
  updatedAt: "2026-10-01",
  tags: ["证据"],
  html: { size: 1 },
  searchText: "研究问题和证据收集，设计方法。".repeat(100),
}));
function measure() {
  const samples = [];
  for (let iteration = 0; iteration < 23; iteration++) {
    const start = performance.now();
    const result = searchItems({ items }, { q: "证据", limit: 100 });
    if (result.total !== 500 || result.items.length !== 100) throw new Error("性能样本结果不正确");
    if (iteration >= 3) samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { items: 500, bodyCharacters: [...items[0].searchText].length, iterations: 20, medianMs: samples[10], p95Ms: samples[18], node: process.version, cpu: os.cpus()[0].model };
}
if (process.parentPort) {
  process.parentPort.postMessage(measure());
} else {
  const baseline = measure();
  const { spawn } = await import("node:child_process");
  const { createRequire } = await import("node:module");
  const { fileURLToPath } = await import("node:url");
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(createRequire(import.meta.url)("electron"), [fileURLToPath(new URL("./benchmark-host.mjs", import.meta.url))], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", errors = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { errors += chunk; });
  await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(errors || "性能 worker 失败"))); });
  const line = output.split("\n").find(line => line.startsWith("BENCHMARK_WORKER "));
  if (!line) throw new Error("缺少 utilityProcess 性能结果：" + output + errors);
  const worker = JSON.parse(line.slice("BENCHMARK_WORKER ".length));
  console.log(JSON.stringify({ mode: "Electron utilityProcess", baselineKind: "same corpus, current Node process; M0 has no recorded benchmark", baseline, worker, p95Ratio: worker.p95Ms / baseline.p95Ms }, null, 2));
}
