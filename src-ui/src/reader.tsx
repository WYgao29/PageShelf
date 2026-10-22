import { useEffect, useRef, useState } from "react";
import { Dialog } from "./components/dialog";
import { Menu } from "./components/menu";
import { invoke, type Item, type ItemDetail, type SearchResult } from "./items";
import { errorMessage, formatDate } from "./library";
import { useLibrary } from "./library-context";
import { buildReader, type Reading } from "./reader/pipeline.js";
import { createToc } from "./reader/toc.js";
import { useRoute } from "./router";

type Bytes = { body: string | Uint8Array; headers: Record<string, string> };
const decode = (body: Bytes["body"]) => typeof body === "string" ? body : new TextDecoder().decode(body);
const FONTS = [15, 17, 19, 21];
function readFont() { try { const size = Number(localStorage.getItem("ui.readerFont")); return FONTS.includes(size) ? size : 17; } catch { return 17; } }

export function Reader() {
  const { route, navigate } = useRoute();
  const library = useLibrary();
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [skeleton, setSkeleton] = useState(false);
  const [retry, setRetry] = useState(0);
  const [font, setFont] = useState(readFont);
  const [hit, setHit] = useState(0);
  const [active, setActive] = useState("");
  const [tocOpen, setTocOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [menu, setMenu] = useState<{ kind: "font" | "actions"; x: number; y: number; target: HTMLElement } | null>(null);
  const articleHost = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const toc = useRef<ReturnType<typeof createToc> | null>(null);
  const positions = useRef(new Map<string, number>());
  const itemId = route.item;
  const view = route.view;
  const query = route.q;

  useEffect(() => {
    document.documentElement.style.setProperty("--reader-font", `var(--fs-reading-${FONTS.indexOf(font) + 1})`);
    try { localStorage.setItem("ui.readerFont", String(font)); } catch { /* 字号仍在本次会话生效。 */ }
  }, [font]);
  useEffect(() => {
    let cancelled = false;
    let built: Reading | null = null;
    setDetail(null); setReading(null); setSource(null); setError(""); setHit(0); setMenu(null); setTocOpen(false); setInfoOpen(false);
    if (!itemId) { setLoading(false); return; }
    setLoading(true);
    void (async () => {
      try {
        const received = await invoke<ItemDetail>("items.get", { id: itemId });
        if (cancelled) return;
        if (!received?.item?.formats) throw new Error("条目不存在");
        setDetail(received);
        const pureMd = !received.item.formats.html && !received.item.formats.mhtml;
        if (view === "original" && !pureMd) return;
        const markdown = pureMd || (view === "markdown" && !!received.item.formats.markdown);
        const response = await invoke<Bytes>(markdown ? "items.source" : "items.document", { id: itemId, ...(markdown ? { format: "markdown" } : {}) });
        if (cancelled) return;
        const content = decode(response.body);
        if (view === "original" && pureMd) { setSource(content); return; }
        const wikiItems: Item[] = [];
        if (markdown && content.includes("[[")) {
          let offset = 0;
          while (!cancelled) {
            const batch = await invoke<SearchResult>("items.search", { query: { roots: received.item.rootId, limit: 500, offset } });
            wikiItems.push(...batch.items); offset += batch.items.length;
            if (!batch.items.length || offset >= batch.total) break;
          }
        }
        if (cancelled) return;
        built = await buildReader({ item: received.item, ...(markdown ? { markdown: content } : { html: content }), items: wikiItems, query, onFindChange: position => setHit(position) });
        if (cancelled) { built.find?.destroy(); return; }
        setReading(built);
      } catch (reason) { if (!cancelled) setError(errorMessage(reason, "正文加载失败")); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; built?.find?.destroy(); };
  }, [itemId, view, query, retry, library.catalogEpoch]);

  useEffect(() => {
    if (!loading) { setSkeleton(false); return; }
    const timer = setTimeout(() => setSkeleton(true), 200);
    return () => clearTimeout(timer);
  }, [loading]);
  useEffect(() => {
    if (!reading?.article || !articleHost.current || !scroll.current) return;
    const node = scroll.current;
    articleHost.current.replaceChildren(reading.article);
    toc.current = createToc({ article: reading.article, scrollContainer: node, onActive: setActive });
    node.scrollTop = positions.current.get(itemId + ":" + view) || 0;
    return () => {
      positions.current.set(itemId + ":" + view, node.scrollTop);
      toc.current?.destroy(); toc.current = null;
    };
  }, [reading, itemId, view]);

  const pureMd = detail && !detail.item.formats.html && !detail.item.formats.mhtml;
  const views: [typeof view, string][] = [["reader", "阅读视图"], ["original", pureMd ? "源文本" : "原网页"], ...(!pureMd && detail?.item.formats.markdown ? [["markdown", "Markdown"] as [typeof view, string]] : [])];
  useEffect(() => {
    const command = (event: Event) => {
      const name = (event as CustomEvent<string>).detail;
      if (name === "next-hit") reading?.find?.next(1);
      if (name === "previous-hit") reading?.find?.next(-1);
      if (name === "previous-article" && detail?.prev) navigate({ item: detail.prev.id });
      if (name === "next-article" && detail?.next) navigate({ item: detail.next.id });
      if (name === "cycle-view" && detail) navigate({ view: views[(views.findIndex(value => value[0] === view) + 1) % views.length][0] });
    };
    window.addEventListener("pageshelf-command", command);
    return () => window.removeEventListener("pageshelf-command", command);
  }, [reading, detail, navigate, view, views]);

  function openMenu(event: React.MouseEvent<HTMLButtonElement>, kind: "font" | "actions") {
    const target = event.currentTarget; const rect = target.getBoundingClientRect();
    setMenu({ kind, target, x: rect.left, y: rect.bottom });
  }
  async function action(id: string) {
    if (!detail) return;
    try {
      if (id === "original") await window.pageshelf?.openOriginal(detail.item.id);
      else if (id === "reveal") await window.pageshelf?.revealInFinder({ itemId: detail.item.id });
      else if (id === "copy") { await navigator.clipboard.writeText(detail.files[0]?.path || ""); library.toast("路径已复制"); }
      else if (id === "info") setInfoOpen(true);
    } catch (reason) { library.toast(errorMessage(reason), true); }
  }
  async function onArticleClick(event: React.MouseEvent) {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a");
    if (!link) return;
    event.preventDefault();
    const wiki = link.dataset.wikilink;
    if (wiki) { navigate({ item: wiki }); return; }
    const href = link.getAttribute("href") || "";
    if (href.startsWith("#")) { toc.current?.jump(href.slice(1)); return; }
    if (!/^https?:\/\//i.test(href)) return;
    const accepted = await library.confirm({ title: "打开外部链接？", message: "将在默认浏览器中打开：\n" + href, confirmLabel: "打开链接" });
    if (accepted) try { await window.pageshelf?.openExternal(href, true); } catch (reason) { library.toast(errorMessage(reason), true); }
  }

  if (!itemId) return <div className="empty-state"><h2>选择一篇资料</h2><p>正文、目录和系列导航会在这里展开。</p><p>j / k 选择 · Enter 打开 · / 搜索</p><button type="button" onClick={() => document.querySelector<HTMLInputElement>("#search-input")?.focus()}>搜索资料</button></div>;
  if (error) return <div className="empty-state" role="alert"><h2>正文加载失败</h2><p>{error}</p><button onClick={() => setRetry(value => value + 1)}>重试</button></div>;
  return <>
    <div className="reader-toolbar" aria-label="阅读工具栏">
      <div role="tablist" aria-label="阅读视图" className="view-tabs">{views.map(([value, label], index) => <button type="button" key={value} role="tab" aria-selected={view === value} tabIndex={view === value ? 0 : -1} data-view={value} onClick={() => navigate({ view: value })} onKeyDown={event => { if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return; event.preventDefault(); const next = (index + (event.key === "ArrowRight" ? 1 : views.length - 1)) % views.length; navigate({ view: views[next][0] }); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus(); }}>{label}</button>)}</div>
      <button type="button" title="本页目录" aria-label="本页目录" disabled={!reading?.toc.length} onClick={() => setTocOpen(true)}>目录</button>
      <button type="button" className="icon-button" title="调整正文字号" aria-label="调整正文字号" aria-expanded={menu?.kind === "font"} onClick={event => openMenu(event, "font")}>Aa</button>
      <button type="button" className="icon-button" title="文章操作" aria-label="文章操作" aria-expanded={menu?.kind === "actions"} disabled={!detail} onClick={event => openMenu(event, "actions")}>⋯</button>
    </div>
    {query && reading?.find ? <div className="reader-hits"><span>{hit || 0}/{reading.find.total} 处正文命中</span><button type="button" aria-label="上一个正文命中" disabled={!reading.find.total} onClick={() => reading.find?.next(-1)}>↑</button><button type="button" aria-label="下一个正文命中" disabled={!reading.find.total} onClick={() => reading.find?.next(1)}>↓</button></div> : null}
    <div ref={scroll} className="reader-scroll" tabIndex={0} aria-label="正文滚动区" aria-busy={loading}>
      {loading ? skeleton ? <div className="skeleton-row" aria-label="正在加载正文"><span /><span /><span /></div> : <p className="loading-label" role="status">正在加载正文…</p> : source !== null ? <pre className="source-text">{source}</pre> : (view === "original" && !pureMd) || reading?.status === "fallback" ? <>
        {reading?.status === "fallback" ? <div className="fallback-banner" role="status">正文抽取失败：{reading.reason}。已显示原网页。<button type="button" onClick={() => setRetry(value => value + 1)}>重试阅读视图</button></div> : null}
        <iframe id="original-frame" className="original-frame" title={(detail?.item.title || "资料") + " 原网页"} sandbox="" referrerPolicy="no-referrer" src={`pageshelf://source/${encodeURIComponent(itemId)}/original`} />
      </> : detail && reading?.article ? <div className="article-column">
        <header className="article-header"><p className="article-meta"><button className="text-button" onClick={() => library.selectRoot(detail.item.rootId)}>{detail.item.rootLabel}</button>{detail.item.series ? <> › <button className="text-button" onClick={() => library.selectSeries(detail.item.rootId, detail.item.series!.key, detail.item.series!.name)}>{detail.item.series.name}</button></> : null}</p><h1>{detail.item.title}</h1><p className="article-meta">{[detail.item.author, formatDate(detail.item.updatedAt), `约 ${detail.item.readingMinutes} 分钟`, ...detail.item.tags].filter(Boolean).join(" · ")}</p></header>
        <div ref={articleHost} onClick={event => void onArticleClick(event)} />
        {detail.series ? <nav className="series-navigation" aria-label="系列篇目"><span>{detail.series.name} · 共 {detail.series.total} 篇</span><div><button type="button" data-prev-item={detail.prev?.id || ""} disabled={!detail.prev} onClick={() => detail.prev && navigate({ item: detail.prev.id })}>← {detail.prev?.title || "已经是第一篇"}</button><button type="button" data-next-item={detail.next?.id || ""} disabled={!detail.next} onClick={() => detail.next && navigate({ item: detail.next.id })}>{detail.next?.title || "已经是最后一篇"} →</button></div></nav> : null}
      </div> : null}
    </div>
    {tocOpen ? <Dialog title="本页目录" onClose={() => setTocOpen(false)}><nav className="toc-links">{reading?.toc.map(heading => <button type="button" key={heading.id} aria-current={heading.id === active ? "location" : undefined} onClick={() => { toc.current?.jump(heading.id); setTocOpen(false); }}>{heading.text}</button>)}</nav></Dialog> : null}
    {infoOpen && detail ? <Dialog title="条目信息" onClose={() => setInfoOpen(false)}><p>{detail.item.title}</p><ul className="file-list">{detail.files.map(file => <li key={file.path}>{file.format} · {file.path} · {file.size} 字节</li>)}</ul></Dialog> : null}
    {menu ? <Menu {...menu} returnFocus={menu.target} onClose={() => setMenu(null)} items={menu.kind === "font" ? FONTS.map(size => ({ kind: "item" as const, id: String(size), label: `${size} px${font === size ? " ✓" : ""}` })) : [{ kind: "item", id: "original", label: "在新窗口打开原网页" }, { kind: "item", id: "reveal", label: "在访达中显示" }, { kind: "item", id: "copy", label: "复制本地路径" }, { kind: "item", id: "info", label: "条目信息" }]} onSelect={id => menu.kind === "font" ? setFont(Number(id)) : void action(id)} /> : null}
  </>;
}
