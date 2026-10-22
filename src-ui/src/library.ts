export const PREVIEW_DELAY_MS = 300;
export const SERIES_PREVIEW_COUNT = 12;

const HEALTHY_STATUS = new Set(["ok", "warning", "scanning", "disabled"]);

export type Issue = { path: string; message: string };
export type ScanFiles = { done: number; total: number };
export type RunningScan = { rootId: string; files: ScanFiles };
export type QueuedScan = { rootId: string; position: number };
export type ScanStatus = { running: RunningScan[]; queued: QueuedScan[] };

export type RootState = {
  status: string;
  message: string | null;
  excludes: string[];
  lastScan: { completedAt?: string; files?: number; items?: number } | null;
  issues: Issue[];
};

export type RootCounts = {
  items: number;
  files: number;
  series: number;
  html: number;
  mhtml: number;
  markdown: number;
};

export type RootRecord = {
  id: string;
  label: string;
  path: string;
  displayPath: string;
  enabled: boolean;
  options: { series: "auto" | "off" };
  counts: RootCounts;
  state: RootState;
};

export type LibrarySnapshot = {
  roots: RootRecord[];
  totals: { items: number; available: number };
  readOnly: boolean;
  startupWarning: string;
};

export type SeriesEntry = { key: string; name: string; total: number };

export type PreflightError = { code?: string; message: string };
export type AffectedSeries = { name: string; count: number };
export type Preflight = {
  valid: boolean;
  path?: string;
  label?: string;
  counts?: { files: number; items: number };
  errors: PreflightError[];
  duplicateLabel: boolean;
  overlap: null | {
    message?: string;
    moved?: number;
    parentAfter?: number | null;
    parentId?: string | null;
    parentLabel?: string;
    affectedSeries?: AffectedSeries[];
    children?: { id: string; label?: string }[];
  };
};

export type Selection =
  | { kind: "all" }
  | { kind: "root"; rootId: string }
  | { kind: "series"; rootId: string; seriesKey: string };

export type MenuEntry =
  | { kind: "item"; id: string; label: string; disabled?: boolean; danger?: boolean }
  | { kind: "separator" };

export type PreviewSource = { path: string; label?: string; excludeId?: string };

const emptyCounts = (): RootCounts => ({
  items: 0,
  files: 0,
  series: 0,
  html: 0,
  mhtml: 0,
  markdown: 0,
});

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function errorMessage(error: unknown, fallback = "操作失败") {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

export function labelError(input: string) {
  const label = input.trim();
  if (!label) return null;
  if ([...label].length > 40) return "目录名称需为 1–40 个字符";
  return null;
}

export function isUnavailableStatus(status: string) {
  return !HEALTHY_STATUS.has(status);
}

export function statusLabel(status: string, message: string | null) {
  if (status === "ok") return "正常";
  if (status === "disabled") return "已停用";
  if (status === "missing") return "目录不存在";
  if (status === "denied") return "无权限";
  if (status === "not_directory") return "不是文件夹";
  if (status === "scanning") return "扫描中";
  if (status === "warning") return message || "有扫描问题";
  return message || "扫描失败";
}

export function isScanActive(scan: ScanStatus) {
  return scan.running.length > 0 || scan.queued.length > 0;
}

export function countIssues(roots: RootRecord[]) {
  return roots.reduce((total, root) => total + root.state.issues.length, 0);
}

export function formatDate(value?: string | null) {
  if (!value) return "未扫描";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未扫描";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
  }).format(date);
}

export function latestScan(roots: RootRecord[]) {
  return roots
    .map((root) => root.state.lastScan?.completedAt)
    .filter((value): value is string => !!value)
    .sort()
    .at(-1);
}

export function sortSeries(series: SeriesEntry[]) {
  return [...series].sort((left, right) =>
    left.name.localeCompare(right.name, "zh-CN", { numeric: true }),
  );
}

export function preflightFingerprint(value: Preflight | null) {
  if (!value) return "null";
  const overlap = value.overlap;
  return JSON.stringify([
    value.valid,
    value.path ?? null,
    value.label ?? null,
    value.counts ? [value.counts.files, value.counts.items] : null,
    value.errors.map((item) => [item.code ?? null, item.message]),
    value.duplicateLabel,
    overlap
      ? [
          overlap.message ?? null,
          overlap.moved ?? null,
          overlap.parentAfter ?? null,
          overlap.parentId || null,
          overlap.parentLabel || null,
          (overlap.affectedSeries ?? []).map((item) => [item.name, item.count]),
          (overlap.children ?? []).map((item) => [item.id, item.label || null]),
        ]
      : null,
  ]);
}

export function reorderIds(ids: string[], sourceId: string, targetId: string) {
  const from = ids.indexOf(sourceId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return null;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, sourceId);
  return next;
}

export function moveAdjacent(ids: string[], id: string, direction: -1 | 1) {
  const index = ids.indexOf(id);
  if (index < 0) return null;
  const target = ids[index + direction];
  if (!target) return null;
  return reorderIds(ids, id, target);
}

export function selectionLabel(selection: Selection, roots: RootRecord[], seriesName = "") {
  if (selection.kind === "all") return "全部来源";
  const root = roots.find((item) => item.id === selection.rootId);
  if (selection.kind === "series") return seriesName || root?.label || "系列";
  return root?.label || "来源";
}

export function sidebarActions(root: RootRecord, readOnly: boolean, busy: boolean): MenuEntry[] {
  const items: MenuEntry[] = [
    { kind: "item", id: "rescan", label: "重扫此目录", disabled: busy },
    { kind: "item", id: "rename", label: "重命名", disabled: readOnly },
    { kind: "item", id: "reveal", label: "在访达中显示" },
  ];
  if (isUnavailableStatus(root.state.status)) {
    items.push({ kind: "item", id: "relocate", label: "重新定位…", disabled: readOnly });
  }
  items.push(
    { kind: "item", id: "enabled", label: root.enabled ? "停用" : "启用", disabled: readOnly },
    { kind: "item", id: "remove", label: "移除…", danger: true, disabled: readOnly },
  );
  return items;
}

export function managerActions(root: RootRecord, readOnly: boolean, busy: boolean): MenuEntry[] {
  return [
    { kind: "item", id: "rescan", label: "增量重扫", disabled: busy },
    { kind: "item", id: "rescan-full", label: "全量重扫", disabled: busy },
    { kind: "item", id: "relocate", label: "重新定位…", disabled: readOnly },
    { kind: "item", id: "enabled", label: root.enabled ? "停用" : "启用", disabled: readOnly },
    {
      kind: "item",
      id: "series",
      label: root.options.series === "off" ? "启用系列识别" : "关闭系列识别",
      disabled: readOnly,
    },
    { kind: "item", id: "reveal", label: "在访达中显示" },
    { kind: "separator" },
    { kind: "item", id: "remove", label: "移除…", danger: true, disabled: readOnly },
  ];
}

function parseIssues(value: unknown): Issue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((issue) => {
    const record = objectRecord(issue);
    if (!record || typeof record.path !== "string" || typeof record.message !== "string") return [];
    return [{ path: record.path, message: record.message }];
  });
}

function parseState(value: unknown): RootState {
  if (typeof value === "string") {
    return { status: value, message: null, excludes: [], lastScan: null, issues: [] };
  }
  const record = objectRecord(value);
  const lastScan = objectRecord(record?.lastScan);
  return {
    status: text(record?.status) || "ok",
    message: typeof record?.message === "string" ? record.message : null,
    excludes: Array.isArray(record?.excludes)
      ? record.excludes.filter((item): item is string => typeof item === "string")
      : [],
    lastScan: lastScan
      ? {
          completedAt: typeof lastScan.completedAt === "string" ? lastScan.completedAt : undefined,
          files: finiteNumber(lastScan.files),
          items: finiteNumber(lastScan.items),
        }
      : null,
    issues: parseIssues(record?.issues),
  };
}

function parseRoot(value: unknown): RootRecord | null {
  const record = objectRecord(value);
  if (!record || typeof record.id !== "string" || typeof record.label !== "string") return null;
  const path = text(record.path);
  const counts = objectRecord(record.counts);
  const options = objectRecord(record.options);
  return {
    id: record.id,
    label: record.label,
    path,
    displayPath: text(record.displayPath) || path,
    enabled: record.enabled !== false,
    options: { series: options?.series === "off" ? "off" : "auto" },
    counts: {
      ...emptyCounts(),
      items: finiteNumber(counts?.items),
      files: finiteNumber(counts?.files),
      series: finiteNumber(counts?.series),
      html: finiteNumber(counts?.html),
      mhtml: finiteNumber(counts?.mhtml),
      markdown: finiteNumber(counts?.markdown),
    },
    state: parseState(record.state),
  };
}

export function parseLibrary(value: unknown): LibrarySnapshot | null {
  const record = objectRecord(value);
  if (!record || !Array.isArray(record.roots)) return null;
  const roots: RootRecord[] = [];
  for (const item of record.roots) {
    const root = parseRoot(item);
    if (!root) return null;
    roots.push(root);
  }
  const totals = objectRecord(record.totals);
  return {
    roots,
    totals: {
      items: finiteNumber(totals?.items),
      available: finiteNumber(totals?.available),
    },
    readOnly: record.readOnly === true,
    startupWarning: text(record.startupWarning),
  };
}

export function parseScan(value: unknown): ScanStatus {
  const record = objectRecord(value);
  const running = Array.isArray(record?.running)
    ? record.running.flatMap((item) => {
        const entry = objectRecord(item);
        const files = objectRecord(entry?.files);
        if (!entry || typeof entry.rootId !== "string" || !files) return [];
        return [{ rootId: entry.rootId, files: { done: finiteNumber(files.done), total: finiteNumber(files.total) } }];
      })
    : [];
  const queued = Array.isArray(record?.queued)
    ? record.queued.flatMap((item) => {
        const entry = objectRecord(item);
        if (!entry || typeof entry.rootId !== "string") return [];
        return [{ rootId: entry.rootId, position: finiteNumber(entry.position) }];
      })
    : [];
  return { running, queued };
}

export function parseSeries(value: unknown): SeriesEntry[] {
  const record = objectRecord(value);
  if (!record || !Array.isArray(record.series)) return [];
  return record.series.flatMap((item) => {
    const entry = objectRecord(item);
    if (!entry || typeof entry.key !== "string" || typeof entry.name !== "string") return [];
    return [{ key: entry.key, name: entry.name, total: finiteNumber(entry.total) }];
  });
}

function parseErrors(value: unknown): PreflightError[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = objectRecord(item);
    if (!record || typeof record.message !== "string") return [];
    return [{ code: typeof record.code === "string" ? record.code : undefined, message: record.message }];
  });
}

export function parsePreflight(value: unknown): Preflight | null {
  const record = objectRecord(value);
  if (!record || typeof record.valid !== "boolean") return null;
  const counts = objectRecord(record.counts);
  const overlap = objectRecord(record.overlap);
  const affected = Array.isArray(overlap?.affectedSeries)
    ? overlap.affectedSeries.flatMap((item) => {
        const entry = objectRecord(item);
        if (!entry || typeof entry.name !== "string") return [];
        return [{ name: entry.name, count: finiteNumber(entry.count) }];
      })
    : [];
  const children = Array.isArray(overlap?.children)
    ? overlap.children.flatMap((item) => {
        const entry = objectRecord(item);
        if (!entry || typeof entry.id !== "string") return [];
        return [{ id: entry.id, label: typeof entry.label === "string" ? entry.label : undefined }];
      })
    : [];
  return {
    valid: record.valid,
    path: typeof record.path === "string" ? record.path : undefined,
    label: typeof record.label === "string" ? record.label : undefined,
    counts: counts
      ? { files: finiteNumber(counts.files), items: finiteNumber(counts.items) }
      : undefined,
    errors: parseErrors(record.errors).length ? parseErrors(record.errors) : parseErrors(record.checks),
    duplicateLabel: record.duplicateLabel === true,
    overlap: overlap
      ? {
          message: typeof overlap.message === "string" ? overlap.message : undefined,
          moved: overlap.moved === undefined ? undefined : finiteNumber(overlap.moved),
          parentAfter:
            overlap.parentAfter === null || overlap.parentAfter === undefined
              ? (overlap.parentAfter as null | undefined)
              : finiteNumber(overlap.parentAfter),
          parentId: typeof overlap.parentId === "string" ? overlap.parentId : null,
          parentLabel: typeof overlap.parentLabel === "string" ? overlap.parentLabel : undefined,
          affectedSeries: affected,
          children,
        }
      : null,
  };
}

export function progressFor(scan: ScanStatus, rootId: string) {
  return scan.running.find((item) => item.rootId === rootId) || null;
}

export function queuedFor(scan: ScanStatus, rootId: string) {
  return scan.queued.some((item) => item.rootId === rootId);
}

export function previewParams(source: PreviewSource) {
  return {
    path: source.path,
    ...(source.label ? { label: source.label } : {}),
    ...(source.excludeId ? { excludeId: source.excludeId } : {}),
  };
}
