import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SERVICE_LABEL,
  createLaunchAgentPlist,
  getLaunchAgentStatus,
  installLaunchAgent,
  uninstallLaunchAgent,
} from "../src/service.js";

test("creates a local-only LaunchAgent plist with stable paths", () => {
  const plist = createLaunchAgentPlist({
    label: SERVICE_LABEL,
    nodePath: "/opt/homebrew/bin/node",
    serverPath: "/Users/example/HTML Library/src/server.js",
    workingDirectory: "/Users/example/HTML Library",
    stdoutPath: "/Users/example/Library/Logs/html-library/stdout.log",
    stderrPath: "/Users/example/Library/Logs/html-library/stderr.log",
  });

  assert.match(
    plist,
    /<key>Label<\/key>\s*<string>com\.local\.html-conversation-library<\/string>/,
  );
  assert.match(plist, /<string>\/opt\/homebrew\/bin\/node<\/string>/);
  assert.match(
    plist,
    /<string>\/Users\/example\/HTML Library\/src\/server\.js<\/string>/,
  );
  assert.match(plist, /<key>HOST<\/key>\s*<string>127\.0\.0\.1<\/string>/);
  assert.match(plist, /<key>PORT<\/key>\s*<string>4321<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(
    plist,
    /<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/,
  );
  assert.match(plist, /HTML Library/);
  assert.doesNotMatch(plist, /<string>0\.0\.0\.0<\/string>/);
});

test("installs a LaunchAgent by writing its plist and bootstrapping launchctl", async () => {
  const homeDirectory = await mkdtemp(
    path.join(os.tmpdir(), "html-library-service-home-"),
  );
  const projectDirectory = await mkdtemp(
    path.join(os.tmpdir(), "html-library-service-project-"),
  );
  const calls = [];
  const result = await installLaunchAgent({
    homeDirectory,
    projectDirectory,
    nodePath: "/usr/local/bin/node",
    userId: "501",
    launchctl: async (args) => calls.push(args),
  });

  assert.equal(result.label, SERVICE_LABEL);
  assert.deepEqual(calls, [
    ["bootout", `gui/501/${SERVICE_LABEL}`],
    ["bootstrap", "gui/501", result.plistPath],
  ]);
  const plist = await readFile(result.plistPath, "utf8");
  assert.match(
    plist,
    new RegExp(
      `<string>${projectDirectory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/src/server\\.js</string>`,
    ),
  );
  await access(result.plistPath);
  await access(result.logDirectory);
});

test("reports LaunchAgent status from launchctl success or failure", async () => {
  assert.equal(
    await getLaunchAgentStatus({
      userId: "501",
      launchctl: async () => undefined,
    }),
    true,
  );
  assert.equal(
    await getLaunchAgentStatus({
      userId: "501",
      launchctl: async () => {
        throw new Error("not loaded");
      },
    }),
    false,
  );
});

test("uninstalls a LaunchAgent and removes its plist", async () => {
  const homeDirectory = await mkdtemp(
    path.join(os.tmpdir(), "html-library-service-uninstall-"),
  );
  const calls = [];
  const installed = await installLaunchAgent({
    homeDirectory,
    projectDirectory: "/Users/example/HTML Library",
    userId: "501",
    launchctl: async (args) => calls.push(args),
  });

  await uninstallLaunchAgent({
    homeDirectory,
    userId: "501",
    launchctl: async (args) => calls.push(args),
  });

  await assert.rejects(access(installed.plistPath), { code: "ENOENT" });
  assert.deepEqual(calls.at(-1), ["bootout", `gui/501/${SERVICE_LABEL}`]);
});
