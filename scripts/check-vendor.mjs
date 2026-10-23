import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const argument = process.argv.indexOf("--vendor-dir");
const directory =
  argument >= 0
    ? process.argv[argument + 1]
    : fileURLToPath(new URL("../src-ui/vendor/", import.meta.url));
const files = {
  "marked-18.0.14/marked.esm.js":
    "528a1b88bef88fc27277e06036ce7f4afb6a220b18110ba57c09e292b24a7ce0",
  "dompurify-3.4.16/purify.es.mjs":
    "c44274a7959cfdd4da871fa78a5d5fbbef55db68d118c5c0833bc4b5cf9633ad",
  "readability-0.6.0/Readability.js":
    "34dcab3d0832d0019f02990eed6b6124e029e8c32b9f0c6f2550544ff8dff174",
};
for (const [filename, expected] of Object.entries(files)) {
  const buffer = await readFile(path.join(directory, filename));
  if (createHash("sha256").update(buffer).digest("hex") !== expected)
    throw new Error("Vendor hash mismatch: " + filename);
  console.log("Verified " + filename);
}
