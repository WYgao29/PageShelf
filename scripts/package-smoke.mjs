import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { mkdtemp, writeFile, rm, access, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shellAuditErrors } from "../shared/shell-audit.js";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appPath = path.join(root, "release/PageShelf-darwin-arm64/PageShelf.app");
await access(path.join(appPath, "Contents/Resources/app/electron/preload.cjs"));
const plist = await exec("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", path.join(appPath, "Contents/Info.plist")]);
assert.equal(plist.stdout.trim(), "com.wayne.pageshelf");
const iconName = (await exec("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIconFile", path.join(appPath, "Contents/Info.plist")])).stdout.trim();
const iconHash = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(iconHash(await readFile(path.join(appPath, "Contents/Resources", iconName))), iconHash(await readFile(path.join(root, "build/icon.icns"))));
await access(path.join(appPath, "Contents/Resources/app/dist/licenses/Inter-LICENSE.txt"));
await access(path.join(appPath, "Contents/Resources/app/dist/licenses/SpaceGrotesk-OFL.txt"));

const data = await mkdtemp(path.join(os.tmpdir(), "pageshelf-package-"));
await writeFile(path.join(data, "config.json"), JSON.stringify({ version: 2, roots: [], ui: {} }));
const env = { ...process.env, HTML_LIBRARY_DATA_DIR: data, PAGESHELF_SMOKE: "1" };
delete env.ELECTRON_RUN_AS_NODE; delete env.PAGESHELF_DEV; delete env.PAGESHELF_SCAN_SMOKE;
const child = spawn(path.join(appPath, "Contents/MacOS/PageShelf"), [], { env, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
let errors = "";
child.stdout.on("data", chunk => { output += chunk; });
child.stderr.on("data", chunk => { errors += chunk; });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
try {
  const start = Date.now();
  while (!output.includes("SMOKE_PIDS ") && !output.includes("SMOKE_FAIL ") && Date.now() - start < 45000 && child.exitCode === null) await delay(100);
  assert.ok(!output.includes("SMOKE_FAIL "), output);
  const layoutLine = output.split("\n").find(line => line.startsWith("SMOKE_LAYOUT "));
  assert.ok(layoutLine, "packaged UI failed to load: " + output + errors);
  assert.deepEqual(shellAuditErrors(JSON.parse(layoutLine.slice("SMOKE_LAYOUT ".length))), []);
  const pidLine = output.split("\n").find(line => line.startsWith("SMOKE_PIDS "));
  assert.ok(pidLine, "missing process identities");
  const [, main, worker] = pidLine.split(/\s+/).map(Number);
  const processes = (await exec("ps", ["-axo", "pid=,ppid="])).stdout.trim().split("\n").map(line => line.trim().split(/\s+/).map(Number));
  const pids = new Set([main]);
  let added = true;
  while (added) { added = false; for (const [pid, parent] of processes) if (pids.has(parent) && !pids.has(pid)) { pids.add(pid); added = true; } }
  assert.ok(pids.has(worker), "worker is not a child of the packaged app");
  for (const pid of pids) {
    let listeners = "";
    try { listeners = (await exec("lsof", ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"])).stdout; }
    catch (error) { if (error.code !== 1) throw error; }
    assert.equal(listeners.trim(), "", `process ${pid} listens on TCP: ${listeners}`);
  }
  child.kill("SIGTERM");
  const ending = Date.now();
  while ([...pids].some(alive) && Date.now() - ending < 6000) await delay(100);
  assert.deepEqual([...pids].filter(alive), [], "packaged app left child processes running");
  assert.ok(!errors.includes("WORKER_STOPPED"), errors);
  console.log("PACKAGE_SMOKE_OK 6 layouts; bundle com.wayne.pageshelf; " + pids.size + " processes without listeners; all exited; no screenshots");
} finally {
  if (child.exitCode === null) child.kill("SIGKILL");
  await rm(data, { recursive: true, force: true });
}
