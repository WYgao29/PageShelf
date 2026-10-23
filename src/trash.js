import { execFile as callbackExecFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import { validateSourceFile } from "./source-files.js";
const finderScript =
  'on run argv\n tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)\nend run';
export function createTrashService({
  execFile = promisify(callbackExecFile),
  fsOps = {},
} = {}) {
  const ops = { ...fs, ...fsOps };
  async function exists(file) {
    try {
      await ops.lstat(file);
      return true;
    } catch (e) {
      if (e.code === "ENOENT") return false;
      throw e;
    }
  }
  return {
    async trashFiles({ rootPath, paths }) {
      for (const file of paths) await validateSourceFile(rootPath, file, ops);
      let cliError;
      try {
        await execFile("/usr/bin/trash", ["--", ...paths], { timeout: 15000 });
      } catch (error) {
        cliError = error;
      }
      const trashed = [],
        failed = [];
      let finderUsed = false;
      for (const file of paths) {
        if (!(await exists(file))) {
          trashed.push(file);
          continue;
        }
        try {
          await validateSourceFile(rootPath, file, ops);
          finderUsed = true;
          await execFile("/usr/bin/osascript", ["-e", finderScript, file], {
            timeout: 15000,
          });
          if (await exists(file)) throw new Error("访达未移动文件");
          trashed.push(file);
        } catch (error) {
          failed.push({
            path: file,
            message: (
              error.stderr ||
              error.message ||
              cliError?.message ||
              "操作失败"
            ).trim(),
          });
        }
      }
      if (!trashed.length && failed.length)
        throw Object.assign(
          new Error(
            "无法移入废纸篓：" +
              failed.map((x) => x.message).join("；") +
              "。文件没有被改动。",
          ),
          { code: "TRASH_FAILED", details: { failed } },
        );
      return { trashed, failed, method: finderUsed ? "finder" : "trash-cli" };
    },
  };
}
