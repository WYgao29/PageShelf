import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  const host = "127.0.0.1";
  const port = 5173;
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (child.exitCode !== null) {
        reject(new Error("Vite 在端口就绪前退出，代码 " + child.exitCode));
        return;
      }
      const socket = net.connect({ port, host }, () => {
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

await new Promise((resolve, reject) => {
  const build = spawn(process.execPath, ["scripts/build-electron.mjs"], {
    cwd: root,
    stdio: "inherit",
  });
  build.on("exit", (code) =>
    code === 0 ? resolve() : reject(new Error("Electron 构建失败")),
  );
});

const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
const vite = spawn(
  process.execPath,
  [viteBin, "--host", "127.0.0.1", "--port", "5173", "--strictPort"],
  { cwd: root, stdio: "inherit", env: cleanEnv() },
);
try {
  await waitForPort(vite);
} catch (error) {
  vite.kill("SIGTERM");
  throw error;
}

const electron = spawn(String(electronPath), [".", "--dev"], {
  cwd: root,
  stdio: "inherit",
  env: cleanEnv({ PAGESHELF_DEV: "1" }),
});
const stop = () => {
  if (electron.exitCode === null) electron.kill("SIGTERM");
  if (vite.exitCode === null) vite.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
electron.on("exit", (code) => {
  if (vite.exitCode === null) vite.kill("SIGTERM");
  process.exit(code ?? 0);
});
