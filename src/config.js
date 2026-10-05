import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const failure = (code, message) => Object.assign(new Error(message), { code });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const empty = () => ({ version: 2, roots: [], ui: {} });
function normalize(input) {
  if (!object(input) || !Array.isArray(input.roots) || input.roots.some(root => !object(root) || typeof root.path !== 'string' || !root.path.trim())) {
    throw failure('CONFIG_INVALID', '配置文件不是有效的目录配置');
  }
  const now = new Date().toISOString();
  return { ...input, version: input.version > 2 ? input.version : 2, ui: object(input.ui) ? input.ui : {}, roots: input.roots.map((root, order) => {
    const rootPath = path.resolve(root.path.trim());
    return { ...root, id: root.id || 'root-' + createHash('sha1').update(rootPath).digest('hex').slice(0, 12), path: rootPath,
      label: root.label?.trim() || path.basename(rootPath) || rootPath, order, enabled: root.enabled !== false,
      addedAt: root.addedAt || now, updatedAt: root.updatedAt || root.addedAt || now,
      options: { series: 'auto', ...(object(root.options) ? root.options : {}) } };
  }) };
}

export function createConfigStore({ dataDir = path.join(os.homedir(), '.html-library') } = {}) {
  const configPath = path.join(dataDir, 'config.json');
  let loaded, loading, legacyBytes, queue = Promise.resolve();
  async function read() {
    let bytes;
    try { bytes = await readFile(configPath, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return { config: empty(), readOnly: false, startupWarning: '', legacyRootIds: [] }; throw error; }
    try {
      const input = JSON.parse(bytes), config = normalize(input), legacy = !input.version || input.version === 1;
      if (legacy) legacyBytes = bytes;
      return { config, readOnly: input.version > 2, startupWarning: input.version > 2 ? '配置版本较新，当前以只读模式打开' : '', legacyRootIds: legacy ? config.roots.map(root => root.id) : [] };
    } catch (error) {
      if (!(error instanceof SyntaxError) && error.code !== 'CONFIG_INVALID') throw error;
      await rename(configPath, path.join(dataDir, 'config.broken-' + new Date().toISOString().replace(/:/g, '-') + '.json'));
      return { config: empty(), readOnly: false, startupWarning: '配置文件损坏，已备份原文件。请重新添加目录。', legacyRootIds: [] };
    }
  }
  async function load() { if (!loaded) { loading ||= read().then(result => { loaded = result; return result; }); await loading; } return structuredClone(loaded); }
  function update(mutator) {
    const operation = queue.then(async () => {
      await load();
      if (loaded.readOnly) throw failure('CONFIG_READ_ONLY', '配置版本较新，无法修改');
      const draft = structuredClone(loaded.config), result = await mutator(draft);
      let config = normalize(result === undefined ? draft : result);
      // Preserve extension fields written by another client without reviving removed roots.
      try {
        const latest = JSON.parse(await readFile(configPath, 'utf8'));
        if (latest.version > 2) { loaded.readOnly = true; throw failure('CONFIG_READ_ONLY', '配置版本较新，无法修改'); }
        const oldRoots = new Map((latest.roots || []).map(root => [root.id, root]));
        config = { ...latest, ...config, roots: config.roots.map(root => ({ ...oldRoots.get(root.id), ...root, options: { ...oldRoots.get(root.id)?.options, ...root.options } })) };
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await mkdir(dataDir, { recursive: true });
      if (legacyBytes !== undefined) {
        try { await writeFile(path.join(dataDir, 'config.v1.bak.json'), legacyBytes, { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      const temporary = configPath + '.tmp-' + randomUUID();
      try { await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 }); await rename(temporary, configPath); }
      catch (error) { await rm(temporary, { force: true }); throw error; }
      loaded = { ...loaded, config };
      return structuredClone(loaded);
    });
    queue = operation.catch(() => {});
    return operation;
  }
  return { load, update, dataDir };
}
