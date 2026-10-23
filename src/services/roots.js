import os from "node:os";
import { contains, rootAvailable } from "../roots.js";

const jsonResult = (status, json) => ({ status, json });

export function assertKnownRoot({ registry, id }) {
  if (!registry.get(id))
    throw Object.assign(new Error("目录不存在"), { code: "ROOT_NOT_FOUND" });
}

export function rootResponse(root, library) {
  if (!root) return null;
  const items = library
    .getSnapshot()
    .items.filter((item) => item.rootId === root.id);
  return {
    ...root,
    displayPath: root.path.startsWith(os.homedir() + "/")
      ? "~" + root.path.slice(os.homedir().length)
      : root.path,
    counts: {
      items: items.length,
      files: library
        .getSnapshot()
        .items.filter((item) => item.rootId === root.id)
        .reduce((count, item) => count + item.sourceFiles.length, 0),
      series: root.counts?.series || 0,
      html: items.filter((item) => item.html).length,
      mhtml: items.filter((item) => item.mhtml).length,
      markdown: items.filter((item) => item.markdown).length,
    },
    state: {
      status: root.state,
      message: root.message || null,
      excludes: root.excludes,
      lastScan: root.lastScan || null,
      issues: root.issues || [],
    },
  };
}

function previewResponse(preview, registry, library) {
  const parent =
    preview.overlap?.parentId && registry.get(preview.overlap.parentId);
  const snapshot = library.getSnapshot();
  const affectedSeries = parent
    ? snapshot.series
        .filter(
          (series) =>
            series.rootId === parent.id &&
            series.itemIds.some((id) =>
              snapshot.items
                .find((item) => item.id === id)
                ?.sourceFiles.some((source) =>
                  contains(preview.path, source.path, parent.caseSensitive),
                ),
            ),
        )
        .map((series) => ({ name: series.name, count: series.itemIds.length }))
    : [];
  return {
    ...preview,
    errors: preview.checks,
    checks: {
      exists: !preview.checks.some((check) => check.code === "ROOT_MISSING"),
      isDirectory: !preview.checks.some(
        (check) => check.code === "ROOT_NOT_DIRECTORY",
      ),
      readable: preview.valid,
      indexable: {
        total: preview.counts?.files || 0,
        items: preview.counts?.items || 0,
      },
    },
    duplicateOf: preview.duplicateOf
      ? {
          id: preview.duplicateOf,
          label: registry.get(preview.duplicateOf)?.label,
        }
      : null,
    overlap: preview.overlap
      ? {
          ...preview.overlap,
          type: parent ? "child_of" : "parent_of",
          parent: parent ? { id: parent.id, label: parent.label } : null,
          parentBefore: parent?.counts?.items || 0,
          affectedSeries,
          children: preview.overlap.childIds.map((id) => ({
            id,
            label: registry.get(id)?.label,
            kept: registry.get(id)?.counts?.items || 0,
          })),
        }
      : null,
  };
}

function enqueueAffected(library, affected) {
  affected.forEach((entry) => library.scheduler.enqueue(entry.rootId, entry));
}

export function listRoots({ library, registry }) {
  const roots = registry.list().map((root) => rootResponse(root, library)),
    config = registry.getConfigLoad();
  return jsonResult(200, {
    roots,
    totals: {
      items: library.getSnapshot().items.length,
      available: registry.list().filter(rootAvailable).length,
    },
    readOnly: !!config?.readOnly,
    startupWarning: config?.startupWarning || "",
  });
}

export function scanStatus({ library }) {
  return jsonResult(200, library.scheduler.status());
}

export function scanAll({ library, registry, full }) {
  const queued = registry.list().map((root) => {
    library.scheduler.enqueue(root.id, { full });
    return root.id;
  });
  return jsonResult(202, { queued });
}

export async function orderRoots({ library, registry, ids }) {
  const result = await registry.applyChange({ type: "order", ids });
  enqueueAffected(library, result.affected);
  return jsonResult(200, {
    roots: registry.list().map((root) => rootResponse(root, library)),
    scan: { queued: result.affected.map((entry) => entry.rootId) },
  });
}

export function scanRoot({ library, registry, id, full }) {
  assertKnownRoot({ registry, id });
  return jsonResult(
    202,
    library.scheduler.enqueue(id, { full }),
  );
}

export function listSeries({ library, registry, id }) {
  assertKnownRoot({ registry, id });
  return jsonResult(200, {
    series: library
      .getSnapshot()
      .series.filter((series) => series.rootId === id),
  });
}

export async function saveRoot({
  library,
  registry,
  mode,
  id,
  body,
  dryRun = false,
}) {
  if (mode === "patch") assertKnownRoot({ registry, id });
  const input =
    mode === "patch"
      ? {
          ...body,
          path: body.path ?? registry.get(id).path,
          label: body.label ?? registry.get(id).label,
        }
      : body;
  if (dryRun)
    return jsonResult(
      200,
      previewResponse(
        await registry.preview(input, { excludeId: id }),
        registry,
        library,
      ),
    );
  const result = await registry.applyChange({
    type: mode === "patch" ? "patch" : "add",
    id,
    input: mode === "patch" ? body : input,
  });
  enqueueAffected(library, result.affected);
  if (body.options?.series && library.recomputeMetadata)
    library.recomputeMetadata(id);
  return jsonResult(mode === "add" ? 201 : 200, {
    root: rootResponse(result.root, library),
    scan: { queued: result.affected.map((entry) => entry.rootId) },
  });
}

export async function removeRoot({ library, registry, id }) {
  assertKnownRoot({ registry, id });
  const result = await registry.applyChange({ type: "remove", id });
  enqueueAffected(library, result.affected);
  return jsonResult(200, {
    removed: id,
    scan: { queued: result.affected.map((entry) => entry.rootId) },
  });
}
