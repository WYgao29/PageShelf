import os from "node:os";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { validateSourceFile } from "../source-files.js";
export async function handle({
  request,
  response,
  url,
  chooseDirectory,
  sendJson,
  body,
  registry,
  library,
  systemExecFile,
}) {
  if (
    ["/api/system/choose-folder", "/api/settings/choose-folder"].includes(
      url.pathname,
    ) &&
    request.method === "POST"
  ) {
    const selected = await chooseDirectory();
    if (selected !== null && (typeof selected !== "string" || !selected.trim()))
      throw Object.assign(new Error("选择的文件夹路径无效"), {
        code: "FOLDER_PICKER_UNAVAILABLE",
      });
    sendJson(
      response,
      200,
      selected === null
        ? { cancelled: true }
        : { cancelled: false, path: selected.trim() },
    );
    return true;
  }
  if (url.pathname === "/api/system/reveal" && request.method === "POST") {
    const keys = Object.keys(body);
    if (
      keys.length !== 1 ||
      !["itemId", "rootId", "trash"].includes(keys[0]) ||
      (keys[0] === "trash" && body.trash !== true)
    )
      throw Object.assign(new Error("请指定条目、来源目录或废纸篓"), {
        code: "INVALID_REVEAL",
      });
    let argv;
    if (body.trash) argv = ["-a", "Finder", path.join(os.homedir(), ".Trash")];
    else if (body.rootId) {
      const root = registry.get(body.rootId);
      if (!root)
        throw Object.assign(new Error("目录不存在"), {
          code: "ROOT_NOT_FOUND",
        });
      let canonical;
      try {
        canonical = await realpath(root.path);
      } catch {
        throw Object.assign(new Error("目录不存在"), {
          code: "ROOT_NOT_FOUND",
        });
      }
      argv = ["-R", canonical];
    } else {
      const item = library.getItem(body.itemId),
        root = item && registry.get(item.rootId);
      if (!item || !root)
        throw Object.assign(new Error("源文件不存在"), {
          code: "SOURCE_NOT_FOUND",
        });
      const source = await validateSourceFile(
        root.realPath,
        item.sourceFiles[0].path,
      );
      argv = ["-R", source.path];
    }
    await systemExecFile("/usr/bin/open", argv, { timeout: 15000 });
    sendJson(response, 200, { revealed: true });
    return true;
  }
  return false;
}
