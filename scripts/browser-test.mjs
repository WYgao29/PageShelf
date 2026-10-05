import { spawn } from "node:child_process";
import {
  access,
  readFile,
  writeFile,
  mkdtemp,
  rm,
  realpath,
} from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createServer } from "../src/server.js";
import {
  withTempFixture,
  createLegacyFixture,
  testTrashService,
} from "../test/helpers/fixture.js";
const root = fileURLToPath(new URL("../", import.meta.url));
const chrome =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!process.argv.includes("--serve")) {
  try {
    await access(chrome);
  } catch {
    console.log(
      JSON.stringify({
        status: "skipped",
        passed: 0,
        failed: 0,
        skipped: 1,
        failures: ["Chrome unavailable"],
      }),
    );
    process.exit(2);
  }
}
await withTempFixture(async (directory) => {
  const fixture = await createLegacyFixture(directory);
  if (process.argv.includes("--real"))
    await writeFile(
      path.join(fixture.dataDir, "config.json"),
      await readFile(path.join(os.homedir(), ".html-library", "config.json")),
    );
  const server = createServer({
    dataDir: fixture.dataDir,
    trashService: testTrashService,
    chooseDirectory: async () => fixture.rootPath,
  });
  await server.ready;
  const handler = server.listeners("request")[0];
  server.removeAllListeners("request");
  const CSP =
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
  let outboundRequests = 0;
  const probe = createHttpServer((request, response) => {
    outboundRequests++;
    response.end("unexpected external resource");
  });
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  server.on("request", async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (
      process.argv.includes("--serve") &&
      url.pathname === "/test/results" &&
      request.method === "POST" &&
      request.headers.origin === "http://" + request.headers.host
    ) {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 1000000) {
          response.writeHead(413);
          response.end();
          return;
        }
      }
      try {
        const result = JSON.parse(body);
        result.outboundRequests = outboundRequests;
        if (outboundRequests) {
          result.status = "failed";
          result.failed++;
          result.failures.push({
            name: "no automatic external requests",
            message: String(outboundRequests),
          });
        }
        const userAgent = result.userAgent || "";
        const browser = /Edg\//.test(userAgent)
          ? "edge"
          : /(?:Chrome|Chromium)\//.test(userAgent)
            ? "chrome"
            : /Safari\//.test(userAgent)
              ? "safari"
              : "manual";
        const artifact =
          "browser-" +
          browser +
          "-" +
          new Date().toISOString().slice(0, 10) +
          ".json";
        await writeFile(
          path.join(root, "docs", "verification", artifact),
          JSON.stringify(result, null, 2) + "\n",
        );
        console.log(JSON.stringify(result, null, 2));
        response.writeHead(200);
        response.end(artifact);
      } catch (error) {
        response.writeHead(400);
        response.end(error.message);
      }
      return;
    }
    if (url.pathname === "/test/fixture-info") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          rootPath: await realpath(fixture.rootPath),
          childPath: await realpath(
            path.join(fixture.rootPath, "腾讯云ADP-FDE认证课程"),
          ),
          dataDir: fixture.dataDir,
        }),
      );
      return;
    }
    if (url.pathname === "/test/probe-info") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          url: "http://127.0.0.1:" + probe.address().port + "/attempt",
          count: outboundRequests,
        }),
      );
      return;
    }
    if (url.pathname.startsWith("/test/")) {
      const relative = url.pathname.slice(1),
        allowed =
          /^test\/(browser\/[a-zA-Z0-9-]+\.(?:html|js)|fixtures\/xss\/cases\.json)$/.test(
            relative,
          );
      if (!allowed) {
        response.writeHead(404);
        response.end();
        return;
      }
      try {
        const content = await readFile(path.join(root, relative));
        response.writeHead(200, {
          "content-type": relative.endsWith(".js")
            ? "text/javascript"
            : relative.endsWith(".json")
              ? "application/json"
              : "text/html",
          "content-security-policy": CSP,
        });
        response.end(content);
      } catch {
        response.writeHead(404);
        response.end();
      }
      return;
    }
    handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  if (process.argv.includes("--serve")) {
    console.log(
      JSON.stringify({
        url:
          "http://127.0.0.1:" +
          server.address().port +
          "/test/browser/run.html?manual=1",
      }),
    );
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => probe.close(resolve));
    return;
  }
  const profile = await mkdtemp(path.join(os.tmpdir(), "html-v2-chrome-"));
  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--disable-translate",
      "--metrics-recording-only",
      "--mute-audio",
      "--remote-debugging-pipe",
      "--user-data-dir=" + profile,
      "--window-size=1440,900",
    ],
    { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
  );
  const pending = new Map();
  let nextId = 0,
    buffer = "",
    errors = "";
  child.stderr.on("data", (data) => {
    if (errors.length < 8000) errors += data;
  });
  child.stdio[4].on("data", (data) => {
    buffer += data;
    let index;
    while ((index = buffer.indexOf("\0")) >= 0) {
      const message = JSON.parse(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        message.error
          ? waiter.reject(new Error(message.error.message))
          : waiter.resolve(message.result);
      }
    }
  });
  function command(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      child.stdio[3].write(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }) + "\0",
      );
    });
  }
  const timeout = setTimeout(() => {
    child.kill("SIGKILL");
    for (const waiter of pending.values())
      waiter.reject(new Error("Browser test timed out"));
  }, 60000);
  try {
    const url =
      "http://127.0.0.1:" +
      server.address().port +
      "/test/browser/run.html" +
      (process.argv.includes("--force-failure")
        ? "?fail=1"
        : process.argv.includes("--real")
          ? "?real=1"
          : "");
    const { targetId } = await command("Target.createTarget", { url });
    const { sessionId } = await command("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    await command("Runtime.enable", {}, sessionId);
    let result;
    const deadline = Date.now() + 55000;
    while (Date.now() < deadline) {
      const evaluated = await command(
        "Runtime.evaluate",
        { expression: "globalThis.__testResult || null", returnByValue: true },
        sessionId,
      );
      result = evaluated.result?.value;
      if (result) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!result) throw new Error("Browser did not publish #test-result");
    if (process.argv.includes("--screenshots") && result.status === "passed") {
      const { captureAcceptance } = await import("./capture-ui.mjs");
      result.uiAudit = await captureAcceptance({
        command,
        baseUrl: "http://127.0.0.1:" + server.address().port,
        fixture,
        real: process.argv.includes("--real"),
        library: server.library(),
      });
    }
    result.outboundRequests = outboundRequests;
    if (outboundRequests) {
      result.status = "failed";
      result.failed++;
      result.failures.push({
        name: "no automatic external resource requests",
        message: String(outboundRequests),
      });
    }
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "passed" || result.failed || result.skipped)
      process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => probe.close(resolve));
    await rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
