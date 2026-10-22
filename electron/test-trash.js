import os from "node:os";
import path from "node:path";
import { realpath, rename } from "node:fs/promises";

// Explicit E2E-only double: never touches files outside that test's temporary tree.
export async function testTrashFor(env) {
  if (env.PAGESHELF_TEST !== "1" || env.PAGESHELF_TEST_TRASH !== "1") return undefined;
  const temp = await realpath(os.tmpdir());
  const data = await realpath(env.HTML_LIBRARY_DATA_DIR);
  const testRoot = path.dirname(data);
  if (!testRoot.startsWith(temp + path.sep) || !path.basename(testRoot).startsWith("pageshelf-e2e-"))
    throw new Error("废纸篓替身只允许操作本次 E2E 临时目录");
  return { async trashFiles({ paths }) {
    for (const file of paths) {
      const canonical = await realpath(file);
      if (!canonical.startsWith(testRoot + path.sep)) throw new Error("测试源文件越界");
    }
    for (const file of paths) await rename(file, file + ".trashed-test");
    return { trashed: paths, failed: [], method: "e2e-test" };
  } };
}
