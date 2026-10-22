import { useEffect, useRef, useState } from "react";
import { Dialog } from "./components/dialog";
import { Icon } from "./components/icons";
import { Menu } from "./components/menu";
import { useLibrary } from "./library-context";
import {
  PREVIEW_DELAY_MS,
  errorMessage,
  formatDate,
  labelError,
  managerActions,
  moveAdjacent,
  preflightFingerprint,
  progressFor,
  reorderIds,
  statusLabel,
  type Preflight,
  type PreviewSource,
  type RootRecord,
} from "./library";

const ADD_MISMATCH = "目录内容或归属已变化，请查看更新后的结果，再次点击添加。";

export function Manager() {
  const library = useLibrary();
  const [path, setPath] = useState("");
  const [label, setLabel] = useState("");
  const [relocateId, setRelocateId] = useState<string | null>(null);
  const [issuesId, setIssuesId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ rootId: string; x: number; y: number; returnFocus: HTMLElement | null } | null>(
    null,
  );
  const readOnly = library.snapshot.readOnly;
  const saving = useRef(false);
  const source = path.trim() ? { path: path.trim(), label: label.trim() || undefined } : null;
  const preview = usePreview(source);

  useEffect(() => {
    if (!library.manager) {
      setPath("");
      setLabel("");
      setRelocateId(null);
      setIssuesId(null);
      setMenu(null);
      return;
    }
    if (library.manager.relocateId) setRelocateId(library.manager.relocateId);
  }, [library.manager]);

  if (!library.manager) return null;
  const relocateRoot = library.snapshot.roots.find((root) => root.id === relocateId) || null;
  const issuesRoot = library.snapshot.roots.find((root) => root.id === issuesId) || null;
  const menuRoot = menu ? library.snapshot.roots.find((root) => root.id === menu.rootId) : null;

  async function commitAdd() {
    if (saving.current || !source || !preview.canCommit || readOnly) return;
    saving.current = true;
    try {
      const saved = await preview.reconfirm(ADD_MISMATCH);
      if (!saved) return;
      await library.addRoot(source);
      setPath("");
      setLabel("");
    } catch (error) {
      library.toast(errorMessage(error), true);
    } finally {
      saving.current = false;
    }
  }

  async function runAction(root: RootRecord, id: string) {
    try {
      if (id === "rescan") await library.rescan(root.id, false);
      else if (id === "rescan-full") await library.rescan(root.id, true);
      else if (id === "relocate") setRelocateId(root.id);
      else if (id === "enabled") await library.updateRoot(root.id, { enabled: !root.enabled });
      else if (id === "series") {
        await library.updateRoot(root.id, { options: { series: root.options.series === "off" ? "auto" : "off" } });
      } else if (id === "reveal") await library.revealRoot(root.id);
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

  return (
    <>
      <Dialog
        title="目录管理"
        className="manager"
        onClose={library.closeManager}
        autoFocusSelector={library.manager.focusAdd ? "#root-path" : undefined}
        footer={
          <>
            <button
              type="button"
              onClick={() => void library.openTrash().catch((error) => library.toast(errorMessage(error), true))}
            >
              打开废纸篓
            </button>
            <button
              type="button"
              onClick={() => void library.clearCache().catch((error) => library.toast(errorMessage(error), true))}
            >
              清除缓存
            </button>
            <button type="button" className="button-primary" onClick={library.closeManager}>
              完成
            </button>
          </>
        }
      >
        {library.snapshot.startupWarning ? (
          <p className="manager-warning" role="status">
            {library.snapshot.startupWarning}
          </p>
        ) : null}
        {readOnly ? (
          <p className="manager-warning" role="status">
            当前配置为只读，仍可浏览资料、重扫和清理缓存。
          </p>
        ) : null}
        <div className="manager-intro">
          <p className="muted">管理本地资料来源。父子目录重叠时，资料归属最深的可用目录。</p>
          <button
            type="button"
            data-global-scan=""
            disabled={library.busy}
            onClick={() => void library.rescan(undefined, false).catch((error) => library.toast(errorMessage(error), true))}
          >
            全部重扫
          </button>
          <button
            type="button"
            data-global-scan=""
            disabled={library.busy}
            onClick={() => void library.rescan(undefined, true).catch((error) => library.toast(errorMessage(error), true))}
          >
            全量重扫
          </button>
        </div>
        <div className="manager-table">
          {library.snapshot.roots.length === 0 ? (
            <p className="muted">还没有来源目录。添加保存资料的文件夹即可开始。</p>
          ) : null}
          {library.snapshot.roots.map((root) => (
            <ManagerRow
              key={root.id}
              root={root}
              readOnly={readOnly}
              duplicate={library.snapshot.roots.filter((item) => item.label === root.label).length > 1}
              progress={progressFor(library.scan, root.id)}
              menuOpen={menu?.rootId === root.id}
              onOpenMenu={(anchor) => {
                const rect = anchor.getBoundingClientRect();
                setMenu({ rootId: root.id, x: rect.left, y: rect.bottom, returnFocus: anchor });
              }}
              onDrop={async (sourceId) => {
                if (readOnly) return;
                const next = reorderIds(
                  library.snapshot.roots.map((item) => item.id),
                  sourceId,
                  root.id,
                );
                if (!next) return;
                try {
                  await library.orderRoots(next);
                } catch (error) {
                  library.toast(errorMessage(error), true);
                }
              }}
              onNudge={async (direction) => {
                if (readOnly) return;
                const next = moveAdjacent(
                  library.snapshot.roots.map((item) => item.id),
                  root.id,
                  direction,
                );
                if (!next) return;
                try {
                  await library.orderRoots(next);
                } catch (error) {
                  library.toast(errorMessage(error), true);
                }
              }}
              onRename={async (value) => {
                await library.updateRoot(root.id, { label: value });
              }}
              onIssues={() => setIssuesId(root.id)}
            />
          ))}
        </div>
        <form
          className="root-add-form"
          onSubmit={(event) => {
            event.preventDefault();
            void commitAdd();
          }}
        >
          <h3>添加来源目录</h3>
          <div className="add-inputs">
            <input
              id="root-path"
              className="field"
              aria-label="目录路径"
              placeholder="粘贴文件夹的完整路径"
              autoComplete="off"
              value={path}
              disabled={readOnly}
              onChange={(event) => setPath(event.target.value)}
            />
            <FolderButton
              disabled={readOnly}
              onPath={(next) => setPath(next)}
            />
            <input
              id="root-label"
              className="field"
              aria-label="新目录显示名"
              placeholder="显示名（可留空）"
              value={label}
              disabled={readOnly}
              onChange={(event) => setLabel(event.target.value)}
            />
            <button id="add-root" type="submit" className="button-primary" disabled={!preview.canCommit || readOnly}>
              添加目录
            </button>
          </div>
          <PreviewBody preview={preview} onViewParent={(id) => { library.closeManager(); library.selectRoot(id); }} />
        </form>
      </Dialog>
      {menu && menuRoot ? (
        <Menu
          items={managerActions(menuRoot, readOnly, library.busy)}
          x={menu.x}
          y={menu.y}
          returnFocus={menu.returnFocus}
          onClose={() => setMenu(null)}
          onSelect={(id) => void runAction(menuRoot, id)}
        />
      ) : null}
      {relocateRoot ? (
        <RelocateDialog root={relocateRoot} readOnly={readOnly} onClose={() => setRelocateId(null)} />
      ) : null}
      {issuesRoot ? (
        <Dialog title={"扫描问题 · " + issuesRoot.label} onClose={() => setIssuesId(null)}>
          <ul className="file-list">
            {issuesRoot.state.issues.map((issue) => (
              <li key={issue.path + issue.message}>
                {issue.path}：{issue.message}
              </li>
            ))}
          </ul>
        </Dialog>
      ) : null}
    </>
  );
}

function ManagerRow({
  root,
  readOnly,
  duplicate,
  progress,
  menuOpen,
  onOpenMenu,
  onDrop,
  onNudge,
  onRename,
  onIssues,
}: {
  root: RootRecord;
  readOnly: boolean;
  duplicate: boolean;
  progress: { files: { done: number; total: number } } | null;
  menuOpen: boolean;
  onOpenMenu: (anchor: HTMLElement) => void;
  onDrop: (sourceId: string) => void;
  onNudge: (direction: -1 | 1) => void;
  onRename: (value: string) => Promise<void>;
  onIssues: () => void;
}) {
  const [over, setOver] = useState(false);
  const ratio = progress && progress.files.total ? (100 * progress.files.done) / progress.files.total : 0;
  return (
    <div
      className={"manager-row" + (over ? " drop-target" : "")}
      data-manager-root={root.id}
      onDragOver={(event) => {
        if (readOnly) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        onDrop(event.dataTransfer.getData("text/plain"));
      }}
    >
      <button
        type="button"
        className="drag-handle icon-button"
        draggable={!readOnly}
        aria-label="拖动或 Alt 加方向键排序"
        title="拖动或 Alt 加方向键排序"
        disabled={readOnly}
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", root.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onKeyDown={(event) => {
          if (readOnly || !event.altKey) return;
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          event.stopPropagation();
          onNudge(event.key === "ArrowUp" ? -1 : 1);
        }}
      >
        <Icon name="grip" />
      </button>
      <div className="manager-name">
        <RootLabel root={root} disabled={readOnly} onCommit={onRename} />
        <div className="manager-path" title={root.path}>
          {root.displayPath}
        </div>
      </div>
      <div className="manager-counts">
        <strong>{root.counts.items} 条</strong>
        <span className="muted">
          {root.counts.html} HTML · {root.counts.mhtml} MHTML · {root.counts.markdown} MD
        </span>
        <span className="last-scanned">上次 {formatDate(root.state.lastScan?.completedAt)}</span>
      </div>
      <div className="manager-status">
        <span className="status-caption" data-status={root.state.status}>
          {statusLabel(root.state.status, root.state.message)}
        </span>
        {progress ? (
          <span data-scan-progress={progress.files.done + "/" + progress.files.total}>
            扫描中 {progress.files.done}/{progress.files.total}
          </span>
        ) : null}
        {duplicate ? <span className="badge">显示名相同</span> : null}
        {root.state.excludes.length ? <span className="muted">排除 {root.state.excludes.length} 个子目录</span> : null}
        {root.state.issues.length ? (
          <button type="button" className="text-button" onClick={onIssues}>
            {root.state.issues.length} 个问题
          </button>
        ) : null}
        {progress ? (
          <span className="progress" aria-hidden="true">
            <span style={{ width: ratio + "%" }} />
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="icon-button"
        aria-label={root.label + "目录操作"}
        title={root.label + "目录操作"}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(event) => onOpenMenu(event.currentTarget)}
      >
        <Icon name="more" />
      </button>
    </div>
  );
}

function RootLabel({
  root,
  disabled,
  onCommit,
}: {
  root: RootRecord;
  disabled: boolean;
  onCommit: (value: string) => Promise<void>;
}) {
  const library = useLibrary();
  const [value, setValue] = useState(root.label);
  const focused = useRef(false);
  const skip = useRef(false);

  useEffect(() => {
    if (!focused.current) setValue(root.label);
  }, [root.id, root.label]);

  return (
    <input
      className="field root-label-edit"
      data-root-label-input={root.id}
      aria-label={root.label + "显示名"}
      value={value}
      disabled={disabled}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        focused.current = false;
        if (skip.current) {
          skip.current = false;
          return;
        }
        if (value === root.label) return;
        void onCommit(value).catch((error: unknown) => {
          setValue(root.label);
          library.toast(errorMessage(error), true);
        });
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          skip.current = true;
          setValue(root.label);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function FolderButton({ disabled, onPath }: { disabled: boolean; onPath: (path: string) => void }) {
  const library = useLibrary();
  const [picking, setPicking] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled || picking}
      onClick={() => {
        setPicking(true);
        void library
          .chooseFolder()
          .then((result) => {
            if (!result.cancelled) onPath(result.path);
          })
          .catch((error: unknown) => library.toast(errorMessage(error), true))
          .finally(() => setPicking(false));
      }}
    >
      选择文件夹…
    </button>
  );
}

function RelocateDialog({ root, readOnly, onClose }: { root: RootRecord; readOnly: boolean; onClose: () => void }) {
  const library = useLibrary();
  const saving = useRef(false);
  const [path, setPath] = useState(root.path);
  const source = { path: path.trim(), excludeId: root.id };
  const preview = usePreview(path.trim() ? source : null);

  async function commit() {
    if (saving.current || !preview.canCommit || readOnly) return;
    saving.current = true;
    try {
      const saved = await preview.reconfirm((next) => {
        const detail = next.overlap?.message || (next.counts ? next.counts.items + " 条资料" : "");
        return "归属已变化，请再次确认：" + detail;
      });
      if (!saved) return;
      await library.updateRoot(root.id, { path: path.trim() });
      library.toast("目录位置已更新，条目 ID 保持不变");
      onClose();
    } catch (error) {
      library.toast(errorMessage(error), true);
    } finally {
      saving.current = false;
    }
  }

  return (
    <Dialog
      title={"重新定位 · " + root.label}
      onClose={onClose}
      autoFocusSelector="#relocate-path"
      footer={
        <>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="button" className="button-primary" disabled={!preview.canCommit || readOnly} onClick={() => void commit()}>
            重新定位
          </button>
        </>
      }
    >
      <p className="muted">选择移动后的目录。内部相对路径不变时，原条目链接继续可用。</p>
      <input
        id="relocate-path"
        className="field"
        aria-label="新目录路径"
        value={path}
        disabled={readOnly}
        onChange={(event) => setPath(event.target.value)}
      />
      <FolderButton disabled={readOnly} onPath={setPath} />
      <PreviewBody preview={preview} onViewParent={(id) => { onClose(); library.closeManager(); library.selectRoot(id); }} />
    </Dialog>
  );
}

function PreviewBody({
  preview,
  onViewParent,
}: {
  preview: PreviewState;
  onViewParent: (id: string) => void;
}) {
  const result = preview.preview;
  return (
    <div id={preview.liveId} aria-live="polite">
      {preview.error ? <p className="danger-text">{preview.error}</p> : null}
      {result?.errors.map((item) => (
        <p key={(item.code || "") + item.message} className="danger-text">
          {item.message}
        </p>
      ))}
      {result?.valid && result.counts ? (
        <p className="muted">
          {result.counts.files} 个文件 · {result.counts.items} 条资料
        </p>
      ) : null}
      {result?.duplicateLabel ? <p className="warning-text">显示名与其他目录相同；资料仍按路径区分。</p> : null}
      {result?.overlap ? (
        <div className="overlap-warning">
          <strong>目录重叠 · 最深目录优先</strong>
          {result.overlap.message ? <p>{result.overlap.message}</p> : null}
          {result.overlap.affectedSeries?.length ? (
            <p>
              将重新计算：
              {result.overlap.affectedSeries.map((series) => series.name + "（" + series.count + " 篇）").join("、")}
            </p>
          ) : null}
          {result.overlap.children?.length ? (
            <p>子目录仍独立：{result.overlap.children.map((child) => child.label || child.id).join("、")}</p>
          ) : null}
          {result.overlap.parentId ? (
            <button type="button" className="text-button" onClick={() => onViewParent(result.overlap?.parentId || "")}>
              不添加，查看父目录
            </button>
          ) : null}
        </div>
      ) : null}
      {preview.mismatch ? <p className="warning-text">{preview.mismatch}</p> : null}
    </div>
  );
}

type PreviewState = ReturnType<typeof usePreview>;

function usePreview(source: PreviewSource | null) {
  const library = useLibrary();
  const [preview, setPreview] = useState<Preflight | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [mismatch, setMismatch] = useState("");
  const serial = useRef(0);
  const sourceRef = useRef(source);
  const previewRef = useRef(preview);
  sourceRef.current = source;
  previewRef.current = preview;
  const sourceKey = source ? source.path + "\n" + (source.label || "") + "\n" + (source.excludeId || "") : "";

  useEffect(() => {
    const token = ++serial.current;
    setMismatch("");
    if (!source || !source.path.trim()) {
      setPreview(null);
      setError("");
      setPending(false);
      return;
    }
    setPreview(null);
    setPending(true);
    setError("");
    const current = source;
    const handle = window.setTimeout(() => {
      void library
        .preflight(current)
        .then((next) => {
          if (token !== serial.current) return;
          setPreview(next);
          setPending(false);
        })
        .catch((reason: unknown) => {
          if (token !== serial.current) return;
          setPreview(null);
          setError(errorMessage(reason));
          setPending(false);
        });
    }, PREVIEW_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [library.preflight, sourceKey]);

  async function reconfirm(describe: string | ((next: Preflight) => string)) {
    const currentSource = sourceRef.current;
    const currentPreview = previewRef.current;
    if (!currentSource || !currentPreview?.valid || library.snapshot.readOnly) return false;
    if (labelError(currentSource.label || "")) return false;
    const token = ++serial.current;
    let next: Preflight;
    try {
      next = await library.preflight(currentSource);
    } catch (reason) {
      if (token === serial.current) {
        setPreview(null);
        setError(errorMessage(reason));
        setPending(false);
      }
      return false;
    }
    if (token !== serial.current) return false;
    if (!next.valid) {
      setPreview(next);
      setMismatch("");
      setPending(false);
      return false;
    }
    if (preflightFingerprint(next) !== preflightFingerprint(currentPreview)) {
      setPreview(next);
      setMismatch(typeof describe === "function" ? describe(next) : describe);
      setPending(false);
      return false;
    }
    return true;
  }

  const invalidLabel = labelError(source?.label || "");
  return {
    preview,
    error: invalidLabel || error,
    pending,
    mismatch,
    liveId: source?.excludeId ? "relocate-preview" : "root-preview",
    canCommit: !library.snapshot.readOnly && !pending && !invalidLabel && !!preview?.valid,
    reconfirm,
  };
}
