import { build } from "esbuild";
import { mkdir } from "node:fs/promises";

await mkdir("dist-electron", { recursive: true });
await build({
  entryPoints: {
    main: "electron/main.ts",
    "backend/worker": "electron/backend/worker.ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: "dist-electron",
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
});
