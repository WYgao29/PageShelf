import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { access, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronPath = createRequire(import.meta.url)("electron");
const LARGE_FILES = 2200;
const FILLER_ROOTS = 36;

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.AUTH_TOKEN;
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
        if (Date.now() - started > 20000) reject(new Error("Vite 未在 127.0.0.1:5173 就绪"));
        else setTimeout(tick, 200);
      });
    };
    tick();
  });
}

function listeners(pid) {
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

async function writeHtml(file, title) {
  const paragraph = "<p>" + title + " " + "资料正文".repeat(80) + "</p>";
  const html =
    "<!doctype html><html><head><title>" +
    title +
    "</title></head><body><article><h1>" +
    title +
    "</h1>" +
    paragraph.repeat(6) +
    "</article></body></html>";
  await writeFile(file, html);
}

async function writeMany(dir, count) {
  await mkdir(dir, { recursive: true });
  const batch = 80;
  for (let start = 0; start < count; start += batch) {
    const jobs = [];
    for (let offset = 0; offset < batch && start + offset < count; offset += 1) {
      const index = start + offset;
      jobs.push(writeHtml(path.join(dir, "note-" + String(index).padStart(4, "0") + ".html"), "笔记 " + index));
    }
    await Promise.all(jobs);
  }
}

await access(path.join(root, "dist-electron", "main.js"));
await access(path.join(root, "dist-electron", "backend", "worker.js"));

const dataDir = await mkdtemp(path.join(os.tmpdir(), "pageshelf-scan-"));
const resolvedData = await realpath(dataDir);
const resolvedTemp = await realpath(os.tmpdir());
if (!resolvedData.startsWith(resolvedTemp + path.sep))
  throw new Error("smoke 拒绝使用临时目录以外的数据目录");

const tinyDir = path.join(dataDir, "tiny");
const largeDir = path.join(dataDir, "large");
await mkdir(tinyDir, { recursive: true });
await writeHtml(path.join(tinyDir, "one.html"), "小目录");
await writeMany(largeDir, LARGE_FILES);
const roots = [
  {
    id: "root-tiny",
    path: tinyDir,
    label: "小目录",
    enabled: true,
    options: { series: "off" },
  },
  {
    id: "root-large",
    path: largeDir,
    label: "大目录",
    enabled: true,
    options: { series: "off" },
  },
];
for (let index = 1; index <= FILLER_ROOTS; index += 1) {
  const dir = path.join(dataDir, "fill-" + String(index).padStart(2, "0"));
  await mkdir(dir, { recursive: true });
  await writeHtml(path.join(dir, "one.html"), "填充 " + index);
  roots.push({
    id: "root-fill-" + String(index).padStart(2, "0"),
    path: dir,
    label: "填充 " + String(index).padStart(2, "0"),
    enabled: true,
    options: { series: "off" },
  });
}
await writeFile(path.join(dataDir, "config.json"), JSON.stringify({ version: 2, ui: {}, roots }));

const vite = spawn(
  process.execPath,
  [path.join(root, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", "5173", "--strictPort"],
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
      PAGESHELF_SCAN_SMOKE: "1",
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
  while (Date.now() - started < 120000) {
    if (buffer.includes("SMOKE_FAIL ") || buffer.includes("SCAN_SMOKE ")) break;
    if (electron.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const lines = buffer.split("\n");
  const fail = lines.find((line) => line.startsWith("SMOKE_FAIL "));
  const scanLine = lines.find((line) => line.startsWith("SCAN_SMOKE "));
  const pidLine = lines.find((line) => line.startsWith("SMOKE_PIDS "));
  if (fail) throw new Error(fail);
  if (!scanLine || !pidLine) throw new Error("Electron 没有报出扫描交互结果");
  const scan = JSON.parse(scanLine.slice("SCAN_SMOKE ".length));
  if (!(scan.searchMs >= 0 && scan.searchMs <= 2500)) throw new Error("扫描期间搜索响应验收失败：" + scanLine);
  if (scan.responded !== true) throw new Error("主窗口没有响应：" + scanLine);
  if (!scan.progress || !(scan.progress.total > 0)) throw new Error("进度没有到达界面：" + scanLine);
  if (scan.progress.done + "/" + scan.progress.total !== scan.progress.text)
    throw new Error("进度文本不完整：" + scanLine);
  if (!scan.progressAfter) throw new Error("交互后扫描进度不在界面上：" + scanLine);
  if (scan.progressAfter.done + "/" + scan.progressAfter.total !== scan.progressAfter.text)
    throw new Error("交互后进度文本不完整：" + scanLine);
  if (scan.progressAfter.total !== scan.progress.total)
    throw new Error("交互后扫描总量变了：" + scanLine);
  if (!(scan.progressAfter.done > scan.progress.done))
    throw new Error("交互后扫描没有继续：" + scanLine);
  if (!scan.moved || (scan.moved.before[0] === scan.moved.after[0] && scan.moved.before[1] === scan.moved.after[1]))
    throw new Error("窗口没有移动：" + scanLine);
  if (!String(scan.dragRegion).includes("drag")) throw new Error("标题条不可拖动：" + scanLine);
  if (!scan.scroll || !(scan.scroll.after > scan.scroll.before) || !(scan.scroll.scrollHeight > scan.scroll.clientHeight))
    throw new Error("滚动没有变化：" + scanLine);
  const names = await readdir(dataDir, { recursive: true });
  const images = names.filter((name) => /\.(png|jpe?g|webp|gif)$/i.test(String(name)));
  if (images.length) throw new Error("生成了截图：" + images.join(", "));
  const [, mainPid, workerPid] = pidLine.trim().split(/\s+/);
  if (!mainPid || !workerPid) throw new Error("缺少主进程或 worker 进程号：" + pidLine);
  const mainListen = await listeners(mainPid);
  const workerListen = await listeners(workerPid);
  if (mainListen.trim()) throw new Error("主进程正在监听端口：\n" + mainListen);
  if (workerListen.trim()) throw new Error("worker 正在监听端口：\n" + workerListen);
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
  console.log("SCAN_SMOKE_OK");
  console.log("LSOF_MAIN empty");
  console.log("LSOF_WORKER empty");
  console.log("WORKER_GONE " + workerPid);
  console.log("NO_SCREENSHOTS");
} finally {
  if (electron && electron.exitCode === null) electron.kill("SIGKILL");
  if (vite.exitCode === null) vite.kill("SIGTERM");
  await rm(dataDir, { recursive: true, force: true });
}
