import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  protocol,
  session,
  shell,
  utilityProcess,
} from "electron";
import { chooseFolder as chooseFolderService } from "../src/services/system.js";
import {
  DEV_ORIGIN,
  EVENT_CHANNEL,
  IPC_CHANNEL,
  desktopWorkerEnv,
  navigationAllowed,
  senderAllowed,
} from "../shared/pageshelf-contract.js";
import {
  handleRendererInvoke,
  openExternalUrl,
  rendererEvent,
} from "./ipc-gate.js";
import { bindQuitCleanup, claimSingleInstance } from "./lifecycle.js";
import { handlePageshelfRequest, protocolPrivileges } from "./protocol.js";
import { measureShellLayouts } from "./smoke-layout.js";
import { createWorkerSupervisor } from "./supervisor.js";
import {
  appWindowOptions,
  permissionDecision,
  planOriginalWindow,
  titlebarMode,
  windowBackground,
  windowOpenDecision,
} from "./window-policy.js";
import { wrapWorkerProcess } from "./worker-process.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const dev = process.argv.includes("--dev") || process.env.PAGESHELF_DEV === "1";
const scheme = protocolPrivileges();
protocol.registerSchemesAsPrivileged([scheme]);

const dataDir = process.env.HTML_LIBRARY_DATA_DIR
  ? path.resolve(process.env.HTML_LIBRARY_DATA_DIR)
  : path.join(os.homedir(), ".html-library");

const BACKGROUND_CHANNEL = "pageshelf:window-background";
const CHROME_CHANNEL = "pageshelf:chrome";

let mainWindow: BrowserWindow | null = null;
const appWindows = new Set<BrowserWindow>();
const revealers = new Map<number, () => void>();

if (process.env.PAGESHELF_SMOKE === "1" && process.env.HTML_LIBRARY_DATA_DIR) {
  app.setPath("userData", path.join(process.env.HTML_LIBRARY_DATA_DIR, "user-data"));
}

ipcMain.on(BACKGROUND_CHANNEL, (event, appearance) => {
  if (appearance !== "light" && appearance !== "dark") return;
  if (!senderAllowed(event.senderFrame?.url || "", { dev })) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  win.setBackgroundColor(windowBackground(appearance === "dark"));
  revealers.get(win.id)?.();
});

function publishChrome(win: BrowserWindow) {
  if (win.isDestroyed()) return;
  win.webContents.send(CHROME_CHANNEL, {
    titlebar: titlebarMode(process.platform, win.isFullScreen()),
  });
}

function bindMainWindowReveal(win: BrowserWindow) {
  let painted = false;
  let colored = false;
  const reveal = () => {
    if (painted && colored && !win.isDestroyed() && !win.isVisible()) win.show();
  };
  revealers.set(win.id, () => {
    colored = true;
    reveal();
  });
  win.once("ready-to-show", () => {
    painted = true;
    reveal();
  });
  win.webContents.once("did-finish-load", () => {
    setTimeout(() => {
      if (!colored) {
        colored = true;
        reveal();
      }
    }, 800);
  });
  const syncChrome = () => publishChrome(win);
  win.on("enter-full-screen", syncChrome);
  win.on("leave-full-screen", syncChrome);
  win.webContents.on("dom-ready", syncChrome);
}

const supervisor = createWorkerSupervisor({
  spawnWorker: () =>
    wrapWorkerProcess(
      utilityProcess.fork(
        path.join(projectRoot, "dist-electron", "backend", "worker.js"),
        [],
        {
          serviceName: "PageShelf Library",
          cwd: projectRoot,
          stdio: "inherit",
          env: workerEnv(),
        },
      ),
    ),
  onEvent(message) {
    const event = rendererEvent(message);
    if (!event) return;
    for (const win of appWindows) {
      if (!win.isDestroyed()) win.webContents.send(EVENT_CHANNEL, event);
    }
  },
});

function workerEnv() {
  const source = desktopWorkerEnv(process.env, dataDir);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function backgroundColor() {
  return windowBackground(nativeTheme.shouldUseDarkColors);
}

function secureContents(
  win: BrowserWindow,
  policy: { kind: "app" | "source"; itemId?: string },
) {
  const context = { dev: policy.kind === "app" && dev, kind: policy.kind, itemId: policy.itemId || "" };
  win.webContents.setWindowOpenHandler(() => windowOpenDecision());
  win.webContents.on("will-navigate", (event) => {
    if (!navigationAllowed(event.url, { ...context, frame: false })) event.preventDefault();
  });
  win.webContents.on("will-frame-navigate", (event) => {
    if (!navigationAllowed(event.url, { ...context, frame: event.isMainFrame !== true }))
      event.preventDefault();
  });
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(permissionDecision());
  });
}

function createMainWindow() {
  const win = new BrowserWindow(
    appWindowOptions({
      preloadPath: path.join(projectRoot, "electron", "preload.cjs"),
      backgroundColor: backgroundColor(),
    }),
  );
  appWindows.add(win);
  win.on("closed", () => {
    appWindows.delete(win);
    if (mainWindow === win) mainWindow = null;
  });
  secureContents(win, { kind: "app" });
  bindMainWindowReveal(win);
  mainWindow = win;
  if (process.env.PAGESHELF_SMOKE === "1") watchSmoke(win);
  if (dev) void win.loadURL(DEV_ORIGIN + "/");
  else void win.loadURL("pageshelf://app/index.html");
  return win;
}

function watchSmoke(win: BrowserWindow) {
  let reported = false;
  const report = async () => {
    if (reported) return;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const text = await win.webContents.executeJavaScript(
        "document.body ? document.body.innerText : ''",
      );
      if (
        text.includes("还没有来源目录") ||
        text.includes("桌面接口不可用") ||
        (text.includes("来源目录") && !text.includes("正在读取来源"))
      ) {
        reported = true;
        console.log("SMOKE_TEXT " + JSON.stringify(text));
        try {
          const layouts = await measureShellLayouts(win);
          console.log("SMOKE_LAYOUT " + JSON.stringify(layouts));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log("SMOKE_FAIL " + message);
        }
        console.log("SMOKE_PIDS " + process.pid + " " + (supervisor.pid() ?? ""));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    reported = true;
    const text = await win.webContents.executeJavaScript(
      "document.body ? document.body.innerText : ''",
    );
    console.log("SMOKE_TEXT " + JSON.stringify(text));
    console.log("SMOKE_PIDS " + process.pid + " " + (supervisor.pid() ?? ""));
  };
  win.webContents.on("did-finish-load", () => {
    void report();
  });
  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.log("SMOKE_FAIL " + JSON.stringify({ code, description, url }));
  });
}

async function openOriginal(itemId: string) {
  const plan = planOriginalWindow(itemId, { backgroundColor: backgroundColor() });
  const win = new BrowserWindow(plan.options);
  secureContents(win, { kind: "source", itemId });
  await win.loadURL(plan.url);
  return { opened: true };
}

const instance = claimSingleInstance({
  requestLock: () => app.requestSingleInstanceLock(),
  quit: () => app.quit(),
  on: (_event, listener) => {
    app.on("second-instance", listener);
  },
  onSecond() {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  },
});

if (instance.primary) {
  if (process.env.PAGESHELF_SMOKE === "1" && !process.env.HTML_LIBRARY_DATA_DIR) {
    console.error("SMOKE_FAIL missing HTML_LIBRARY_DATA_DIR");
    app.exit(1);
  }
  bindQuitCleanup({
    app: {
      on: (_event, listener) => {
        app.on("before-quit", listener);
      },
      quit: () => {
        app.quit();
      },
    },
    shutdown: () => supervisor.shutdown(),
  });
  app.on("window-all-closed", () => {
    app.quit();
  });
  void app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(permissionDecision());
    });
    await supervisor.start();
    protocol.handle("pageshelf", async (request) => {
      const result = await handlePageshelfRequest({
        url: request.url,
        method: request.method,
        appRoot: path.join(projectRoot, "dist"),
        call: (method, params) => supervisor.request({ method, params }),
      });
      return new Response(result.body, {
        status: result.status,
        headers: result.headers,
      });
    });
    ipcMain.handle(IPC_CHANNEL, (event, payload) =>
      handleRendererInvoke({
        senderUrl: event.senderFrame?.url || "",
        payload,
        dev,
        request: (method, params) => supervisor.request({ method, params }),
        openExternal: (url, confirmed) =>
          openExternalUrl(url, confirmed, (target) => shell.openExternal(target)),
        openOriginal,
        chooseFolder: async () => {
          const selected = await dialog.showOpenDialog({
            properties: ["openDirectory"],
            title: "选择来源目录",
          });
          const choice = selected.canceled ? null : selected.filePaths[0] || null;
          return (
            await chooseFolderService({
              chooseDirectory: async () => choice,
            })
          ).json;
        },
      }),
    );
    createMainWindow();
  });
}
