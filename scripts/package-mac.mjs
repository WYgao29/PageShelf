import { packager } from "@electron/packager";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electron = JSON.parse(await readFile(path.join(root, "node_modules/electron/package.json"), "utf8"));
const appPackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const paths = await packager({
  dir: root, out: path.join(root, "release"), name: "PageShelf",
  platform: "darwin", arch: "arm64", electronVersion: electron.version,
  appBundleId: "com.wayne.pageshelf", appVersion: appPackage.version,
  appCategoryType: "public.app-category.productivity",
  icon: path.join(root, "build/icon.icns"), overwrite: true,
  asar: false, prune: false,
  ignore: filename => {
    const relative = (filename.startsWith(root + path.sep) ? path.relative(root, filename) : filename.replace(/^[/\\]+/, "")).replaceAll(path.sep, "/");
    if (!relative) return false;
    return !(relative === "package.json" || relative === "electron" || relative === "electron/preload.cjs" || relative === "dist" || relative.startsWith("dist/") || relative === "dist-electron" || relative.startsWith("dist-electron/")) || relative.endsWith(".map");
  },
});
for (const output of paths) console.log("PACKAGED " + path.join(output, "PageShelf.app"));
