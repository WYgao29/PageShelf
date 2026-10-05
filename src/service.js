import { execFile as execFileCallback } from "node:child_process";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectDirectory = path.resolve(sourceDirectory, "..");

export const SERVICE_LABEL = "com.local.html-conversation-library";
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 4321;

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xmlString(value) {
  return "<string>" + xmlEscape(value) + "</string>";
}

export function getServicePaths({
  homeDirectory = os.homedir(),
  projectDirectory = defaultProjectDirectory,
  label = SERVICE_LABEL,
} = {}) {
  const launchAgentsDirectory = path.join(homeDirectory, "Library", "LaunchAgents");
  const logDirectory = path.join(homeDirectory, "Library", "Logs", "html-conversation-library");
  return {
    label,
    projectDirectory: path.resolve(projectDirectory),
    serverPath: path.resolve(projectDirectory, "src", "server.js"),
    plistPath: path.join(launchAgentsDirectory, label + ".plist"),
    logDirectory,
    stdoutPath: path.join(logDirectory, "stdout.log"),
    stderrPath: path.join(logDirectory, "stderr.log"),
  };
}

export function createLaunchAgentPlist({
  label = SERVICE_LABEL,
  nodePath = process.execPath,
  serverPath = path.join(defaultProjectDirectory, "src", "server.js"),
  workingDirectory = defaultProjectDirectory,
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  stdoutPath = path.join(os.homedir(), "Library", "Logs", "html-conversation-library", "stdout.log"),
  stderrPath = path.join(os.homedir(), "Library", "Logs", "html-conversation-library", "stderr.log"),
} = {}) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    "  " + xmlString(label),
    "  <key>ProgramArguments</key>",
    "  <array>",
    "    " + xmlString(nodePath),
    "    " + xmlString(serverPath),
    "  </array>",
    "  <key>WorkingDirectory</key>",
    "  " + xmlString(workingDirectory),
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    "    <key>HOST</key>",
    "    " + xmlString(host),
    "    <key>PORT</key>",
    "    " + xmlString(port),
    "  </dict>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <dict><key>SuccessfulExit</key><false/></dict>",
    "  <key>StandardOutPath</key>",
    "  " + xmlString(stdoutPath),
    "  <key>StandardErrorPath</key>",
    "  " + xmlString(stderrPath),
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

export async function runLaunchctl(args) {
  await execFile("launchctl", args);
}

function requireMacOS(platform = process.platform) {
  if (platform !== "darwin") throw new Error("macOS LaunchAgent 只能在 macOS 上使用");
}

function currentUserId(userId) {
  if (userId !== undefined && userId !== null && String(userId).trim()) return String(userId);
  if (typeof process.getuid === "function") return String(process.getuid());
  throw new Error("无法确定当前 macOS 用户 ID");
}

function launchctlTarget(userId, label) {
  const domain = "gui/" + currentUserId(userId);
  return { domain, target: domain + "/" + label };
}

async function ignoreMissingService(launchctl, args) {
  try {
    await launchctl(args);
  } catch (error) {
    if (args[0] !== "bootout") throw error;
  }
}

export async function stopLaunchAgent({
  label = SERVICE_LABEL,
  userId,
  platform = process.platform,
  launchctl = runLaunchctl,
} = {}) {
  requireMacOS(platform);
  const { target } = launchctlTarget(userId, label);
  await ignoreMissingService(launchctl, ["bootout", target]);
  return { label, target, running: false };
}

export async function installLaunchAgent({
  homeDirectory = os.homedir(),
  projectDirectory = defaultProjectDirectory,
  nodePath = process.execPath,
  label = SERVICE_LABEL,
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  userId,
  platform = process.platform,
  launchctl = runLaunchctl,
} = {}) {
  requireMacOS(platform);
  const paths = getServicePaths({ homeDirectory, projectDirectory, label });
  const { domain, target } = launchctlTarget(userId, label);
  await mkdir(path.dirname(paths.plistPath), { recursive: true });
  await mkdir(paths.logDirectory, { recursive: true });
  await writeFile(
    paths.plistPath,
    createLaunchAgentPlist({
      label,
      nodePath,
      serverPath: paths.serverPath,
      workingDirectory: paths.projectDirectory,
      host,
      port,
      stdoutPath: paths.stdoutPath,
      stderrPath: paths.stderrPath,
    }),
    { encoding: "utf8", mode: 0o644 },
  );
  await ignoreMissingService(launchctl, ["bootout", target]);
  await launchctl(["bootstrap", domain, paths.plistPath]);
  return { ...paths, domain, target, url: "http://" + host + ":" + port };
}

export async function getLaunchAgentStatus({
  label = SERVICE_LABEL,
  userId,
  platform = process.platform,
  launchctl = runLaunchctl,
} = {}) {
  requireMacOS(platform);
  const { target } = launchctlTarget(userId, label);
  try {
    await launchctl(["print", target]);
    return true;
  } catch {
    return false;
  }
}

export async function uninstallLaunchAgent({
  homeDirectory = os.homedir(),
  label = SERVICE_LABEL,
  userId,
  platform = process.platform,
  launchctl = runLaunchctl,
} = {}) {
  requireMacOS(platform);
  const paths = getServicePaths({ homeDirectory, label });
  await stopLaunchAgent({ label, userId, platform, launchctl });
  try {
    await unlink(paths.plistPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return paths;
}

function printUsage() {
  console.log([
    "用法：npm run service:<命令>",
    "",
    "  service:install    安装并启动后台服务",
    "  service:status     查看后台服务状态",
    "  service:stop       停止后台服务",
    "  service:uninstall   停止并取消开机自动启动",
  ].join("\n"));
}

async function runCli(command) {
  if (!command || command === "help" || command === "--help") {
    printUsage();
    return;
  }
  if (command === "install") {
    const result = await installLaunchAgent();
    console.log("后台服务已安装并启动：" + result.url);
    console.log("配置文件：" + result.plistPath);
    return;
  }
  if (command === "status") {
    const running = await getLaunchAgentStatus();
    console.log(running ? "后台服务正在运行。" : "后台服务未运行。");
    return;
  }
  if (command === "stop") {
    await stopLaunchAgent();
    console.log("后台服务已停止。再次执行 npm run service:install 即可启动。");
    return;
  }
  if (command === "uninstall") {
    const result = await uninstallLaunchAgent();
    console.log("后台服务已卸载：" + result.plistPath);
    return;
  }
  throw new Error("未知命令：" + command);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await runCli(process.argv[2]);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}
