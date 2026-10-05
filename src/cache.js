import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  stat,
  rm,
} from "node:fs/promises";
import path from "node:path";
const hash = (value) => createHash("sha256").update(value).digest("hex");
export function documentIdentity({
  itemId,
  format,
  path: sourcePath,
  stat: info,
}) {
  return hash(
    [
      itemId,
      format,
      sourcePath,
      info.dev,
      info.ino,
      info.size,
      info.mtimeMs,
    ].join("\n"),
  );
}
export function createDocumentCache({
  directory,
  maxBytes = 500 * 1024 * 1024,
}) {
  const entries = new Map(),
    pending = new Map(),
    revisions = new Map();
  let epoch = 0,
    loaded,
    operations = Promise.resolve();
  const serialize = (callback) => {
    const result = operations.then(callback);
    operations = result.catch(() => {});
    return result;
  };
  async function init() {
    if (!loaded)
      loaded = (async () => {
        await mkdir(directory, { recursive: true });
        for (const name of await readdir(directory)) {
          if (!/^[a-f0-9]{16}-[a-f0-9]{64}\.html$/.test(name)) continue;
          const info = await stat(path.join(directory, name));
          entries.set(name, { size: info.size, access: info.mtimeMs });
        }
      })();
    return loaded;
  }
  async function evict() {
    let bytes = [...entries.values()].reduce(
      (sum, entry) => sum + entry.size,
      0,
    );
    for (const [name, entry] of [...entries].sort(
      (a, b) => a[1].access - b[1].access,
    )) {
      if (bytes <= maxBytes) break;
      await rm(path.join(directory, name), { force: true });
      entries.delete(name);
      bytes -= entry.size;
    }
  }
  async function getOrCreate(key, producer, { itemId = key } = {}) {
    await init();
    const prefix = hash(itemId).slice(0, 16),
      name = prefix + "-" + hash(key) + ".html",
      token = epoch + ":" + (revisions.get(prefix) || 0),
      pendingKey = name + ":" + token;
    const entry = entries.get(name);
    if (entry) {
      try {
        const content = await readFile(path.join(directory, name), "utf8");
        entry.access = Date.now();
        return content;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        entries.delete(name);
      }
    }
    if (pending.has(pendingKey)) return pending.get(pendingKey);
    const promise = (async () => {
      const content = String(await producer());
      await serialize(async () => {
        if (token !== epoch + ":" + (revisions.get(prefix) || 0)) return;
        const temporary = path.join(directory, name + ".tmp-" + randomUUID());
        try {
          await writeFile(temporary, content);
          await rename(temporary, path.join(directory, name));
          entries.set(name, {
            size: Buffer.byteLength(content),
            access: Date.now(),
          });
          await evict();
        } finally {
          await rm(temporary, { force: true });
        }
      });
      return content;
    })();
    pending.set(pendingKey, promise);
    try {
      return await promise;
    } finally {
      pending.delete(pendingKey);
    }
  }
  async function invalidateItem(itemId) {
    const prefix = hash(itemId).slice(0, 16);
    revisions.set(prefix, (revisions.get(prefix) || 0) + 1);
    await init();
    await serialize(async () => {
      for (const name of [...entries.keys()])
        if (name.startsWith(prefix + "-")) {
          await rm(path.join(directory, name), { force: true });
          entries.delete(name);
        }
    });
  }
  async function clear() {
    epoch++;
    await init();
    await serialize(async () => {
      for (const name of [...entries.keys()])
        await rm(path.join(directory, name), { force: true });
      entries.clear();
    });
    return { cleared: true };
  }
  return { getOrCreate, invalidateItem, clear };
}
