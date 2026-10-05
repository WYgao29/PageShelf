import { mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";

// Optional artifacts from the same isolated Chrome used by browser-test.mjs.
export async function captureAcceptance({
  command,
  baseUrl,
  fixture,
  real,
  library,
}) {
  const directory = path.resolve("docs/verification/screenshots");
  await mkdir(directory, { recursive: true });
  const data = await (await fetch(baseUrl + "/api/items?limit=100")).json();
  const item =
    data.items.find((value) => value.title.startsWith("第一讲：")) ||
    data.items.find((value) => value.mhtml);
  const url =
    baseUrl +
    "/r/" +
    encodeURIComponent(item.rootId) +
    "/s/" +
    item.series.key +
    "?" +
    new URLSearchParams({ item: item.id, q: "证据", sort: "relevance" });
  const { targetId } = await command("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await command("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const send = (method, params = {}) => command(method, params, sessionId);
  const evaluate = async (expression) => {
    const output = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (output.exceptionDetails) throw Error(output.exceptionDetails.text);
    return output.result?.value;
  };
  const until = async (expression) => {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw Error("Screenshot state not ready: " + expression);
  };
  const evidence = [];
  const capture = async (name, width, theme) => {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(
      `localStorage.setItem('ui.theme',${JSON.stringify(theme)});document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelector('.reader-scroll')?.scrollTo(0,0)`,
    );
    await evaluate(
      "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
    );
    const metrics = await evaluate(
      `({width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.theme,side:document.querySelector('#sidebar').getBoundingClientRect().width,list:document.querySelector('#list-pane').getBoundingClientRect().width,headings:document.querySelectorAll('[data-heading-id]').length,tocVisible:!!document.querySelector('.article-toc')&&getComputedStyle(document.querySelector('.article-toc')).display!=='none',overflow:document.documentElement.scrollWidth>innerWidth,dialogWidth:document.querySelector('dialog[open]')?.getBoundingClientRect().width||null})`,
    );
    if (metrics.overflow) throw Error("Horizontal overflow at " + width);
    const { data: screenshot } = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    await writeFile(
      path.join(directory, name + ".png"),
      Buffer.from(screenshot, "base64"),
    );
    evidence.push({ name, ...metrics });
  };
  try {
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await send("Page.navigate", { url });
    await until(
      "document.querySelector('.reading-article')&&document.querySelector('[data-item-id]')",
    );
    await capture("reader-light-1440", 1440, "light");
    await capture("reader-dark-1440", 1440, "dark");
    await capture("reader-light-1280", 1280, "light");
    await capture("reader-light-1024", 1024, "light");
    await evaluate("document.querySelector('[data-open-manager]').click()");
    await until("document.querySelector('dialog.manager[open]')");
    await capture("manager-light-1440", 1440, "light");
    await capture("manager-dark-1440", 1440, "dark");
    const setPath = async (value) => {
      await evaluate(
        `(()=>{const input=document.querySelector('#root-path');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
    };
    const roots = await (await fetch(baseUrl + "/api/roots")).json();
    await setPath(roots.roots[0].path);
    await until(
      "document.querySelector('#root-preview').textContent.includes('已经添加')",
    );
    await capture("manager-duplicate-1440", 1440, "light");
    await setPath("/__html_library_acceptance_missing__");
    await until(
      "document.querySelector('#root-preview').textContent.includes('不存在')",
    );
    await capture("manager-invalid-1440", 1440, "light");
    await setPath(
      path.join(
        real ? roots.roots[0].path : fixture.rootPath,
        "腾讯云ADP-FDE认证课程",
      ),
    );
    await until(
      "document.querySelector('#root-preview').textContent.includes('40 条')",
    );
    await capture("manager-overlap-1440", 1440, "light");
    // Additional display states use a disposable source and copied configuration.
    const controlledPath = path.join(fixture.dataDir, "audit-empty-root");
    await mkdir(controlledPath);
    const mutate = async (route, method, body = {}) => {
      const response = await fetch(baseUrl + route, {
        method,
        headers: { origin: baseUrl, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error?.message);
      return result;
    };
    const added = await mutate("/api/roots", "POST", {
      path: controlledPath,
      label: roots.roots[0].label,
    });
    const id = added.root.id;
    await library.scheduler.waitForIdle();
    const reload = async () => {
      await send("Page.reload");
      await until(`document.querySelector('[data-manager-root="${id}"]')`);
    };
    try {
      await reload();
      await until(
        "document.querySelector('.manager-status .badge')?.textContent.includes('显示名相同')",
      );
      await capture("manager-same-label-1440", 1440, "light");
      await rename(controlledPath, controlledPath + "-moved");
      await mutate("/api/roots/" + id + "/scan", "POST");
      await library.scheduler.waitForIdle();
      await reload();
      await until(
        `document.querySelector('[data-manager-root="${id}"]').textContent.includes('不存在')`,
      );
      await capture("manager-missing-1440", 1440, "light");
      await rename(controlledPath + "-moved", controlledPath);
      await mutate("/api/roots/" + id + "/scan", "POST");
      await library.scheduler.waitForIdle();
      const status = library.scheduler.status;
      // Deterministic rendering of the scan contract; queue execution has separate tests.
      library.scheduler.status = () => ({
        running: [{ rootId: id, files: { done: 2, total: 5 } }],
        queued: [],
      });
      library.registry.setIndexState(id, { state: "scanning" });
      try {
        await reload();
        await until(
          `document.querySelector('[data-manager-root="${id}"]').textContent.includes('扫描中 2/5')`,
        );
        await capture("manager-scan-contract-1440", 1440, "light");
        evidence.at(-1).controlledScanContract = true;
      } finally {
        library.scheduler.status = status;
        library.registry.setIndexState(id, { state: "ok" });
      }
    } finally {
      await mutate("/api/roots/" + id, "DELETE");
      await library.scheduler.waitForIdle();
    }
    await writeFile(
      "docs/verification/ui-layout-2026-10-05.json",
      JSON.stringify({ real, evidence }, null, 2) + "\n",
    );
    return {
      screenshots: evidence.length,
      layouts: evidence.map((value) => ({
        name: value.name,
        width: value.width,
        overflow: value.overflow,
      })),
    };
  } finally {
    await command("Target.closeTarget", { targetId });
  }
}
