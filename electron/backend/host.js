import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { createDocumentCache } from "../../src/cache.js";
import { createConfigStore } from "../../src/config.js";
import { createLibrary } from "../../src/library.js";
import { createRootRegistry } from "../../src/roots.js";
import * as items from "../../src/services/items.js";
import * as roots from "../../src/services/roots.js";
import * as system from "../../src/services/system.js";
import {
  MAIN_ONLY_METHODS,
  validateInvocation,
} from "../../shared/pageshelf-contract.js";

const execFile = promisify(execFileCallback);

const presentBytes = (result) =>
  result.status === 304
    ? { notModified: true, headers: result.headers, body: null }
    : { notModified: false, headers: result.headers, body: result.body };

const failure = (code, message) => Object.assign(new Error(message), { code });

export async function createLibraryHost({
  dataDir = path.join(os.homedir(), ".html-library"),
  trashService,
  chooseDirectory,
  systemExecFile = execFile,
} = {}) {
  const activeDataDir = path.resolve(dataDir);
  const configStore = createConfigStore({ dataDir: activeDataDir });
  const registry = createRootRegistry({ configStore });
  await registry.load();
  const library = createLibrary({
    rootRegistry: registry,
    ...(trashService ? { trashService } : {}),
  });
  const cache = createDocumentCache({
    directory: path.join(activeDataDir, "cache", "doc"),
  });
  const listeners = new Set();
  let timer = null;
  let closed = false;
  const emit = (event) => {
    for (const listener of listeners) listener(event);
  };
  const ensureWatch = () => {
    if (timer || closed) return;
    const tick = () => {
      if (closed) return;
      const status = library.scheduler.status();
      emit({ event: "scan-progress", payload: status });
      if (!status.running.length && !status.queued.length && timer) {
        clearInterval(timer);
        timer = null;
        emit({ event: "library-changed", payload: { reason: "scan" } });
      }
    };
    timer = setInterval(tick, 50);
    timer.unref?.();
  };
  const listed = registry.list();
  listed.forEach((root) => library.scheduler.enqueue(root.id, {}));
  if (listed.length) {
    ensureWatch();
    await library.scheduler.waitForRoot(listed[0].id);
  }
  const deps = { library, registry };

  async function call(method, params) {
    const input = validateInvocation({ method, params });
    if (MAIN_ONLY_METHODS.includes(method))
      throw failure("DESKTOP_ONLY", "该方法只在桌面主进程执行");
    switch (method) {
      case "roots.list":
        return roots.listRoots(deps).json;
      case "roots.preflight":
        return (
          await roots.saveRoot({
            ...deps,
            mode: input.excludeId ? "patch" : "add",
            id: input.excludeId,
            body: {
              path: input.path,
              ...(input.label !== undefined ? { label: input.label } : {}),
            },
            dryRun: true,
          })
        ).json;
      case "roots.add": {
        const result = (
          await roots.saveRoot({ ...deps, mode: "add", body: input })
        ).json;
        ensureWatch();
        emit({ event: "library-changed", payload: { reason: "roots.add" } });
        return result;
      }
      case "roots.update": {
        const { id, ...body } = input;
        const result = (
          await roots.saveRoot({
            ...deps,
            mode: "patch",
            id,
            body,
          })
        ).json;
        ensureWatch();
        emit({ event: "library-changed", payload: { reason: "roots.update" } });
        return result;
      }
      case "roots.remove": {
        const result = (await roots.removeRoot({ ...deps, id: input.id })).json;
        ensureWatch();
        emit({ event: "library-changed", payload: { reason: "roots.remove" } });
        return result;
      }
      case "roots.order": {
        const result = (await roots.orderRoots({ ...deps, ids: input.ids })).json;
        ensureWatch();
        emit({ event: "library-changed", payload: { reason: "roots.order" } });
        return result;
      }
      case "roots.rescan": {
        const result = roots.scanRoot({
          ...deps,
          id: input.id,
          full: input.full,
        }).json;
        ensureWatch();
        return result;
      }
      case "roots.series":
        return roots.listSeries({ ...deps, id: input.id }).json;
      case "scan.all": {
        const result = roots.scanAll({ ...deps, full: input.full }).json;
        ensureWatch();
        return result;
      }
      case "scan.status":
        return roots.scanStatus({ library }).json;
      case "items.search":
        return items.search({ library, query: input.query }).json;
      case "items.get":
        return items.getItem({ library, id: input.id }).json;
      case "items.trash": {
        const result = (
          await items.trashItem({
            library,
            cache,
            id: input.id,
            confirm: input.confirm,
          })
        ).json;
        emit({ event: "library-changed", payload: { reason: "items.trash" } });
        return result;
      }
      case "items.document":
        return presentBytes(
          await items.readDocument({
            library,
            cache,
            id: input.id,
            action: "document",
            ifNoneMatch: input.ifNoneMatch,
          }),
        );
      case "items.original":
        return presentBytes(
          await items.readDocument({
            library,
            cache,
            id: input.id,
            action: "original",
            ifNoneMatch: input.ifNoneMatch,
          }),
        );
      case "items.source":
        return presentBytes(
          await items.readItemFile({
            library,
            id: input.id,
            format: input.format,
            action: "source",
          }),
        );
      case "items.download":
        return presentBytes(
          await items.readItemFile({
            library,
            id: input.id,
            format: input.format,
            action: "download",
          }),
        );
      case "items.asset":
        return presentBytes(
          await items.readAsset({
            library,
            registry,
            id: input.id,
            assetPath: input.path,
          }),
        );
      case "system.clearCache": {
        const result = (await items.clearCache({ cache })).json;
        emit({ event: "library-changed", payload: { reason: "cache.clear" } });
        return result;
      }
      case "system.chooseFolder":
        if (!chooseDirectory)
          throw failure("DESKTOP_ONLY", "文件夹选择只在桌面主进程执行");
        return (await system.chooseFolder({ chooseDirectory })).json;
      case "system.reveal":
        return (
          await system.reveal({
            body: input.body,
            registry,
            library,
            systemExecFile,
          })
        ).json;
      case "system.openTrash":
        return (
          await system.reveal({
            body: { trash: true },
            registry,
            library,
            systemExecFile,
          })
        ).json;
      default:
        throw failure("METHOD_NOT_ALLOWED", "方法不在白名单内");
    }
  }

  return {
    call,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      closed = true;
      if (timer) clearInterval(timer);
      timer = null;
      await library.scheduler.waitForIdle();
    },
    library,
  };
}

export async function handleWorkerEnvelope(host, message) {
  const id = message && typeof message.id === "string" ? message.id : null;
  if (!id || typeof message.method !== "string")
    return {
      id,
      ok: false,
      error: { code: "INVALID_MESSAGE", message: "请求无效", details: {} },
    };
  try {
    const result = await host.call(message.method, message.params);
    return { id, ok: true, result: cloneBytes(result) };
  } catch (error) {
    return {
      id,
      ok: false,
      error: {
        code: error.code || "INTERNAL_ERROR",
        message: error.message || "内部错误",
        details: error.details || {},
      },
    };
  }
}

function cloneBytes(result) {
  if (!result || !Buffer.isBuffer(result.body)) return result;
  return { ...result, body: new Uint8Array(result.body) };
}
