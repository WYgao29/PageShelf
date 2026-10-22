import { useEffect, useLayoutEffect, useState } from "react";
import markDark from "../assets/brand/pageshelf-mark-dark.svg";
import mark from "../assets/brand/pageshelf-mark.svg";
import {
  LIST_MAX,
  LIST_MIN,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  clampPane,
  defaultPaneWidths,
  layoutPanes,
  nudgePane,
  readPaneWidths,
  readThemePreference,
  resolveAppearance,
  writePaneWidths,
  writeThemePreference,
  type ThemePreference,
} from "./preferences";

type RootRow = { id: string; label: string; path: string };

const THEME_OPTIONS: Array<[ThemePreference, string]> = [
  ["system", "跟随系统"],
  ["light", "亮色"],
  ["dark", "暗色"],
];

function isRootList(value: unknown): value is { roots: RootRow[] } {
  if (typeof value !== "object" || value === null) return false;
  const roots = (value as { roots?: unknown }).roots;
  if (!Array.isArray(roots)) return false;
  return roots.every(
    (root) =>
      typeof root === "object" &&
      root !== null &&
      typeof (root as RootRow).id === "string" &&
      typeof (root as RootRow).label === "string" &&
      typeof (root as RootRow).path === "string",
  );
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "无法读取来源";
}

function prefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function App() {
  const [preference, setPreference] = useState<ThemePreference>(() =>
    readThemePreference(localStorage),
  );
  const [schemeDark, setSchemeDark] = useState(prefersDark);
  const [panes, setPanes] = useState<[number, number]>(() => readPaneWidths(localStorage));
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const [roots, setRoots] = useState<RootRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSchemeDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver === "function") {
      try {
        observer = new ResizeObserver(onResize);
        observer.observe(document.documentElement);
      } catch {
        observer = null;
      }
    }
    return () => {
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    const api = window.pageshelf;
    if (!api) {
      setError("桌面接口不可用");
      setRoots([]);
      return;
    }
    let cancelled = false;
    api
      .invoke("roots.list")
      .then((result) => {
        if (cancelled) return;
        if (!isRootList(result)) throw new Error("来源列表无效");
        setRoots(result.roots);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(errorMessage(reason));
        setRoots([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const appearance = resolveAppearance(preference, schemeDark);
  const layout = layoutPanes(windowWidth, panes);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = appearance;
    writeThemePreference(localStorage, preference);
    document.documentElement.style.setProperty("--sidebar-width", layout.sidebar + "px");
    document.documentElement.style.setProperty("--list-width", layout.list + "px");
    writePaneWidths(localStorage, panes);
  }, [appearance, layout.list, layout.sidebar, panes, preference]);

  function resizeStored(index: 0 | 1, value: number) {
    setPanes((current) => {
      const next: [number, number] = [current[0], current[1]];
      next[index] = clampPane(index, value);
      return next;
    });
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>, index: 0 | 1) {
    if (event.button !== 0 || (index === 0 && layout.collapsed)) return;
    const handle = event.currentTarget;
    const start = event.clientX;
    const initial = panes[index];
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* jsdom 没有指针捕获。 */
    }
    document.documentElement.classList.add("resizing");
    const move = (moveEvent: PointerEvent) => {
      resizeStored(index, initial + moveEvent.clientX - start);
    };
    const done = () => {
      handle.removeEventListener("pointermove", move);
      document.documentElement.classList.remove("resizing");
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", done, { once: true });
    handle.addEventListener("pointercancel", done, { once: true });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>, index: 0 | 1) {
    if (index === 0 && layout.collapsed) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setPanes((current) => nudgePane(current, index, event.key === "ArrowRight" ? 1 : -1));
  }

  function resetPanes() {
    setPanes(defaultPaneWidths());
  }

  function onThemeKey(event: React.KeyboardEvent<HTMLButtonElement>) {
    const current = THEME_OPTIONS.findIndex(([value]) => value === event.currentTarget.dataset.theme);
    if (current < 0) return;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      setPreference(THEME_OPTIONS[current][0]);
      return;
    }
    let next = current;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % THEME_OPTIONS.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (current - 1 + THEME_OPTIONS.length) % THEME_OPTIONS.length;
    else return;
    event.preventDefault();
    const radios = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    radios?.[next]?.focus();
    setPreference(THEME_OPTIONS[next][0]);
  }

  return (
    <>
      <a className="skip-link" href="#reader-pane">
        跳到阅读区
      </a>
      <div className="app-shell" data-sidebar={layout.collapsed ? "collapsed" : "open"}>
        <aside
          id="sidebar"
          className="sidebar"
          aria-label="来源目录"
          inert={layout.collapsed ? true : undefined}
        >
          <div className="titlebar" aria-hidden="true" />
          <div className="brand-row">
            <img
              className="brand-mark"
              src={appearance === "dark" ? markDark : mark}
              alt=""
            />
            <span className="wordmark">PageShelf</span>
          </div>
          <div className="pane-body">
            <p className="pane-title">来源</p>
            {roots === null ? (
              <p className="status-line" role="status">
                正在读取来源…
              </p>
            ) : null}
            {error ? (
              <p className="status-line" role="alert">
                {error}
              </p>
            ) : null}
            {roots && roots.length === 0 && !error ? <p className="status-line">还没有来源目录</p> : null}
            {roots && roots.length > 0 ? (
              <ul className="source-list" aria-label="来源目录">
                {roots.map((root) => (
                  <li key={root.id}>
                    <span>{root.label}</span>
                    <span className="source-path">{root.path}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </aside>
        <section id="list-pane" className="list-pane" aria-label="资料列表">
          <div className="titlebar" aria-hidden="true" />
          <header className="pane-header">
            <h2 className="pane-title">资料</h2>
            <div className="theme-picker" role="radiogroup" aria-label="主题">
              {THEME_OPTIONS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="theme-option"
                  role="radio"
                  data-theme={value}
                  aria-checked={preference === value}
                  tabIndex={preference === value ? 0 : -1}
                  onClick={() => setPreference(value)}
                  onKeyDown={onThemeKey}
                >
                  {label}
                </button>
              ))}
            </div>
          </header>
          <div className="pane-body">
            <p className="pane-placeholder">选择来源后显示资料</p>
          </div>
        </section>
        <main id="reader-pane" className="reader-pane" tabIndex={-1} aria-label="阅读区">
          <header className="pane-header">
            <h2 className="pane-title">阅读</h2>
          </header>
          <div className="pane-body">
            <p className="pane-placeholder">选择一篇资料</p>
          </div>
        </main>
        <div
          id="split-side"
          className="splitter"
          role="separator"
          tabIndex={layout.collapsed ? -1 : 0}
          aria-orientation="vertical"
          aria-label="调整目录栏宽度"
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={SIDEBAR_MAX}
          aria-valuenow={layout.stored[0]}
          aria-hidden={layout.collapsed || undefined}
          onDoubleClick={resetPanes}
          onKeyDown={(event) => onKeyDown(event, 0)}
          onPointerDown={(event) => onPointerDown(event, 0)}
        />
        <div
          id="split-list"
          className="splitter"
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="调整列表栏宽度"
          aria-valuemin={LIST_MIN}
          aria-valuemax={LIST_MAX}
          aria-valuenow={layout.stored[1]}
          onDoubleClick={resetPanes}
          onKeyDown={(event) => onKeyDown(event, 1)}
          onPointerDown={(event) => onPointerDown(event, 1)}
        />
      </div>
    </>
  );
}
