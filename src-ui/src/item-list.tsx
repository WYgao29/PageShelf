import { useCallback, useEffect, useRef, useState } from "react";
import emptyLogo from "../assets/brand/pageshelf-logo.svg";
import emptyLogoDark from "../assets/brand/pageshelf-logo-dark.svg";
import { Icon } from "./components/icons";
import { SelectField } from "./components/select-field";
import { Menu, closeOpenMenu } from "./components/menu";
import { errorMessage, formatDate, selectionLabel } from "./library";
import { useLibrary } from "./library-context";
import { invoke, mergePage, searchQuery, type Item, type SearchResult } from "./items";
import { useRoute } from "./router";

export function Highlight({ text, ranges = [] }: { text: string; ranges?: [number, number][] }) {
  const parts: React.ReactNode[] = [];
  let end = 0;
  for (const [start, stop] of ranges) {
    if (start < end || stop <= start || stop > text.length) continue;
    parts.push(text.slice(end, start), <mark key={start}>{text.slice(start, stop)}</mark>);
    end = stop;
  }
  parts.push(text.slice(end));
  return <>{parts}</>;
}

export function ItemList() {
  const { route, navigate } = useRoute();
  const library = useLibrary();
  const [focused, setFocused] = useState("");
  const [draft, setDraft] = useState(route.q);
  const [resultQuery, setResultQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [skeleton, setSkeleton] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; item: Item; target: HTMLElement } | null>(null);
  const serial = useRef(0);
  const pending = useRef(false);
  const query = JSON.stringify(searchQuery(route));
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(route.q); }, [route.q]);
  useEffect(() => { setFocused(route.item); }, [route.item]);
  useEffect(() => {
    if (draft === route.q) return;
    const timer = setTimeout(() => navigate({ q: draft, sort: draft ? "relevance" : "updated" }, true), 150);
    return () => clearTimeout(timer);
  }, [draft, navigate, route.q]);
  useEffect(() => { closeOpenMenu(); }, [route]);

  const fetchPage = useCallback(async (reset: boolean, current: SearchResult | null = null) => {
    if (!reset && pending.current) return;
    const generation = reset ? ++serial.current : serial.current;
    pending.current = true;
    setLoading(true); setError("");
    try {
      const page = await invoke<SearchResult>("items.search", { query: { ...JSON.parse(query), limit: 100, offset: reset ? 0 : current?.items.length || 0 } });
      if (generation !== serial.current) return;
      if (!Array.isArray(page.items) || !Array.isArray(page.groups)) throw new Error("资料列表无效");
      setResult(reset || !current ? page : mergePage(current, page));
      setResultQuery(JSON.parse(query).q);
    } catch (reason) { if (generation === serial.current) setError(errorMessage(reason, "无法读取资料")); }
    finally { if (generation === serial.current) { pending.current = false; setLoading(false); } }
  }, [query]);
  useEffect(() => { setResult(null); setExpanded(new Set()); setFocused(""); }, [query]);
  useEffect(() => {
    void fetchPage(true);
    return () => { serial.current++; pending.current = false; };
  }, [fetchPage, library.catalogEpoch]);
  useEffect(() => {
    if (!loading) { setSkeleton(false); return; }
    const timer = setTimeout(() => setSkeleton(true), 200);
    return () => clearTimeout(timer);
  }, [loading]);

  const root = library.snapshot.roots.find(value => value.id === route.rootId);
  const filtered = !!(route.q || route.fmt || route.kind || route.folder);
  const emptyTitle = library.error ? "无法读取来源" : !library.loaded || loading ? "正在读取资料…" : !library.snapshot.roots.length ? "从一个文件夹开始" : library.busy ? "正在扫描资料…" : root && (!root.enabled || !["ok", "warning", "scanning"].includes(root.state.status)) ? root.enabled ? "目录不可用" : "目录已停用" : filtered ? "没有找到匹配内容" : "这个目录还没有资料";

  function row(item: Item) {
    const title = item.highlights?.find(value => value.field === "title");
    const body = item.highlights?.find(value => value.field === "body");
    return <button type="button" key={item.id} role="option" aria-selected={(focused || route.item) === item.id} className="item-row" onFocus={() => setFocused(item.id)} data-item-id={item.id} title={item.relativePath}
      onClick={event => {
        if (event.metaKey || event.ctrlKey) void window.pageshelf?.openOriginal(item.id).catch(reason => library.toast(errorMessage(reason), true));
        else navigate({ item: item.id });
      }}
      onContextMenu={event => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, item, target: event.currentTarget }); }}>
      <span className="item-title"><Highlight text={item.title} ranges={title?.ranges} /></span>
      <span className="item-meta"><span className="item-source" title={item.rootLabel}>{item.rootLabel}</span><span className="item-format">{Object.keys(item.formats).filter(key => item.formats[key as keyof Item["formats"]]).map(key => key === "markdown" ? "MD" : key.toUpperCase()).join(" / ")}</span><span className="item-date">{formatDate(item.updatedAt)}</span>{route.q ? <span className="item-hits">命中 {item.hits || 0} 处</span> : null}</span>
      <span className="item-excerpt"><Highlight text={body?.text || item.excerpt || "暂无摘要"} ranges={body?.ranges} /></span>
    </button>;
  }
  const rows = result?.groups.length ? result.groups.map(group => {
    const key = group.rootId + ":" + group.seriesKey;
    const ids = expanded.has(key) ? group.itemIds : group.itemIds.slice(0, 6);
    return <div role="group" aria-label={group.label} key={key}>
      <div className="group-heading"><strong>{group.label}</strong><span>{group.itemIds.length} 篇</span></div>
      {ids.map(id => result.items.find(item => item.id === id)).filter((item): item is Item => !!item).map(row)}
      {group.itemIds.length > 6 ? <button className="expand-group" type="button" onClick={() => setExpanded(current => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; })}>{expanded.has(key) ? "收起系列" : `展开其余 ${group.itemIds.length - 6} 篇`}</button> : null}
    </div>;
  }) : result?.items.map(row);

  return <>
    <header className="pane-header list-toolbar">
      <div className="search-box"><Icon name="search" /><input ref={searchRef} id="search-input" type="search" aria-label="搜索资料" placeholder="搜索标题、正文、标签…" maxLength={500} value={draft} onChange={event => setDraft(event.target.value)} />
        {draft ? <button type="button" className="icon-button" aria-label="清空搜索" onClick={() => { setDraft(""); navigate({ q: "", sort: "updated" }, true); searchRef.current?.focus(); }}><Icon name="close" /></button> : <kbd>⌘K</kbd>}
      </div>
    </header>
    <div className="list-controls">
      <p className="status-line" data-nav-kind={library.selection.kind} data-nav-root={route.rootId} data-nav-series={route.seriesKey}>{selectionLabel(library.selection, library.snapshot.roots, library.seriesName)}</p>
      <div className="filter-line">
        <SelectField label="搜索范围" caption="范围" value={route.scope} onChange={value => navigate({ scope: value as "all" | "root" })}><option value="all">全部目录</option><option value="root" disabled={!route.rootId}>当前目录</option></SelectField>
        <SelectField label="格式" value={route.fmt} onChange={value => navigate({ fmt: value })}><option value="">全部格式</option><option value="html">HTML（含 MHTML）</option><option value="mhtml">MHTML</option><option value="markdown">Markdown</option></SelectField>
        <SelectField label="类型" value={route.kind} onChange={value => navigate({ kind: value })}><option value="">全部类型</option><option value="series">系列</option><option value="single">单篇</option></SelectField>
      </div>
      <div className="result-line"><span role="status">{loading ? "正在搜索…" : `${result?.total || 0} 篇 · ${result?.roots || 0} 个来源`}</span><SelectField compact label="排序" value={route.sort} onChange={value => navigate({ sort: value })}><option value="updated">最近更新</option><option value="title">标题</option><option value="series">系列顺序</option><option value="relevance">相关度</option></SelectField></div>
    </div>
    <div id="list-rows" className="list-scroll" data-query={resultQuery} role="listbox" aria-label="文章结果" aria-busy={loading} onScroll={event => { const node = event.currentTarget; if (result && result.items.length < result.total && node.scrollHeight - node.scrollTop - node.clientHeight < 160) void fetchPage(false, result); }}>
      {error ? <div className="empty-state" role="alert"><h2>资料加载失败</h2><p>{error}</p><button onClick={() => void fetchPage(true)}>重试</button></div> : result?.items.length ? rows : skeleton ? <div aria-label="正在加载资料" className="list-skeleton">{[1, 2, 3, 4].map(index => <div className="skeleton-row" key={index}><span /><span /><span /></div>)}</div> : <div className="empty-state">{!library.snapshot.roots.length ? <><img className="empty-logo empty-logo-light" src={emptyLogo} alt="" /><img className="empty-logo empty-logo-dark" src={emptyLogoDark} alt="" /></> : <span className="empty-symbol" aria-hidden="true"><Icon name="search" /></span>}<h2>{emptyTitle}</h2><p>{library.error || (route.q ? `查询“${route.q}”。支持空格 AND、"短语"、-排除词。` : root?.state.message || "支持 HTML、MHTML 和 Markdown。")}</p>{!loading ? <button onClick={() => library.error ? void library.reload() : filtered ? navigate({ q: "", fmt: "", kind: "", folder: "" }) : root && !root.enabled ? void library.updateRoot(root.id, { enabled: true }) : library.openManager(root ? !["ok", "warning", "scanning"].includes(root.state.status) ? { relocateId: root.id } : {} : { focusAdd: true })}>{library.error ? "重试" : filtered ? "清除筛选" : root && !root.enabled ? "启用目录" : root ? "管理目录" : "添加目录"}</button> : null}</div>}
      {result && result.items.length < result.total ? <button type="button" className="load-more" disabled={loading} onClick={() => void fetchPage(false, result)}>{loading ? "正在加载…" : "加载更多（100 篇）"}</button> : null}
    </div>
    {menu ? <Menu x={menu.x} y={menu.y} returnFocus={menu.target} onClose={() => setMenu(null)} items={[{ kind: "item", id: "original", label: "在新窗口打开原网页" }, { kind: "item", id: "reveal", label: "在访达中显示" }, { kind: "item", id: "copy", label: "复制路径" }]} onSelect={id => {
      const action = id === "original" ? window.pageshelf?.openOriginal(menu.item.id) : id === "reveal" ? window.pageshelf?.revealInFinder({ itemId: menu.item.id }) : invoke("system.copyItemPath", { id: menu.item.id });
      void action?.catch(reason => library.toast(errorMessage(reason), true));
    }} /> : null}
  </>;
}
