function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseProgress(value) {
  const match = /^(\d+)\/(\d+)$/.exec(value || "");
  if (!match) return null;
  const done = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return null;
  return { done, total, text: done + "/" + total };
}

/**
 * @param {{ isVisible: () => boolean, show: () => void, getPosition: () => number[], setPosition: (x: number, y: number) => void, isDestroyed: () => boolean, webContents: { executeJavaScript: (code: string) => Promise<any>, on: Function } }} win
 * @param {() => number | null} workerPid
 */
export function watchScanSmoke(win, workerPid) {
  let started = false;
  const finish = (line) => {
    console.log(line);
    console.log("SMOKE_PIDS " + process.pid + " " + (workerPid() ?? ""));
  };
  const report = async () => {
    if (started || win.isDestroyed()) return;
    started = true;
    try {
      if (!win.isVisible()) win.show();
      const result = await observeScan(win);
      finish("SCAN_SMOKE " + JSON.stringify(result));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      finish("SMOKE_FAIL " + message);
    }
  };
  win.webContents.on("did-finish-load", () => {
    void report();
  });
  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    if (started) return;
    started = true;
    finish("SMOKE_FAIL " + JSON.stringify({ code, description, url }));
  });
}

async function observeScan(win) {
  await waitFor(
    () => win.webContents.executeJavaScript("!!document.querySelector('[data-root-id=\"root-large\"]')"),
    "界面没有显示大目录",
  );
  let progress = await waitForProgress(win, 8000);
  if (!progress) {
    await win.webContents.executeJavaScript(
      'window.pageshelf.invoke("roots.rescan", { id: "root-large", full: true })',
    );
    progress = await waitForProgress(win, 30000);
  }
  if (!progress) {
    const text = await win.webContents.executeJavaScript(
      "document.body ? document.body.innerText.slice(0, 500) : ''",
    );
    throw new Error("扫描进度没有到达界面：" + text);
  }

  const responded = await win.webContents.executeJavaScript("({ ok: true })");
  if (!responded || responded.ok !== true) throw new Error("主窗口在扫描期间没有响应");

  const before = win.getPosition();
  win.setPosition(before[0] + 36, before[1] + 24);
  await delay(80);
  let after = win.getPosition();
  if (after[0] === before[0] && after[1] === before[1]) {
    win.setPosition(Math.max(0, before[0] - 48), Math.max(0, before[1] - 32));
    await delay(80);
    after = win.getPosition();
  }
  if (after[0] === before[0] && after[1] === before[1])
    throw new Error("窗口位置没有变化：" + JSON.stringify({ before, after }));

  const dragRegion = await win.webContents.executeJavaScript(`(() => {
    const bar = document.querySelector("#sidebar .titlebar");
    if (!bar) return "";
    const style = getComputedStyle(bar);
    return style.getPropertyValue("-webkit-app-region") || style.webkitAppRegion || "";
  })()`);
  if (!String(dragRegion).includes("drag")) throw new Error("标题条不可拖动：" + dragRegion);

  const scroll = await win.webContents.executeJavaScript(`(() => {
    const body = document.querySelector("#sidebar .pane-body");
    if (!body) return null;
    const beforeTop = body.scrollTop;
    const max = body.scrollHeight - body.clientHeight;
    body.scrollTop = max;
    return {
      before: beforeTop,
      after: body.scrollTop,
      max,
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
    };
  })()`);
  if (!scroll || !(scroll.scrollHeight > scroll.clientHeight) || !(scroll.after > scroll.before))
    throw new Error("侧栏滚动没有变化：" + JSON.stringify(scroll));

  const progressAfter = parseProgress(
    await win.webContents.executeJavaScript(`(() => {
      const node = document.querySelector('[data-root-id="root-large"] [data-scan-progress]');
      return node ? node.getAttribute("data-scan-progress") : "";
    })()`),
  );
  if (!progressAfter)
    throw new Error("交互后扫描进度不在界面上，交互前是 " + progress.text);
  if (progressAfter.total !== progress.total)
    throw new Error("交互后扫描总量变了：" + progress.text + " → " + progressAfter.text);
  if (!(progressAfter.done > progress.done))
    throw new Error("交互后扫描没有继续：" + progress.text + " → " + progressAfter.text);
  return {
    responded: true,
    progress,
    progressAfter,
    moved: { before, after },
    dragRegion,
    scroll,
    screenshots: false,
  };
}

async function waitForProgress(win, budgetMs) {
  const started = Date.now();
  while (Date.now() - started < budgetMs) {
    const value = await win.webContents.executeJavaScript(`(() => {
      const node = document.querySelector('[data-root-id="root-large"] [data-scan-progress]');
      return node ? node.getAttribute("data-scan-progress") : "";
    })()`);
    const progress = parseProgress(value);
    if (progress) return progress;
    await delay(30);
  }
  return null;
}

async function waitFor(read, message) {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    if (await read()) return;
    await delay(50);
  }
  throw new Error(message);
}
