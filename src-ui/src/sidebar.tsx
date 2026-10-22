import { useEffect, useRef, useState } from "react";
import { Icon } from "./components/icons";
import { Menu } from "./components/menu";
import { useLibrary } from "./library-context";
import {
  SERIES_PREVIEW_COUNT,
  errorMessage,
  formatDate,
  isUnavailableStatus,
  latestScan,
  parseSeries,
  progressFor,
  queuedFor,
  sidebarActions,
  sortSeries,
  statusLabel,
  type RootRecord,
  type SeriesEntry,
} from "./library";

export function Sidebar() {
  const library = useLibrary();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [more, setMore] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ rootId: string; x: number; y: number; returnFocus: HTMLElement | null } | null>(
    null,
  );
  const { roots } = library.snapshot;
  const selectionKey =
    library.selection.kind === "all"
      ? "all"
      : library.selection.kind === "root"
        ? "root:" + library.selection.rootId
        : "series:" + library.selection.rootId + ":" + library.selection.seriesKey;

  useEffect(() => {
    setMenu(null);
  }, [selectionKey]);

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runAction(root: RootRecord, id: string) {
    try {
      if (id === "rescan") await library.rescan(root.id);
      else if (id === "rename") setEditingId(root.id);
      else if (id === "reveal") await library.revealRoot(root.id);
      else if (id === "relocate") library.openManager({ relocateId: root.id });
      else if (id === "enabled") await library.updateRoot(root.id, { enabled: !root.enabled });
      else if (id === "remove") {
        const accepted = await library.confirm({
          title: "移除来源目录？",
          message: "将取消“" + root.label + "”的索引。源文件保留在 " + root.path + "。",
          confirmLabel: "移除",
          danger: true,
        });
        if (accepted) await library.removeRoot(root.id);
      }
    } catch (error) {
      library.toast(errorMessage(error), true);
    }
  }

  function openMenu(root: RootRecord, anchor: HTMLElement, point?: { x: number; y: number }) {
    const rect = anchor.getBoundingClientRect();
    setMenu({
      rootId: root.id,
      x: point?.x ?? rect.left,
      y: point?.y ?? rect.bottom,
      returnFocus: anchor,
    });
  }

  const menuRoot = menu ? roots.find((root) => root.id === menu.rootId) : null;
  const fileTotal = roots.reduce((total, root) => total + root.counts.files, 0);

  return (
    <>
      <div className="pane-body">
        <button
          type="button"
          className="nav-button all-roots"
          aria-current={library.selection.kind === "all" ? "page" : undefined}
          onClick={library.selectAll}
        >
          <Icon name="library" />
          <span className="root-copy">
            <span className="root-name">全部来源</span>
            <span className="root-meta">
              <span>可用 {library.snapshot.totals.items}</span>
              <span>扫描 {fileTotal}</span>
            </span>
          </span>
        </button>
        <div className="source-heading">
          <span>来源目录</span>
          <button type="button" className="text-button" data-open-manager="" onClick={() => library.openManager()}>
            管理
          </button>
        </div>
        {!library.loaded && !library.error ? (
          <p className="status-line" role="status">
            正在读取来源…
          </p>
        ) : null}
        {library.error ? (
          <p className="status-line" role="alert">
            {library.error}
          </p>
        ) : null}
        {library.loaded && !library.error && roots.length === 0 ? (
          <p className="status-line">还没有来源目录</p>
        ) : null}
        {roots.map((root) => {
          const selected = library.selection.kind !== "all" && library.selection.rootId === root.id;
          const open = selected || expanded.has(root.id);
          const progress = progressFor(library.scan, root.id);
          const status = root.state.status;
          return (
            <div
              key={root.id}
              className={"root-block" + (selected ? " active" : "")}
              data-root-id={root.id}
              onContextMenu={(event) => {
                event.preventDefault();
                const anchor = event.currentTarget.querySelector<HTMLElement>(".root-more");
                if (anchor) openMenu(root, anchor, { x: event.clientX, y: event.clientY });
              }}
            >
              <div className="root-row">
                <button
                  type="button"
                  className="icon-button chevron"
                  aria-label={(open ? "收起 " : "展开 ") + root.label}
                  title={(open ? "收起 " : "展开 ") + root.label}
                  aria-expanded={open}
                  onClick={() => toggleExpanded(root.id)}
                >
                  <Icon name="chevron" />
                </button>
                {editingId === root.id ? (
                  <RenameField
                    initial={root.label}
                    onCommit={async (value) => {
                      await library.updateRoot(root.id, { label: value });
                    }}
                    onError={(message) => library.toast(message, true)}
                    onDone={() => setEditingId(null)}
                  />
                ) : (
                  <button
                    type="button"
                    className="nav-button root-nav"
                    aria-current={selected && library.selection.kind === "root" ? "page" : undefined}
                    title={root.path + (root.state.message ? "\n" + root.state.message : "")}
                    onClick={() => library.selectRoot(root.id)}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (!library.snapshot.readOnly) setEditingId(root.id);
                    }}
                  >
                    <Icon name="folder" />
                    <span className="root-copy">
                      <span className="root-title">
                        <span className="status-dot" data-status={status} aria-hidden="true" />
                        <span className="root-name">{root.label}</span>
                      </span>
                      <span className="root-path">{root.displayPath}</span>
                      <span className="root-meta">
                        <span className="status-caption" data-status={status}>
                          {statusLabel(status, root.state.message)}
                        </span>
                        {progress ? (
                          <span data-scan-progress={progress.files.done + "/" + progress.files.total}>
                            扫描中 {progress.files.done}/{progress.files.total}
                          </span>
                        ) : (
                          <span>扫描 {root.counts.files}</span>
                        )}
                        <span>可用 {root.counts.items}</span>
                        {queuedFor(library.scan, root.id) && !progress ? <span>排队中</span> : null}
                      </span>
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  className="icon-button root-more"
                  aria-label={root.label + "操作"}
                  aria-haspopup="menu"
                  aria-expanded={menu?.rootId === root.id}
                  title={root.label + "操作"}
                  onClick={(event) => openMenu(root, event.currentTarget)}
                >
                  <Icon name="more" />
                </button>
              </div>
              {open && root.enabled && !isUnavailableStatus(status) ? (
                <SeriesList
                  rootId={root.id}
                  expanded={more.has(root.id)}
                  selectedKey={library.selection.kind === "series" ? library.selection.seriesKey : ""}
                  onSelect={(key, name) => library.selectSeries(root.id, key, name)}
                  onMore={() => setMore((current) => new Set(current).add(root.id))}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <footer className="sidebar-footer">
        <button type="button" className="add-source" onClick={() => library.openManager({ focusAdd: true })}>
          ＋ 添加目录
        </button>
        <div className="sidebar-bottom">
          <button type="button" className="text-button" onClick={() => library.openManager()}>
            ⚙ 设置
          </button>
          <button
            type="button"
            className="text-button"
            disabled={library.busy}
            onClick={() => void library.rescan().catch((error) => library.toast(errorMessage(error), true))}
          >
            ↻ 全部重扫
          </button>
          <span className="last-scanned">{library.busy ? "扫描中" : "上次 " + formatDate(latestScan(roots))}</span>
        </div>
      </footer>
      {menu && menuRoot ? (
        <Menu
          items={sidebarActions(menuRoot, library.snapshot.readOnly, library.busy)}
          x={menu.x}
          y={menu.y}
          returnFocus={menu.returnFocus}
          onClose={() => setMenu(null)}
          onSelect={(id) => void runAction(menuRoot, id)}
        />
      ) : null}
    </>
  );
}

function SeriesList({
  rootId,
  expanded,
  selectedKey,
  onSelect,
  onMore,
}: {
  rootId: string;
  expanded: boolean;
  selectedKey: string;
  onSelect: (key: string, name: string) => void;
  onMore: () => void;
}) {
  const { catalogEpoch, toast } = useLibrary();
  const [entries, setEntries] = useState<SeriesEntry[] | null>(null);

  useEffect(() => {
    const api = window.pageshelf;
    if (!api) return;
    let cancelled = false;
    void api
      .invoke("roots.series", { id: rootId })
      .then((result) => {
        if (!cancelled) setEntries(sortSeries(parseSeries(result)));
      })
      .catch((error: unknown) => {
        if (!cancelled) toast(errorMessage(error), true);
      });
    return () => {
      cancelled = true;
    };
  }, [catalogEpoch, rootId, toast]);

  const visible = entries ? (expanded ? entries : entries.slice(0, SERIES_PREVIEW_COUNT)) : [];
  return (
    <div className="series-list">
      {entries === null ? (
        <p className="status-line" role="status">
          正在读取系列…
        </p>
      ) : null}
      {visible.map((entry) => (
        <button
          key={entry.key}
          type="button"
          className="nav-button series-link"
          data-series-key={entry.key}
          aria-current={selectedKey === entry.key ? "page" : undefined}
          onClick={() => onSelect(entry.key, entry.name)}
        >
          <Icon name="series" />
          <span className="root-name">{entry.name}</span>
          <span className="root-count">{entry.total}</span>
        </button>
      ))}
      {entries && entries.length > SERIES_PREVIEW_COUNT && !expanded ? (
        <button type="button" className="text-button" onClick={onMore}>
          更多 {entries.length - SERIES_PREVIEW_COUNT} 个
        </button>
      ) : null}
    </div>
  );
}

function RenameField({
  initial,
  onCommit,
  onError,
  onDone,
}: {
  initial: string;
  onCommit: (value: string) => Promise<void>;
  onError: (message: string) => void;
  onDone: () => void;
}) {
  const [node, setNode] = useState<HTMLInputElement | null>(null);
  const done = useRef(false);

  useEffect(() => {
    node?.focus();
    node?.select();
  }, [node]);

  async function finish(save: boolean) {
    if (done.current) return;
    done.current = true;
    try {
      if (save && node && node.value !== initial) await onCommit(node.value);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      onDone();
    }
  }

  return (
    <input
      ref={setNode}
      className="field inline-label"
      aria-label="目录名称"
      defaultValue={initial}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void finish(true);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          void finish(false);
        }
      }}
      onBlur={() => void finish(true)}
    />
  );
}
