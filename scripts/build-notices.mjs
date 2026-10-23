import { mkdir, copyFile } from "node:fs/promises";
const directory = new URL("../dist/licenses/", import.meta.url);
await mkdir(directory, { recursive: true });
for (const [source, target] of [
  ["../src-ui/assets/fonts/Inter-LICENSE.txt", "Inter-LICENSE.txt"],
  ["../src-ui/assets/fonts/SpaceGrotesk-OFL.txt", "SpaceGrotesk-OFL.txt"],
  ["../src-ui/vendor/marked-18.0.14/LICENSE", "marked-LICENSE.txt"],
  ["../src-ui/vendor/dompurify-3.4.16/LICENSE", "DOMPurify-LICENSE.txt"],
  ["../src-ui/vendor/readability-0.6.0/LICENSE", "Readability-LICENSE.txt"],
  ["../src-ui/vendor/VENDOR.md", "VENDOR.md"],
  ["../node_modules/react/LICENSE", "React-LICENSE.txt"],
  ["../node_modules/react-dom/LICENSE", "ReactDOM-LICENSE.txt"],
  ["../node_modules/scheduler/LICENSE", "Scheduler-LICENSE.txt"],
]) await copyFile(new URL(source, import.meta.url), new URL(target, directory));
console.log("LICENSES_PACKAGED 9 notices");
