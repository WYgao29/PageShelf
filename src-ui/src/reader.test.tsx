import { readFileSync } from "node:fs";
import vm from "node:vm";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { type Item } from "./items";
import { buildReader } from "./reader/pipeline.js";

const item: Item = { id: "a", title: "文章", rootId: "r", rootLabel: "来源甲", relativePath: "notes/a", formats: { html: null, mhtml: null, markdown: { extension: ".md", filename: "a.md", size: 10, updatedAt: "2026-01-01" } }, series: null, site: "markdown", author: null, tags: [], readingMinutes: 1, updatedAt: "2026-01-01", excerpt: "笔记" };
const text = "这是用于验证安全正文抽取的内容，研究需要证据。".repeat(30);
const fixtures = JSON.parse(readFileSync("test/fixtures/xss/cases.json", "utf8")) as { name: string; html: string }[];
beforeEach(() => {
  Object.defineProperty(globalThis, "Readability", { configurable: true, writable: true, value: vm.runInNewContext(readFileSync("src-ui/vendor/readability-0.6.0/Readability.js", "utf8") + "; Readability") });
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
});

describe("reader pipeline", () => {
  for (const fixture of fixtures) it("sanitizes " + fixture.name, async () => {
    const result = await buildReader({ item, html: `<article><p>${text}</p>${fixture.html.replaceAll("__EXTERNAL__", "https://example.test/probe")}</article>` });
    expect(result.status).toBe("reader");
    expect(result.article?.querySelector("script,style,iframe,object,embed,form,link,meta,svg,math,video,input:not([type=checkbox])")).toBeNull();
    for (const node of result.article!.querySelectorAll("*")) for (const attr of node.attributes) expect(attr.name).not.toMatch(/^(?:on|style$|srcset$)/i);
    expect(result.article?.querySelector('img[src^="http"]')).toBeNull();
    for (const link of result.article!.querySelectorAll("a")) expect(link.getAttribute("href") || "").not.toMatch(/^(javascript|data):/i);
    result.find?.destroy();
  });

  it("extracts article, site rules and generic Readability, with short HTML fallback", async () => {
    for (const html of [`<article><h2>章节</h2><p>${text}</p></article>`, `<div class="ql-editor"><h2>章节</h2><p>${text}</p></div>`, `<title>知识星球</title><div class="topic-detail"><h2>章节</h2><p>${text}</p><div class="comment-container">评论删除</div></div>`, `<div id="content"><h2>章节</h2><p>${text}</p><p>${text}</p></div>`]) {
      const result = await buildReader({ item, html, query: "证据" });
      expect(result.status).toBe("reader"); expect(result.toc.length).toBeGreaterThan(0);
      expect(result.find?.total).toBeGreaterThan(0); expect(result.article?.textContent).not.toContain("评论删除");
    }
    const short = await buildReader({ item, html: "<article><p>短文</p></article>" });
    expect(short).toMatchObject({ status: "fallback", reason: "抽取正文不足 200 字" });
  });

  it("keeps short Markdown, GFM, local images and wiki links; replaces remote images", async () => {
    const result = await buildReader({ item, items: [{ ...item, id: "b", relativePath: "notes/target" }], markdown: "---\ntitle: 文档\ntags: [测试]\n---\n# 文档\n\n## 小节\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- [x] 完成\n- 一级\n  - 二级\n\n[[target|双链]] [[missing]]\n\n![图](image.png)\n![远程](https://example.test/image.png)" });
    expect(result.status).toBe("reader"); expect(result.article?.textContent).not.toContain("tags:");
    expect(result.article?.querySelector("table")).not.toBeNull(); expect(result.article?.querySelector('input[type="checkbox"][disabled]')).not.toBeNull();
    expect(result.article?.querySelector("ul ul")).not.toBeNull();
    expect(result.article?.querySelector('[data-wikilink="b"]')).not.toBeNull();
    expect(result.article?.querySelector("img")?.getAttribute("src")).toBe("pageshelf://source/a/asset?path=image.png");
    expect(result.article?.textContent).toContain("外部图片未加载");
  });

  it("finds a phrase spanning inline nodes and wraps backwards", async () => {
    const result = await buildReader({ item, markdown: "## 重复\n\n证据与**方法**，证据与方法。", query: '"证据与方法"' });
    document.body.append(result.article!);
    expect(result.find?.total).toBe(2); expect(result.find?.next(-1)).toBe(2); expect(result.find?.next(1)).toBe(1);
    result.find?.destroy(); expect(result.article?.querySelector("mark.reader-hit")).toBeNull(); result.article?.remove();
  });
});

describe("desktop reader", () => {
  function install(pureMd = true) {
    const selected: Item = { ...item, formats: pureMd ? item.formats : { ...item.formats, html: { extension: ".html", filename: "a.html", size: 10, updatedAt: "2026-01-01" } } };
    const api = { on: () => () => {}, openOriginal: vi.fn(async () => ({})), openExternal: vi.fn(async () => ({})), openTrash: async () => ({}), revealInFinder: async () => ({}), pickFolder: async () => ({}), invoke: vi.fn(async (method: string) => {
      if (method === "items.get") return { item: selected, files: [{ path: "/tmp/a.md", format: "markdown", size: 10 }], prev: { id: "previous", title: "完整系列上一篇" }, next: { id: "next", title: "完整系列下一篇" }, series: { key: "s", name: "系列", total: 20 } };
      if (method === "items.source") return { body: "## 小节\n短笔记 [外部](https://example.test/article)", headers: {} };
      if (method === "items.document") return { body: "<article><p>短文</p></article>", headers: {} };
      if (method === "items.search") return { items: [selected], groups: [], total: 1, roots: 1 };
      return { roots: [] };
    }) };
    window.pageshelf = api; history.replaceState(null, "", "#/?item=a");
    return api;
  }
  it("renders short notes, TOC, font preferences and source text", async () => {
    install(); render(<App />);
    await screen.findByRole("heading", { name: "小节" });
    fireEvent.click(screen.getByLabelText("本页目录"));
    expect(within(screen.getByRole("dialog", { name: "本页目录" })).getByRole("button", { name: "小节" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭弹窗" }));
    fireEvent.click(screen.getByLabelText("调整正文字号")); fireEvent.click(screen.getByRole("menuitem", { name: "21 px" }));
    expect(localStorage.getItem("ui.readerFont")).toBe("21");
    fireEvent.click(screen.getByRole("tab", { name: "源文本" }));
    await waitFor(() => expect(document.querySelector(".source-text")).toHaveTextContent("## 小节"));
  });
  it("falls back to a sandboxed custom-protocol iframe with an explanation", async () => {
    install(false); render(<App />);
    await screen.findByText(/抽取正文不足 200 字/);
    const frame = document.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe(""); expect(frame.src).toBe("pageshelf://source/a/original");
  });
  it("asks before opening external links, and keeps full-series neighbors", async () => {
    const api = install(); render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: "外部" }));
    expect(api.openExternal).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "打开外部链接？" });
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "打开链接" }));
    await waitFor(() => expect(api.openExternal).toHaveBeenCalledWith("https://example.test/article", true));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /完整系列下一篇/ })));
    expect(location.hash).toContain("item=next");
  });
});
