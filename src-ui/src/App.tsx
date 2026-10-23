import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { COMMANDS } from "../../shared/commands.js";
import { Dialog } from "./components/dialog";
import { Icon } from "./components/icons";
import { installInputModality, keyboardInteraction } from "./input-modality";
import { registerShortcuts } from "./shortcuts";
import logo from "../assets/brand/pageshelf-logo.svg";
import logoDark from "../assets/brand/pageshelf-logo-dark.svg";
import markDark from "../assets/brand/pageshelf-mark-dark.svg";
import mark from "../assets/brand/pageshelf-mark.svg";
import { LibraryProvider, useLibrary } from "./library-context";
import { Reader } from "./reader";
import { ItemList } from "./item-list";
import { RouterProvider, useRoute } from "./router";
import { Manager } from "./manager";
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
import { Sidebar } from "./sidebar";

const THEME_OPTIONS: Array<[ThemePreference, string]> = [
  ["system", "跟随系统"],
  ["light", "亮色"],
  ["dark", "暗色"],
];

function prefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function App() {
  return (
    <RouterProvider><LibraryProvider>
      <Shell />
    </LibraryProvider></RouterProvider>
  );
}

function Shell() {
  const library = useLibrary();
  const { route, navigate } = useRoute();
  const [help, setHelp] = useState(false);
  const [about, setAbout] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("ui.sidebarCollapsed") === "true"; } catch { return false; } });
  const [preference, setPreference] = useState<ThemePreference>(() =>
    readThemePreference(localStorage),
  );
  const [schemeDark, setSchemeDark] = useState(prefersDark);
  const [panes, setPanes] = useState<[number, number]>(() => readPaneWidths(localStorage));
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);

  useLayoutEffect(installInputModality, []);

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

  const appearance = resolveAppearance(preference, schemeDark);
  const normalLayout = layoutPanes(windowWidth, panes);
  const layout = collapsed ? { ...normalLayout, sidebar: 0, collapsed: true } : normalLayout;
  function dispatch(command: string) {
    if (command === "escape-search") { navigate({ q: "", sort: "updated" }, true); return; }
    if (document.querySelector("dialog[open]")) return;
    if (command === "focus-search") { const input = document.querySelector<HTMLInputElement>("#search-input"); input?.focus(); input?.select(); }
    else if (command === "toggle-sidebar") {
      if (normalLayout.collapsed) setDrawer(value => !value);
      else setCollapsed(value => { try { localStorage.setItem("ui.sidebarCollapsed", String(!value)); } catch {} return !value; });
    }
    else if (command === "cycle-theme") setPreference(current => THEME_OPTIONS[(THEME_OPTIONS.findIndex(([value]) => value === current) + 1) % THEME_OPTIONS.length][0]);
    else if (command === "back") history.back();
    else if (command === "forward") history.forward();
    else if (command === "help") setHelp(true);
    else if (command === "about") setAbout(true);
    else if (command === "manage-roots") library.openManager();
    else if (command === "scan-all") void library.rescan().catch(reason => library.toast(String(reason), true));
    else if (command === "all-roots") library.selectAll();
    else if (/^root-[1-9]$/.test(command)) { const root = library.snapshot.roots[Number(command.slice(5)) - 1]; if (root) library.selectRoot(root.id); }
    else if (command === "next-item" || command === "previous-item") {
      const rows = [...document.querySelectorAll<HTMLButtonElement>(".item-row")];
      const focused = rows.indexOf(document.activeElement as HTMLButtonElement);
      const current = focused >= 0 ? focused : rows.findIndex(row => row.dataset.itemId === route.item);
      rows[Math.max(0, Math.min(rows.length - 1, current + (command === "next-item" ? 1 : -1)))]?.focus();
    }
    else if (command === "open-item") {
      const row = document.activeElement instanceof HTMLElement && document.activeElement.matches(".item-row") ? document.activeElement : document.querySelector<HTMLElement>('.item-row[aria-selected="true"]') || document.querySelector<HTMLElement>(".item-row");
      if (row?.dataset.itemId) navigate({ item: row.dataset.itemId });
    }
    else window.dispatchEvent(new CustomEvent("pageshelf-command", { detail: command }));
  }
  const commandRef = useRef(dispatch);
  commandRef.current = dispatch;
  useEffect(() => {
    const run = (command: string) => { keyboardInteraction(); commandRef.current(command); };
    const offKeys = registerShortcuts(run);
    const offMenu = window.pageshelf?.on("command", payload => {
      if (payload && typeof payload === "object" && "command" in payload && typeof payload.command === "string") run(payload.command);
    });
    const offExternal = window.pageshelf?.on("external-link", payload => {
      if (!payload || typeof payload !== "object" || !("url" in payload) || typeof payload.url !== "string") return;
      const url = payload.url;
      if (!/^https?:\/\//i.test(url)) return;
      void library.confirm({ title: "打开外部链接？", message: "将在默认浏览器中打开：\n" + url, confirmLabel: "打开链接" }).then(async accepted => {
        if (accepted) try { await window.pageshelf?.openExternal(url, true); } catch (error) { library.toast(String(error), true); }
      });
    });
    return () => { offKeys(); offMenu?.(); offExternal?.(); };
  }, []);
  useEffect(() => { setDrawer(false); }, [route.rootId, route.seriesKey, route.settings]);

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
          <Sidebar />
        </aside>
        <section id="list-pane" className="list-pane" aria-label="资料列表">
          <div className="titlebar" aria-hidden="true" />
          <ItemList />
        </section>
        <main id="reader-pane" className="reader-pane" tabIndex={-1} aria-label="阅读区">
          <header className="pane-header">
            <button type="button" className="icon-button" title="折叠或显示侧栏" aria-label="折叠或显示侧栏" aria-expanded={!layout.collapsed} onClick={() => dispatch("toggle-sidebar")}><Icon name="sidebar" /></button>
            <h2 className="pane-title">阅读</h2>
            <div className="theme-picker" role="radiogroup" aria-label="主题">
              {THEME_OPTIONS.map(([value, label]) => <button key={value} type="button" className="theme-option" role="radio" data-theme={value} aria-checked={preference === value} tabIndex={preference === value ? 0 : -1} onClick={() => setPreference(value)} onKeyDown={onThemeKey}>{label}</button>)}
            </div>
          </header>
          <Reader />
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
      <Manager />
      {drawer ? <Dialog title="来源目录" onClose={() => setDrawer(false)}><Sidebar /></Dialog> : null}
      {help ? <Dialog title="快捷键帮助" onClose={() => setHelp(false)}><dl className="shortcut-list">{COMMANDS.map(command => <div key={command.id}><dt>{command.label}</dt><dd><kbd>{document.documentElement.dataset.platform === "darwin" ? command.key : command.key.replaceAll("⌘", "Ctrl+")}</kbd></dd></div>)}<div><dt>指定来源目录</dt><dd><kbd>g 1–9（1 秒内）</kbd></dd></div><div><dt>关闭菜单/弹窗或清空搜索</dt><dd><kbd>Esc</kbd></dd></div></dl></Dialog> : null}
      {about ? <Dialog title="关于 PageShelf" onClose={() => setAbout(false)}><img className="about-logo" src={appearance === "dark" ? logoDark : logo} alt="PageShelf" /><p>本机资料阅读与搜索</p><p>HTML · MHTML · Markdown</p><p>版本 0.1.0</p></Dialog> : null}
    </>
  );
}
