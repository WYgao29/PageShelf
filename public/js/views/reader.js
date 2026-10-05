import {
  h,
  button,
  bytes,
  formatDate,
  storageGet,
  storageSet,
} from "../dom.js";
import { request } from "../api.js";
import { buildReader } from "../reader/pipeline.js";
import { createToc } from "../reader/toc.js";
import { segmented } from "../components/segmented.js";
import { openMenu } from "../components/menu.js";
import { openDialog } from "../components/dialog.js";
import { toast } from "../components/toast.js";
import { skeleton } from "../components/skeleton.js";
export function mount(container, store, actions) {
  const bar = h("header", { className: "reader-bar" }),
    scroll = h("div", {
      className: "reader-scroll",
      tabIndex: 0,
      "aria-label": "正文滚动区",
    });
  container.append(bar, scroll);
  let serial = 0,
    controller,
    timer,
    lastKey = "",
    state = store.getState(),
    detail,
    reading,
    tocController,
    hitLabel,
    disposed = false;
  const positions = new Map();
  let positionKey = "";
  const font = storageGet("ui.readerFont", 17);
  document.documentElement.style.setProperty(
    "--reader-font",
    ([15, 17, 19, 21].includes(font) ? font : 17) + "px",
  );
  function cleanup() {
    reading?.find?.destroy();
    tocController?.destroy();
    reading = null;
    tocController = null;
    clearTimeout(timer);
  }
  function fontMenu(anchor) {
    openMenu(
      anchor,
      [15, 17, 19, 21].map((size) => ({
        label: size + " px",
        run: () => {
          document.documentElement.style.setProperty(
            "--reader-font",
            size + "px",
          );
          storageSet("ui.readerFont", size);
        },
      })),
    );
  }
  async function trash() {
    const selected = detail;
    if (!selected || state.readOnly) return;
    const message = h("div", { "aria-live": "polite" }),
      confirm = button(
        "移入废纸篓",
        async () => {
          confirm.disabled = true;
          message.replaceChildren();
          try {
            const result = await request(
              "/api/items/" + encodeURIComponent(selected.item.id) + "/trash",
              { method: "POST", body: { confirm: true } },
            );
            await actions.afterTrash(result, selected.next?.id);
            if (result.failed.length) {
              message.append(
                h(
                  "p",
                  { className: "danger-text" },
                  "部分文件未能移入废纸篓。以下文件仍保留：",
                ),
                h(
                  "ul",
                  { className: "file-list" },
                  result.failed.map((file) =>
                    h("li", {}, file.path + "：" + file.message),
                  ),
                ),
              );
              confirm.textContent = "重试剩余文件";
              toast("部分文件未能移入废纸篓", { error: true });
            } else {
              dialog.close();
              toast("已移入废纸篓", {
                action: {
                  label: "打开废纸篓",
                  run: () => actions.reveal({ trash: true }),
                },
              });
            }
          } catch (error) {
            message.append(
              h(
                "p",
                { className: "danger-text", role: "alert" },
                error.message,
              ),
            );
          } finally {
            confirm.disabled = false;
          }
        },
        { className: "danger" },
      );
    const dialog = openDialog({
      title: "移入废纸篓？",
      content: [
        h(
          "p",
          {},
          "“" +
            selected.item.title +
            "”的全部关联源文件将移入 macOS 废纸篓，可在访达中放回原处。",
        ),
        h(
          "ul",
          { className: "file-list" },
          selected.files.map((file) =>
            h("li", {}, file.path + " · " + bytes(file.size)),
          ),
        ),
        message,
      ],
      footer: [button("取消", () => dialog.close()), confirm],
    });
  }
  function menu(anchor) {
    if (!detail) return;
    const item = detail.item;
    openMenu(anchor, [
      {
        label: "在新标签页打开原网页",
        run: () =>
          window.open(
            "/api/items/" + encodeURIComponent(item.id) + "/original",
            "_blank",
            "noopener",
          ),
      },
      ...Object.keys(item.formats)
        .filter((format) => item.formats[format])
        .map((format) => ({
          label:
            "下载 " +
            (format === "markdown" ? "Markdown" : format.toUpperCase()) +
            " 原文件",
          run: () => {
            const link = h("a", {
              href:
                "/api/items/" +
                encodeURIComponent(item.id) +
                "/download/" +
                format,
              download: "",
            });
            document.body.append(link);
            link.click();
            link.remove();
          },
        })),
      { label: "在访达中显示", run: () => actions.reveal({ itemId: item.id }) },
      {
        label: "复制本地路径",
        run: () => actions.copyPath(detail.files[0]?.path || ""),
      },
      {
        label: "条目信息",
        run: () =>
          openDialog({
            title: "条目信息",
            content: [
              h("p", {}, item.title),
              h(
                "p",
                { className: "muted" },
                item.rootLabel +
                  " · " +
                  formatDate(item.updatedAt) +
                  " · " +
                  bytes(item.size),
              ),
              h(
                "ul",
                { className: "file-list" },
                detail.files.map((file) =>
                  h(
                    "li",
                    {},
                    file.format + " · " + file.path + " · " + bytes(file.size),
                  ),
                ),
              ),
            ],
          }),
      },
      null,
      {
        label: "移入废纸篓…",
        run: trash,
        danger: true,
        disabled: state.readOnly,
      },
    ]);
  }
  function renderBar() {
    if (!detail) return;
    const item = detail.item,
      pureMd = !item.html && !item.mhtml;
    const crumbs = h(
      "div",
      { className: "reader-crumb truncate" },
      button(item.rootLabel, () => actions.selectRoot(item.rootId), {
        className: "text-button",
      }),
      " › ",
      item.series
        ? button(
            item.series.name,
            () => actions.selectSeries(item.rootId, item.series.key),
            { className: "text-button" },
          )
        : item.directory === "/"
          ? "单篇"
          : item.directory,
      item.series
        ? " › 第 " + item.series.position + " / " + item.series.total + " 篇"
        : "",
    );
    const choices = pureMd
      ? [
          { value: "reader", label: "阅读视图" },
          { value: "original", label: "源文本" },
        ]
      : [
          { value: "reader", label: "阅读视图" },
          { value: "original", label: "原网页" },
          ...(item.markdown ? [{ value: "markdown", label: "Markdown" }] : []),
        ];
    hitLabel = h(
      "span",
      { className: "find-count" },
      "「" +
        state.route.q +
        "」" +
        (reading?.find?.current ? reading.find.current + "/" : "") +
        (reading?.find?.total || 0) +
        " 处",
    );
    const hits = h(
      "div",
      { className: "reader-hits", hidden: !state.route.q },
      hitLabel,
      button("↑", () => reading?.find?.next(-1), {
        className: "icon-button",
        "aria-label": "上一个正文命中",
        disabled: !reading?.find?.total,
      }),
      button("↓", () => reading?.find?.next(1), {
        className: "icon-button",
        "aria-label": "下一个正文命中",
        disabled: !reading?.find?.total,
      }),
    );
    bar.replaceChildren(
      crumbs,
      segmented("阅读视图", choices, state.route.view, (value) =>
        actions.navigate({ view: value }),
      ),
      hits,
      button(
        "目录 ▾",
        (event) =>
          openMenu(
            event.currentTarget,
            (reading?.toc || []).map((value) => ({
              label: value.text,
              run: () => tocController?.jump(value.id),
            })),
          ),
        { className: "toc-dropdown", hidden: !reading?.toc?.length },
      ),
      button("Aa", (event) => fontMenu(event.currentTarget), {
        className: "icon-button",
        "aria-label": "调整正文字号",
      }),
      button("⋯", (event) => menu(event.currentTarget), {
        className: "icon-button",
        "aria-label": "文章操作",
      }),
    );
    bar
      .querySelectorAll(".segmented button")
      .forEach((node, index) => (node.dataset.view = choices[index].value));
  }
  function original(reason) {
    cleanup();
    renderBar();
    scroll.replaceChildren();
    if (reason)
      scroll.append(
        h(
          "div",
          { className: "fallback-banner", role: "status" },
          "正文抽取失败：" + reason + "。已显示原网页。",
          button("重试阅读视图", retry, { className: "text-button" }),
        ),
      );
    scroll.append(
      h("iframe", {
        id: "original-frame",
        title: detail.item.title + " 原网页",
        src: "/api/items/" + encodeURIComponent(detail.item.id) + "/original",
        sandbox: "",
        className: "original-frame",
      }),
    );
  }
  function navigation() {
    const item = detail.item;
    if (!item.series) return null;
    const previous = detail.prev,
      next = detail.next;
    const progress = h("span");
    progress.style.width =
      (item.series.position / item.series.total) * 100 + "%";
    return h(
      "nav",
      { className: "series-navigation", "aria-label": "系列篇目" },
      h(
        "div",
        { className: "series-progress" },
        h(
          "span",
          {},
          item.series.name +
            " · 第 " +
            item.series.position +
            "/" +
            item.series.total +
            " 篇",
        ),
        h("div", { className: "progress" }, progress),
      ),
      h(
        "div",
        { className: "series-neighbors" },
        button(
          [
            h("small", {}, "← 上一篇"),
            h("strong", {}, previous?.title || "已经是第一篇"),
          ],
          () => actions.openItem(previous?.id),
          { disabled: !previous, "data-prev-item": previous?.id || "" },
        ),
        button(
          [
            h("small", {}, "下一篇 →"),
            h("strong", {}, next?.title || "已经是最后一篇"),
          ],
          () => actions.openItem(next?.id),
          { disabled: !next, "data-next-item": next?.id || "" },
        ),
      ),
    );
  }
  async function load() {
    const generation = ++serial,
      route = { ...state.route };
    controller?.abort();
    controller = new AbortController();
    if (positionKey) positions.set(positionKey, scroll.scrollTop);
    positionKey = route.item + ":" + route.view;
    cleanup();
    detail = null;
    bar.replaceChildren(h("span", { className: "muted" }, "正在加载资料…"));
    timer = setTimeout(() => {
      if (generation === serial) scroll.replaceChildren(skeleton());
    }, 300);
    try {
      const received = await request(
        "/api/items/" + encodeURIComponent(route.item),
        { signal: controller.signal },
      );
      if (generation !== serial) return;
      detail = received;
      const pureMd = !detail.item.html && !detail.item.mhtml;
      if (route.view === "original" && !pureMd) {
        clearTimeout(timer);
        original();
        restorePosition();
        store.set({ detail });
        return;
      }
      const useMarkdown = pureMd || route.view === "markdown",
        content = await request(
          "/api/items/" +
            encodeURIComponent(route.item) +
            (useMarkdown ? "/source/markdown" : "/document"),
          { signal: controller.signal },
        );
      if (generation !== serial) return;
      if (route.view === "original" && pureMd) {
        clearTimeout(timer);
        renderBar();
        scroll.replaceChildren(h("pre", { className: "source-text" }, content));
        restorePosition();
        store.set({ detail });
        return;
      }
      let wikiItems = [];
      if (useMarkdown && content.includes("[[")) {
        let offset = 0;
        while (true) {
          const batch = await request(
            "/api/items?" +
              new URLSearchParams({
                roots: detail.item.rootId,
                limit: "500",
                offset: String(offset),
              }),
            { signal: controller.signal },
          );
          wikiItems.push(...batch.items);
          offset += batch.items.length;
          if (offset >= batch.total || !batch.items.length) break;
        }
      }
      const built = await buildReader({
        item: detail.item,
        html: useMarkdown ? undefined : content,
        markdown: useMarkdown ? content : undefined,
        items: wikiItems,
        query: route.q,
        onFindChange: (position, total) => {
          if (hitLabel)
            hitLabel.textContent =
              "「" + route.q + "」" + position + "/" + total + " 处";
        },
      });
      if (generation !== serial) {
        built.find?.destroy();
        return;
      }
      clearTimeout(timer);
      if (built.status === "fallback") {
        original(built.reason);
        store.set({ detail });
        return;
      }
      reading = built;
      renderBar();
      const item = detail.item,
        toc = h(
          "aside",
          { className: "article-toc", "aria-label": "本页目录" },
          h("strong", {}, "本页目录"),
        );
      const tocButtons = new Map();
      for (const value of built.toc) {
        const node = button(value.text, () => tocController?.jump(value.id), {
          className: "toc-link level-" + value.level,
          "data-heading-id": value.id,
        });
        tocButtons.set(value.id, node);
        toc.append(node);
      }
      toc.hidden = !built.toc.length;
      const articleHeader = h(
        "header",
        { className: "article-header" },
        item.series
          ? h(
              "div",
              { className: "article-kicker" },
              item.series.name + " · 第 " + item.series.index + " 讲",
            )
          : null,
        h("h1", {}, item.title),
        h(
          "p",
          { className: "article-meta" },
          [
            item.site === "newtype"
              ? "newtype"
              : item.site === "zsxq"
                ? "知识星球"
                : item.site === "markdown"
                  ? "Markdown"
                  : item.site === "article"
                    ? "本地文章"
                    : "本地资料",
            item.author,
            item.publishedAt || formatDate(item.updatedAt),
            "约 " + item.readingMinutes + " 分钟",
            Object.keys(item.formats)
              .filter((format) => item.formats[format])
              .map((format) =>
                format === "markdown" ? "MD" : format.toUpperCase(),
              )
              .join(" · "),
            bytes(item.size),
          ]
            .filter(Boolean)
            .join(" · "),
        ),
      );
      scroll.replaceChildren(
        h(
          "div",
          { className: "reader-columns" },
          h(
            "div",
            { className: "article-column" },
            articleHeader,
            built.article,
            navigation(),
          ),
          toc,
        ),
      );
      tocController = createToc({
        article: built.article,
        scrollContainer: scroll,
        onActive: (id) =>
          tocButtons.forEach((node, key) =>
            node.setAttribute(
              "aria-current",
              key === id ? "location" : "false",
            ),
          ),
      });
      built.article.addEventListener("click", (event) => {
        const link = event.target.closest("a[data-wikilink]");
        if (link) {
          event.preventDefault();
          actions.openItem(link.dataset.wikilink);
        }
      });
      restorePosition();
      store.set({ detail });
    } catch (error) {
      if (error.name === "AbortError" || generation !== serial) return;
      clearTimeout(timer);
      cleanup();
      bar.replaceChildren();
      scroll.replaceChildren(
        h(
          "div",
          { className: "empty-state" },
          h("h2", {}, error.status === 404 ? "源文件已不存在" : "正文加载失败"),
          h("p", {}, error.message),
          button("重试", retry, { className: "primary" }),
        ),
      );
    }
  }
  function restorePosition() {
    requestAnimationFrame(() => {
      scroll.scrollTop = positions.get(positionKey) || 0;
    });
  }
  function retry() {
    lastKey = "";
    update(store.getState());
  }
  function update(next) {
    state = next;
    const route = state.route,
      key = JSON.stringify([
        route.item,
        route.view,
        route.q,
        state.indexRevision,
      ]);
    if (!route.item) {
      if (lastKey) {
        serial++;
        controller?.abort();
        cleanup();
        detail = null;
      }
      lastKey = "";
      bar.replaceChildren();
      scroll.replaceChildren(
        h(
          "div",
          { className: "empty-state" },
          h("div", { className: "empty-icon", "aria-hidden": true }, "▤"),
          h("h2", {}, "选择一篇资料"),
          h("p", {}, "正文、目录和系列导航会在这里展开。"),
          h("p", { className: "mono" }, "j / k 选择 · Enter 打开 · / 搜索"),
        ),
      );
      return;
    }
    if (key !== lastKey) {
      lastKey = key;
      load();
    } else if (detail) renderBar();
  }
  return {
    update,
    retry,
    trash,
    nextHit: (direction) => reading?.find?.next(direction),
    neighbor: (direction) => {
      const next = direction < 0 ? detail?.prev : detail?.next;
      if (next) actions.openItem(next.id);
    },
    getDetail: () => detail,
    unmount() {
      disposed = true;
      serial++;
      controller?.abort();
      cleanup();
      container.replaceChildren();
    },
  };
}
