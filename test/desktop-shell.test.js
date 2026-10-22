import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLibraryHost } from "../electron/backend/host.js";
import { handleRendererInvoke, openExternalUrl, rendererEvent } from "../electron/ipc-gate.js";
import { bindQuitCleanup, claimSingleInstance } from "../electron/lifecycle.js";
import { handlePageshelfRequest, protocolPrivileges } from "../electron/protocol.js";
import { createWorkerSupervisor } from "../electron/supervisor.js";
import { wrapWorkerProcess } from "../electron/worker-process.js";
import {
  APP_WINDOW_PREFERENCES,
  appWindowOptions,
  permissionDecision,
  planOriginalWindow,
  titlebarMode,
  windowBackground,
  windowOpenDecision,
} from "../electron/window-policy.js";
import { SOURCE_CSP } from "../src/services/items.js";
import {
  APP_CSP,
  externalUrlDecision,
  navigationAllowed,
  parsePageshelfUrl,
  senderAllowed,
  validateInvocation,
} from "../shared/pageshelf-contract.js";
import { testTrashService } from "./helpers/fixture.js";

function fakeWorker() {
  const child = {
    pid: fakeWorker.next,
    ready: Promise.resolve(),
    sent: [],
    killed: false,
    listeners: { message: [], exit: [] },
    send(message) {
      this.sent.push(message);
    },
    kill() {
      this.killed = true;
    },
    on(name, fn) {
      this.listeners[name].push(fn);
    },
    exit() {
      for (const fn of [...this.listeners.exit]) fn();
    },
    emit(message) {
      for (const fn of [...this.listeners.message]) fn(message);
    },
  };
  fakeWorker.next += 1;
  return child;
}
fakeWorker.next = 40;

test("invoke whitelist rejects unknown methods, bad types, and oversized params", () => {
  assert.throws(() => validateInvocation({ method: "fs.readFile", params: {} }), {
    code: "METHOD_NOT_ALLOWED",
  });
  assert.throws(() => validateInvocation({ method: "window.open", params: { url: "https://example.com" } }), {
    code: "METHOD_NOT_ALLOWED",
  });
  assert.throws(() => validateInvocation({ method: "roots.list", params: [] }), {
    code: "INVALID_PARAMS",
  });
  assert.throws(() => validateInvocation({ method: "roots.list", params: Object.create(null) }), {
    code: "INVALID_PARAMS",
  });
  assert.throws(
    () => validateInvocation({ method: "roots.list", params: { padding: "x".repeat(1_000_001) } }),
    { code: "PARAMS_TOO_LARGE" },
  );
  assert.deepEqual(validateInvocation({ method: "roots.update", params: { id: "root-1", label: "资料" } }), {
    id: "root-1",
    label: "资料",
  });
  assert.throws(() => validateInvocation({ method: "window.openOriginal", params: { url: "file:///tmp" } }), {
    code: "INVALID_PARAMS",
  });
});

test("only the app origin, or the fixed dev origin in development, may invoke", () => {
  assert.equal(senderAllowed("pageshelf://app/index.html", { dev: false }), true);
  assert.equal(senderAllowed("pageshelf://source/item-1/original", { dev: false }), false);
  assert.equal(senderAllowed("file:///tmp/index.html", { dev: true }), false);
  assert.equal(senderAllowed("http://localhost:5173/", { dev: true }), false);
  assert.equal(senderAllowed("http://127.0.0.1:5174/", { dev: true }), false);
  assert.equal(senderAllowed("http://127.0.0.1:5173/index.html", { dev: false }), false);
  assert.equal(senderAllowed("http://127.0.0.1:5173/index.html", { dev: true }), true);
  assert.equal(senderAllowed("pageshelf://user:pass@app/", { dev: false }), false);
});

test("renderer invoke rejects other senders and keeps external opens confirmed http(s)", async () => {
  let requested = 0;
  await assert.rejects(
    () =>
      handleRendererInvoke({
        senderUrl: "pageshelf://source/item-1/original",
        payload: { method: "roots.list", params: {} },
        request: () => {
          requested += 1;
        },
      }),
    { code: "METHOD_NOT_ALLOWED" },
  );
  assert.equal(requested, 0);
  const opened = [];
  await assert.rejects(
    () => openExternalUrl("javascript:alert(1)", true, (url) => opened.push(url)),
    { code: "INVALID_URL" },
  );
  await assert.rejects(
    () => openExternalUrl("file:///etc/passwd", true, (url) => opened.push(url)),
    { code: "INVALID_URL" },
  );
  await assert.rejects(
    () => openExternalUrl("https://example.com/a", false, (url) => opened.push(url)),
    { code: "CONFIRM_REQUIRED" },
  );
  await assert.rejects(
    () => openExternalUrl("https://user:pass@example.com", true, (url) => opened.push(url)),
    { code: "INVALID_URL" },
  );
  const result = await openExternalUrl("https://example.com/a", true, (url) => opened.push(url));
  assert.equal(result.opened, true);
  assert.deepEqual(opened, ["https://example.com/a"]);
  assert.equal(externalUrlDecision("http://example.com", { confirmed: true }).ok, true);
  assert.equal(externalUrlDecision("pageshelf://app/", { confirmed: true }).ok, false);
  const calls = [];
  await handleRendererInvoke({
    senderUrl: "pageshelf://app/",
    payload: { method: "window.openOriginal", params: { itemId: "item-1" } },
    openOriginal: (itemId) => calls.push(itemId),
    request: () => {
      throw new Error("原网页窗口不能交给 worker");
    },
  });
  assert.deepEqual(calls, ["item-1"]);
  assert.equal(rendererEvent({ event: "scan-progress", payload: { running: [] } }).event, "scan-progress");
  assert.equal(rendererEvent({ event: "window-open", payload: {} }), null);
});

test("pageshelf rejects traversal, unknown hosts, and returns source CSP", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "pageshelf-protocol-data-"));
  const sourceDir = await mkdtemp(path.join(os.tmpdir(), "pageshelf-protocol-source-"));
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "pageshelf-protocol-app-"));
  await writeFile(path.join(appRoot, "index.html"), "<h1>PageShelf</h1>");
  await writeFile(path.join(sourceDir, "note.html"), "<title>边界</title><p>hello</p>");
  await writeFile(path.join(sourceDir, "note.md"), "# 图片\n![图](pic.png)");
  await writeFile(
    path.join(sourceDir, "pic.png"),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  const host = await createLibraryHost({ dataDir, trashService: testTrashService });
  const call = (method, params) => host.call(method, params);
  try {
    await host.call("roots.add", { path: sourceDir, label: "边界" });
    await host.library.scheduler.waitForIdle();
    const items = (await host.call("items.search", { query: {} })).items;
    const html = items.find((item) => item.html);
    const markdown = items.find((item) => item.markdown);
    const original = await handlePageshelfRequest({
      url: "pageshelf://source/" + encodeURIComponent(html.id) + "/original",
      call,
      appRoot,
    });
    assert.equal(original.status, 200);
    assert.equal(original.headers["content-security-policy"], SOURCE_CSP);
    assert.equal(original.headers["x-content-type-options"], "nosniff");
    const document = await handlePageshelfRequest({
      url: "pageshelf://source/" + encodeURIComponent(html.id) + "/document",
      call,
      appRoot,
    });
    assert.match(document.headers["content-type"], /^text\/plain/);
    assert.equal(document.headers["content-security-policy"], SOURCE_CSP);
    const image = await handlePageshelfRequest({
      url:
        "pageshelf://source/" +
        encodeURIComponent(markdown.id) +
        "/asset?path=" +
        encodeURIComponent("pic.png"),
      call,
      appRoot,
    });
    assert.equal(image.status, 200);
    assert.equal(image.headers["content-type"], "image/png");
    assert.equal(image.headers["x-content-type-options"], "nosniff");
    const escaped = await handlePageshelfRequest({
      url:
        "pageshelf://source/" +
        encodeURIComponent(markdown.id) +
        "/asset?path=/etc/passwd",
      call,
      appRoot,
    });
    assert.equal(escaped.status, 404);
    assert.equal(escaped.headers["content-security-policy"], SOURCE_CSP);
    const missing = await handlePageshelfRequest({
      url: "pageshelf://source/missing-item/original",
      call,
      appRoot,
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.headers["x-content-type-options"], "nosniff");
    const app = await handlePageshelfRequest({
      url: "pageshelf://app/index.html",
      call: () => {
        throw new Error("应用资源不能进库");
      },
      appRoot,
    });
    assert.equal(app.status, 200);
    assert.equal(app.headers["content-security-policy"], APP_CSP);
    assert.match(app.body.toString("utf8"), /PageShelf/);
    const absent = await handlePageshelfRequest({
      url: "pageshelf://app/missing.js",
      call: () => {
        throw new Error("缺失资源不能进库");
      },
      appRoot,
    });
    assert.equal(absent.status, 404);
    assert.match(absent.headers["content-security-policy"], /connect-src 'none'/);
    for (const url of [
      "pageshelf://source/../../etc/passwd",
      "pageshelf://source/%2e%2e/original",
      "pageshelf://source/%252e%252e/original",
      "pageshelf://evil/index.html",
      "file:///etc/passwd",
      "pageshelf://app/%2e%2e/secret",
      "pageshelf://source/" + encodeURIComponent(markdown.id) + "/asset?path=" + encodeURIComponent("../pic.png"),
    ]) {
      assert.equal(parsePageshelfUrl(url), null);
      const denied = await handlePageshelfRequest({
        url,
        call: () => {
          throw new Error("越界请求不应读取文件");
        },
        appRoot,
      });
      assert.equal(denied.status, 400);
    }
    const posted = await handlePageshelfRequest({
      url: "pageshelf://app/index.html",
      method: "POST",
      call: () => {
        throw new Error("写方法不应读取文件");
      },
      appRoot,
    });
    assert.equal(posted.status, 405);
    const privileges = protocolPrivileges();
    assert.deepEqual(privileges, {
      scheme: "pageshelf",
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    });
    assert.equal(privileges.privileges.bypassCSP, undefined);
  } finally {
    await host.close();
  }
});

test("navigation stays on the app, and source windows stay on one item", () => {
  assert.equal(navigationAllowed("https://evil.test/a", { dev: true }), false);
  assert.equal(navigationAllowed("pageshelf://app/index.html"), true);
  assert.equal(navigationAllowed("pageshelf://source/item-1/original"), false);
  assert.equal(navigationAllowed("pageshelf://source/item-1/original", { frame: true }), true);
  assert.equal(navigationAllowed("http://127.0.0.1:5173/", { dev: true }), true);
  assert.equal(navigationAllowed("http://127.0.0.1:5174/", { dev: true }), false);
  assert.equal(
    navigationAllowed("pageshelf://source/item-1/original", { kind: "source", itemId: "item-1" }),
    true,
  );
  assert.equal(
    navigationAllowed("pageshelf://source/item-2/original", { kind: "source", itemId: "item-1" }),
    false,
  );
  assert.equal(
    navigationAllowed("https://example.com", { kind: "source", itemId: "item-1" }),
    false,
  );
  assert.equal(navigationAllowed("pageshelf://app/", { kind: "source", itemId: "item-1" }), false);
});

test("arbitrary window.open is denied and original pages use a preload-free window", () => {
  assert.deepEqual(windowOpenDecision(), { action: "deny" });
  assert.equal(permissionDecision(), false);
  assert.equal(APP_WINDOW_PREFERENCES.contextIsolation, true);
  assert.equal(APP_WINDOW_PREFERENCES.sandbox, true);
  assert.equal(APP_WINDOW_PREFERENCES.nodeIntegration, false);
  assert.equal(APP_WINDOW_PREFERENCES.webSecurity, true);
  assert.equal(APP_WINDOW_PREFERENCES.webviewTag, false);
  const app = appWindowOptions({ preloadPath: "/tmp/preload.cjs", backgroundColor: "#FFFFFF" });
  assert.equal(app.minWidth, 960);
  assert.ok(app.minWidth >= 960);
  assert.equal(app.show, false);
  assert.equal(windowBackground(false), "#FFFFFF");
  assert.equal(windowBackground(true), "#111214");
  assert.equal(titlebarMode("darwin", false), "inset");
  assert.equal(titlebarMode("darwin", true), "hidden");
  assert.equal(titlebarMode("linux", false), "hidden");
  assert.equal(app.titleBarStyle, "hiddenInset");
  assert.deepEqual(app.trafficLightPosition, { x: 16, y: 18 });
  assert.equal(app.webPreferences.preload, "/tmp/preload.cjs");
  const original = planOriginalWindow("item-1");
  assert.equal(original.url, "pageshelf://source/item-1/original");
  assert.equal(original.options.minWidth, 960);
  assert.equal(original.options.webPreferences.preload, undefined);
  assert.equal(original.options.webPreferences.nodeIntegration, false);
  assert.equal(original.options.webPreferences.sandbox, true);
  assert.throws(() => planOriginalWindow("../etc"), { code: "INVALID_PARAMS" });
});

test("preload exposes only the named pageshelf bridge", async () => {
  const preload = await readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8");
  const main = await readFile(new URL("../electron/main.ts", import.meta.url), "utf8");
  assert.match(preload, /contextBridge\.exposeInMainWorld\(\s*"pageshelf"/);
  assert.doesNotMatch(preload, /exposeInMainWorld\(\s*"ipcRenderer"/);
  assert.doesNotMatch(preload, /confirmed:\s*true/);
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(preload, /pageshelf:window-background/);
  assert.match(main, /pageshelf:window-background/);
  assert.match(preload, /pageshelf:chrome/);
  assert.match(main, /pageshelf:chrome/);
  assert.doesNotMatch(preload, /exposeInMainWorld\([\s\S]*setTheme/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /registerSchemesAsPrivileged/);
  assert.match(main, /utilityProcess\.fork/);
  assert.doesNotMatch(main, /createServer|bypassCSP|nodeIntegration:\s*true|webSecurity:\s*false|contextIsolation:\s*false|AUTH_TOKEN|\.listen\(/);
});

test("worker adapter emits ready once and uses SIGTERM before force kill", async () => {
  const signals = [];
  const child = {
    pid: 77,
    messages: [],
    postMessage(message) {
      this.messages.push(message);
    },
    kill() {
      this.fallback = true;
    },
    listeners: {},
    on(name, fn) {
      this.listeners[name] = fn;
    },
  };
  const wrapped = wrapWorkerProcess(child, {
    signalProcess(pid, signal) {
      signals.push([pid, signal]);
    },
  });
  const seen = [];
  wrapped.on("message", (message) => seen.push(message));
  child.listeners.message({ event: "worker-ready" });
  await wrapped.ready;
  child.listeners.message({ id: "1", ok: true, result: { roots: [] } });
  assert.deepEqual(seen, [{ id: "1", ok: true, result: { roots: [] } }]);
  wrapped.kill();
  assert.deepEqual(signals, [[77, "SIGTERM"]]);
});

test("worker crash fails the pending call and starts a replacement", async () => {
  const children = [];
  const events = [];
  const supervisor = createWorkerSupervisor({
    spawnWorker() {
      const child = fakeWorker();
      children.push(child);
      return child;
    },
    onEvent: (event) => events.push(event),
  });
  await supervisor.start();
  const pending = supervisor.request({ method: "roots.list" });
  children[0].exit();
  await assert.rejects(pending, { code: "WORKER_CRASHED" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(children.length, 2);
  assert.equal(events.some((event) => event.payload.state === "crashed"), true);
  assert.equal(events.some((event) => event.payload.state === "ready"), true);
  children[0].emit({ id: children[0].sent[0].id, ok: true, result: { stale: true } });
  const next = supervisor.request({ method: "roots.list" });
  const sent = children[1].sent.at(-1);
  children[1].emit({ id: sent.id, ok: true, result: { roots: [] } });
  assert.deepEqual(await next, { roots: [] });
});

test("worker exit before ready starts a replacement that serves the next request", async () => {
  const children = [];
  const events = [];
  const supervisor = createWorkerSupervisor({
    spawnWorker() {
      const child = fakeWorker();
      let resolveReady = () => {};
      child.ready = new Promise((resolve) => {
        resolveReady = resolve;
      });
      child.becomeReady = resolveReady;
      children.push(child);
      return child;
    },
    onEvent: (event) => events.push(event),
  });
  const booting = supervisor.start();
  const waiting = supervisor.request({ method: "roots.list" });
  children[0].exit();
  children[0].becomeReady();
  assert.equal(children.length, 2);
  await booting;
  await assert.rejects(waiting, { code: "WORKER_CRASHED" });
  assert.equal(events.some((event) => event.payload.state === "crashed"), true);
  children[1].becomeReady();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.filter((event) => event.payload.state === "ready").length, 1);
  const next = supervisor.request({ method: "roots.list" });
  const sent = children[1].sent.at(-1);
  children[1].emit({ id: sent.id, ok: true, result: { roots: ["kept"] } });
  assert.deepEqual(await next, { roots: ["kept"] });
  const done = supervisor.shutdown();
  children[1].exit();
  await done;
  assert.equal(children.length, 2);
  assert.equal(events.some((event) => event.payload.state === "stopped"), true);
});

test("shutdown ends pending calls and force-kills after 1200ms", async () => {
  let child;
  let scheduled = null;
  let killed = null;
  const supervisor = createWorkerSupervisor({
    spawnWorker() {
      child = fakeWorker();
      return child;
    },
    schedule(fn, ms) {
      scheduled = { fn, ms };
      return 1;
    },
    clear() {
      scheduled = null;
    },
    killProcess(pid) {
      killed = pid;
    },
  });
  await supervisor.start();
  const pending = supervisor.request({ method: "roots.list" });
  const done = supervisor.shutdown();
  await assert.rejects(pending, { code: "WORKER_STOPPED" });
  assert.equal(child.killed, true);
  assert.equal(scheduled.ms, 1200);
  scheduled.fn();
  await done;
  assert.equal(killed, child.pid);
  await assert.rejects(supervisor.request({ method: "roots.list" }), {
    code: "WORKER_STOPPED",
  });
});

test("shutdown does not force-kill a worker that already exited", async () => {
  let killed = false;
  let scheduled = false;
  const supervisor = createWorkerSupervisor({
    spawnWorker() {
      const child = fakeWorker();
      child.kill = () => {
        child.killed = true;
        child.exit();
      };
      return child;
    },
    schedule() {
      scheduled = true;
      return 1;
    },
    killProcess() {
      killed = true;
    },
  });
  await supervisor.start();
  await supervisor.shutdown();
  assert.equal(scheduled, false);
  assert.equal(killed, false);
});

test("quit waits for worker cleanup and a second instance yields", async () => {
  let shutdowns = 0;
  let quits = 0;
  let prevented = 0;
  const app = {
    listener: null,
    on(_name, fn) {
      this.listener = fn;
    },
    quit() {
      quits += 1;
    },
  };
  bindQuitCleanup({
    app,
    shutdown: async () => {
      shutdowns += 1;
    },
  });
  app.listener({ preventDefault() { prevented += 1; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shutdowns, 1);
  assert.equal(quits, 1);
  assert.equal(prevented, 1);
  app.listener({ preventDefault() { prevented += 1; } });
  assert.equal(prevented, 1);
  let second = 0;
  const lost = claimSingleInstance({
    requestLock: () => false,
    quit: () => {
      second += 1;
    },
    onSecond: () => {
      throw new Error("不应收到第二实例");
    },
    on() {
      throw new Error("不应注册");
    },
  });
  assert.deepEqual(lost, { primary: false });
  assert.equal(second, 1);
  let focused = 0;
  const won = claimSingleInstance({
    requestLock: () => true,
    quit: () => {
      throw new Error("主实例不应退出");
    },
    onSecond: () => {
      focused += 1;
    },
    on(event, listener) {
      assert.equal(event, "second-instance");
      listener();
    },
  });
  assert.deepEqual(won, { primary: true });
  assert.equal(focused, 1);
});
