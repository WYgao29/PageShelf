import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
const flags = new Set(process.argv.slice(2));
for (const flag of flags) if (!["--unit", "--ui", "--electron"].includes(flag)) throw new Error("未知验证选项：" + flag);
const all = !flags.size;
async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error("验证失败：" + args.join(" "))));
  });
}
if (all || flags.has("--unit")) await run(["--test", ...(await readdir("test")).filter(file => file.endsWith(".test.js")).sort().map(file => "test/" + file)]);
if (all || flags.has("--ui")) await run(["node_modules/vitest/vitest.mjs", "run"]);
if (all || flags.has("--electron")) {
  await run(["node_modules/typescript/bin/tsc", "-p", "tsconfig.ui.json", "--noEmit"]);
  await run(["node_modules/vite/bin/vite.js", "build"]);
  await run(["scripts/build-notices.mjs"]);
  await run(["node_modules/typescript/bin/tsc", "-p", "tsconfig.electron.json", "--noEmit"]);
  await run(["scripts/build-electron.mjs"]);
  await run(["scripts/electron-e2e.mjs"]);
}
