import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { access, mkdtemp, realpath, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { shellAuditErrors } from "../shared/shell-audit.js";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronPath = createRequire(import.meta.url)("electron");

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.PORT;
  delete env.HOST;
  delete env.ELECTRON_RUN_AS_NODE;
  if (env.FORCE_COLOR) delete env.NO_COLOR;
  return env;
}

function waitForPort(child) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (child.exitCode !== null) {
        reject(new Error("Vite 在端口就绪前退出，代码 " + child.exitCode));
        return;
      }
      const socket = net.connect({ port: 5173, host: "127.0.0.1" }, () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - started > 20000)
          reject(new Error("Vite 未在 127.0.0.1:5173 就绪"));
        else setTimeout(tick, 200);
      });
    };
    tick();
  });
}

function listeners(pid) {
  // -a ANDs the pid selector with TCP LISTEN. Without it, lsof ORs them
  // and reports every listener on the machine plus the process's files.
  return exec("lsof", ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"])
    .then((result) => result.stdout)
    .catch((error) => {
      if (error.code === 1) return error.stdout || "";
      throw error;
    });
}

function alive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

await access(path.join(root, "dist-electron", "main.js"));
await access(path.join(root, "dist-electron", "backend", "worker.js"));

const dataDir = await mkdtemp(path.join(os.tmpdir(), "pageshelf-smoke-"));
const resolvedData = await realpath(dataDir);
const resolvedTemp = await realpath(os.tmpdir());
if (!resolvedData.startsWith(resolvedTemp + path.sep))
  throw new Error("smoke 拒绝使用临时目录以外的数据目录");

const vite = spawn(
  process.execPath,
  [
    path.join(root, "node_modules", "vite", "bin", "vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    "5173",
    "--strictPort",
  ],
  { cwd: root, stdio: "inherit", env: cleanEnv() },
);
let electron;
try {
  await waitForPort(vite);
  let buffer = "";
  electron = spawn(String(electronPath), [".", "--dev"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: cleanEnv({
      PAGESHELF_DEV: "1",
      PAGESHELF_SMOKE: "1",
      HTML_LIBRARY_DATA_DIR: dataDir,
    }),
  });
  electron.stdout.on("data", (chunk) => {
    buffer += chunk;
    process.stdout.write(chunk);
  });
  electron.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });
  const started = Date.now();
  while (Date.now() - started < 90000) {
    if (buffer.includes("SMOKE_FAIL ") || buffer.includes("SMOKE_PIDS ")) break;
    if (electron.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const lines = buffer.split("\n");
  const fail = lines.find((line) => line.startsWith("SMOKE_FAIL "));
  const textLine = lines.find((line) => line.startsWith("SMOKE_TEXT "));
  const pidLine = lines.find((line) => line.startsWith("SMOKE_PIDS "));
  if (fail) throw new Error(fail);
  if (!textLine || !pidLine) throw new Error("Electron 没有报出来源列表或进程号");
  const text = JSON.parse(textLine.slice("SMOKE_TEXT ".length));
  if (!text.includes("还没有来源目录") || !text.includes("PageShelf"))
    throw new Error("窗口没有显示空来源列表：" + text);
  const layoutLine = lines.find((line) => line.startsWith("SMOKE_LAYOUT "));
  if (!layoutLine) throw new Error("Electron 没有报出无截图布局测量");
  const layoutErrors = shellAuditErrors(JSON.parse(layoutLine.slice("SMOKE_LAYOUT ".length)));
  if (layoutErrors.length) throw new Error("布局测量不符合 M3：\n" + layoutErrors.join("\n"));
  const [, mainPid, workerPid] = pidLine.trim().split(/\s+/);
  if (!mainPid || !workerPid) throw new Error("缺少主进程或 worker 进程号：" + pidLine);
  const mainListen = await listeners(mainPid);
  const workerListen = await listeners(workerPid);
  if (mainListen.trim()) throw new Error("主进程正在监听端口：\n" + mainListen);
  if (workerListen.trim()) throw new Error("worker 正在监听端口：\n" + workerListen);
  const viteListen = await listeners(vite.pid);
  if (!viteListen.includes("127.0.0.1:5173"))
    throw new Error("Vite 应只监听 127.0.0.1:5173，实际：\n" + viteListen);
  if (viteListen.includes(mainPid) || viteListen.includes(workerPid))
    throw new Error("Vite 监听被算进了 Electron 进程");
  electron.kill("SIGTERM");
  const exited = Date.now();
  while (alive(mainPid) && Date.now() - exited < 4000)
    await new Promise((resolve) => setTimeout(resolve, 100));
  if (alive(mainPid)) {
    electron.kill("SIGKILL");
    throw new Error("主进程在 SIGTERM 后仍未退出");
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (alive(workerPid)) throw new Error("退出后 worker 仍在运行：" + workerPid);
  console.log("SMOKE_OK");
  console.log("LSOF_MAIN empty");
  console.log("LSOF_WORKER empty");
  console.log("VITE_LISTEN " + viteListen.trim().replaceAll("\n", " | "));
  console.log("WORKER_GONE " + workerPid);
} finally {
  if (electron && electron.exitCode === null) electron.kill("SIGKILL");
  if (vite.exitCode === null) vite.kill("SIGTERM");
  await rm(dataDir, { recursive: true, force: true });
}
