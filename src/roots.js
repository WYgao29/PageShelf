import { access, realpath, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export const EXTENSIONS = new Set(['.html', '.htm', '.mhtml', '.mht', '.md']);
export const rootAvailable = root => root.enabled !== false && ['ok', 'warning', 'scanning'].includes(root.state);
const fail = (code, message, details = {}) => Object.assign(new Error(message), { code, details });
export function contains(parent, child, caseSensitive = true) {
  if (!caseSensitive) { parent = parent.toLowerCase(); child = child.toLowerCase(); }
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}
async function inspectPath(input) {
  try {
    const canonical = await realpath(input), info = await stat(canonical);
    if (!info.isDirectory()) return { state: 'not_directory', realPath: canonical, message: '路径不是文件夹' };
    await access(canonical, constants.R_OK | constants.X_OK);
    // Probe an existing path component by changing its case, without writing a test file.
    let caseSensitive = true;
    for (let candidate = canonical; candidate !== path.dirname(candidate); candidate = path.dirname(candidate)) {
      const name = path.basename(candidate), alternate = name.replace(/[a-zA-Z]/, c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase());
      if (alternate === name) continue;
      try { const other = await stat(path.join(path.dirname(candidate), alternate)); const original = await stat(candidate); caseSensitive = !(other.dev === original.dev && other.ino === original.ino); } catch (error) { if (error.code !== 'ENOENT') continue; }
      break;
    }
    return { state: 'ok', realPath: canonical, dev: info.dev, caseSensitive };
  } catch (error) { return { state: ['ENOENT', 'ENOTDIR'].includes(error.code) ? 'missing' : ['EACCES', 'EPERM'].includes(error.code) ? 'denied' : 'error', message: ['ENOENT', 'ENOTDIR'].includes(error.code) ? '目录不存在或已被移动' : ['EACCES', 'EPERM'].includes(error.code) ? '目录无读取权限' : '扫描目录失败：' + error.message }; }
}
export async function listSourceFiles(directory, { excludes = [], issues = [], progress } = {}) {
  const files = [];
  async function walk(current) {
    if (excludes.some(exclude => contains(exclude, current))) return;
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch (error) { issues.push({ path: current, code: error.code, message: error.message }); return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(file);
      // Symbolic links are never traversed, including links inside a configured root.
    }
    progress?.(files.length);
  }
  await walk(directory);
  return files;
}
function itemCount(files, rootPath) { return new Set(files.map(file => path.relative(rootPath, file).slice(0, -path.extname(file).length).normalize('NFC'))).size; }
function labelFor(input, rootPath) {
  const label = input === undefined ? path.basename(rootPath) || rootPath : typeof input === 'string' ? input.trim() : '';
  if ([...label].length < 1 || [...label].length > 40) throw fail('INVALID_LABEL', '目录名称需为 1–40 个字符');
  return label;
}
export function createRootRegistry({ configStore, inspectPath: inspect = inspectPath }) {
  let configLoad, roots = [], revisionMap = new Map(), algorithms = new Map(), writeQueue = Promise.resolve();
  function recompute() {
    for (const root of roots) {
      root.excludes = roots.filter(other => other.id !== root.id && rootAvailable(other) && rootAvailable(root) && contains(root.realPath, other.realPath, root.caseSensitive) && root.realPath !== other.realPath)
        .filter(other => !roots.some(middle => middle.id !== root.id && middle.id !== other.id && rootAvailable(middle) && contains(root.realPath, middle.realPath, root.caseSensitive) && contains(middle.realPath, other.realPath, middle.caseSensitive)))
        .map(other => other.realPath);
    }
  }
  async function load() {
    configLoad = await configStore.load();
    roots = await Promise.all(configLoad.config.roots.map(async root => { const inspected = await inspect(root.path); return { ...root, ...inspected, state: root.enabled === false ? 'disabled' : inspected.state, excludes: [], counts: { items: 0, files: 0, series: 0 }, issues: [] }; }));
    for (const id of configLoad.legacyRootIds || []) if (!algorithms.has(id)) algorithms.set(id, 'v1');
    for (const root of roots) { revisionMap.set(root.id, revisionMap.get(root.id) || 0); if (root.options?.idAlgo === 'v1') algorithms.set(root.id, 'v1'); }
    recompute(); return list();
  }
  function list() { return roots.map(root => structuredClone(root)); }
  function get(id) { return roots.find(root => root.id === id); }
  function revision(id) { return revisionMap.get(id) || 0; }
  function invalidate(id) { revisionMap.set(id, revision(id) + 1); }
  function resolveIdAlgorithm(id, { nfcChanges }) { const root = get(id); if (root?.options?.idAlgo === 'v1' || nfcChanges) algorithms.set(id, 'v1'); else algorithms.set(id, 'nfc'); return algorithms.get(id); }
  function idAlgorithm(id) { return algorithms.get(id) || 'nfc'; }
  async function refresh(id) {
    const root = get(id); if (!root) return [];
    const before = new Map(roots.map(root => [root.id, JSON.stringify([root.state, root.excludes])]));
    const inspected = await inspect(root.path); Object.assign(root, inspected, { state: root.enabled === false ? 'disabled' : inspected.state }); recompute();
    const affected = roots.filter(root => before.get(root.id) !== JSON.stringify([root.state, root.excludes])).map(root => ({ rootId: root.id, full: false }));
    affected.forEach(x => invalidate(x.rootId)); return affected;
  }
  function setIndexState(id, values) { const root = get(id); if (root) Object.assign(root, values); }
  async function preview(input = {}, { excludeId } = {}) {
    let resolvedPath, label;
    try { if (typeof input.path !== 'string' || !input.path.trim()) throw fail('ROOT_INVALID', '请输入目录路径'); resolvedPath = path.resolve(input.path.trim()); label = labelFor(input.label, resolvedPath); }
    catch (error) { return { valid: false, checks: [{ code: error.code, message: error.message }], overlap: null }; }
    const inspection = await inspect(resolvedPath);
    const duplicate = roots.find(root => root.id !== excludeId && contains(root.realPath || path.resolve(root.path), inspection.realPath || resolvedPath, root.caseSensitive) && contains(inspection.realPath || resolvedPath, root.realPath || path.resolve(root.path), root.caseSensitive));
    const checks = []; if (inspection.state !== 'ok') checks.push({ code: 'ROOT_' + inspection.state.toUpperCase(), message: inspection.message || '目录不可用' }); if (duplicate) checks.push({ code: 'ROOT_EXISTS', message: '该目录已经添加' });
    const issues = [], descendants = roots.filter(root => root.id !== excludeId && rootAvailable(root) && contains(inspection.realPath || resolvedPath, root.realPath, inspection.caseSensitive));
    const files = inspection.state === 'ok' ? await listSourceFiles(inspection.realPath, { excludes: descendants.map(x => x.realPath), issues }) : [];
    const parents = roots.filter(root => root.id !== excludeId && rootAvailable(root) && contains(root.realPath, inspection.realPath || resolvedPath, root.caseSensitive)).sort((a, b) => b.realPath.length - a.realPath.length);
    const parent = parents[0], moved = parent && !duplicate ? itemCount(files, inspection.realPath) : 0;
    let parentAfter = null;
    if (parent && !duplicate) { const parentFiles = await listSourceFiles(parent.realPath, { excludes: [...parent.excludes.filter(x => x !== inspection.realPath), inspection.realPath] }); parentAfter = itemCount(parentFiles, parent.realPath); }
    return { valid: !checks.length, path: inspection.realPath || resolvedPath, label, checks, duplicateOf: duplicate?.id || null, duplicateLabel: roots.some(root => root.id !== excludeId && root.label === label), counts: { files: files.length, items: itemCount(files, inspection.realPath || resolvedPath) }, issues,
      overlap: parent || descendants.length ? { parentId: parent?.id || null, parentLabel: parent?.label || '', childIds: descendants.map(x => x.id), moved, parentAfter, message: parent ? `${moved} 条资料将归属新目录，父目录剩余 ${parentAfter} 条；系列将重新计算` : '子目录保留独立归属' } : null };
  }
  function applyChange(change) {
    const operation = writeQueue.then(async () => {
      if (!configLoad) await load();
      if (configLoad.readOnly) throw fail('CONFIG_READ_ONLY', '配置版本较新，无法修改');
      const before = new Map(roots.map(root => [root.id, structuredClone(root)]));
      let changedId = change.id, checked;
      if (change.type === 'add' || (change.type === 'patch' && change.input.path !== undefined)) {
        checked = await preview(change.input, { excludeId: change.id });
        if (!checked.valid) throw fail(checked.checks[0].code, checked.checks[0].message, checked);
      }
      if (change.type === 'patch' && !get(change.id) || change.type === 'remove' && !get(change.id)) throw fail('ROOT_NOT_FOUND', '目录不存在');
      if (change.type === 'order' && (!Array.isArray(change.ids) || new Set(change.ids).size !== roots.length || change.ids.length !== roots.length || change.ids.some(id => !get(id)))) throw fail('INVALID_ORDER', '排序必须包含全部目录且不能重复');
      const now = new Date().toISOString();
      configLoad = await configStore.update(config => {
        for (const root of config.roots) { if (algorithms.get(root.id) === 'v1') root.options = { ...root.options, idAlgo: 'v1' }; }
        if (change.type === 'add') { changedId = 'root-' + randomBytes(6).toString('hex'); config.roots.push({ id: changedId, path: checked.path, label: checked.label, enabled: true, addedAt: now, updatedAt: now, options: { series: 'auto' } }); }
        else if (change.type === 'patch') { const root = config.roots.find(x => x.id === change.id), input = change.input;
          if (input.label !== undefined) root.label = labelFor(input.label, root.path);
          if (checked) root.path = checked.path;
          if (input.enabled !== undefined) { if (typeof input.enabled !== 'boolean') throw fail('ROOT_INVALID', 'enabled 必须是布尔值'); root.enabled = input.enabled; }
          if (input.options !== undefined) { if (!input.options || !['auto', 'off'].includes(input.options.series)) throw fail('ROOT_INVALID', '系列模式无效'); root.options = { ...root.options, series: input.options.series }; }
          root.updatedAt = now;
        } else if (change.type === 'remove') config.roots = config.roots.filter(x => x.id !== change.id);
        else if (change.type === 'order') config.roots = change.ids.map(id => config.roots.find(root => root.id === id));
        else throw fail('ROOT_INVALID', '目录操作无效');
      });
      await load();
      const affected = [];
      for (const id of new Set([...before.keys(), ...roots.map(x => x.id)])) {
        const old = before.get(id), root = get(id);
        if (!root || !old || old.path !== root.path || old.enabled !== root.enabled || JSON.stringify(old.excludes) !== JSON.stringify(root.excludes)) {
          invalidate(id);
          if (root) affected.push({ rootId: id, full: !old || old.path !== root.path, subtree: old?.excludes.find(x => !root.excludes.includes(x)) });
        } else {
          Object.assign(root, { counts: old.counts, issues: old.issues, lastScan: old.lastScan });
        }
      }
      return { root: get(changedId) ? structuredClone(get(changedId)) : null, affected };
    });
    writeQueue = operation.catch(() => {}); return operation;
  }
  return { load, list, get, revision, invalidate, preview, applyChange, refresh, setIndexState, resolveIdAlgorithm, idAlgorithm, getConfigLoad: () => structuredClone(configLoad) };
}
