import { h, button, highlighted, formatDate } from "../dom.js";
import { request } from "../api.js";
import { segmented } from "../components/segmented.js";
import { openMenu } from "../components/menu.js";
import { toast } from "../components/toast.js";
export function mount(container, store, actions) {
  const search = h("input", {
      id: "search-input",
      type: "search",
      placeholder: "搜索标题、正文、标签…",
      "aria-label": "搜索资料",
      autocomplete: "off",
    }),
    clear = button(
      "×",
      () => {
        search.value = "";
        search.dispatchEvent(new Event("input", { bubbles: true }));
        search.focus();
      },
      { className: "icon-button", "aria-label": "清空搜索" },
    ),
    scope = h("div", { className: "search-scope" }),
    info = h("div", { className: "result-info", "aria-live": "polite" }),
    sort = h(
      "select",
      { id: "sort-select", "aria-label": "排序" },
      [
        ["updated", "最近更新"],
        ["title", "标题"],
        ["series", "系列顺序"],
        ["relevance", "相关度"],
      ].map(([value, label]) => h("option", { value }, label)),
    ),
    filters = h("div", { className: "filter-chips" }),
    rows = h("div", {
      id: "list-rows",
      className: "list-scroll",
      "aria-label": "文章结果",
    });
  container.append(
    h(
      "header",
      { className: "list-header" },
      h(
        "div",
        { className: "search-box" },
        h("span", { "aria-hidden": true }, "⌕"),
        search,
        clear,
        h("kbd", {}, "⌘K"),
      ),
      scope,
      h("div", { className: "result-line" }, info, sort),
      filters,
    ),
    rows,
  );
  let timer,
    serial = 0,
    controller,
    observer,
    lastKey = "",
    lastRenderedItems,
    lastGroupKey = "",
    state = store.getState(),
    loadingMore = false,
    lastRouteQ = null;
  const expanded = new Set();
  search.addEventListener("input", () => {
    clearTimeout(timer);
    const value = search.value;
    timer = setTimeout(
      () =>
        actions.navigate(
          { q: value, sort: value ? "relevance" : "updated" },
          { replace: true },
        ),
      150,
    );
  });
  sort.addEventListener("change", () => actions.navigate({ sort: sort.value }));
  function query(state) {
    const route = state.route;
    return {
      q: route.q,
      roots:
        route.rootId && !(route.q && route.scope === "all") ? route.rootId : "",
      series: route.q && route.scope === "all" ? "" : route.seriesKey,
      folder: route.folder,
      fmt: route.fmt,
      kind: route.kind,
      sort: route.sort,
    };
  }
  async function fetchPage(reset) {
    if (!reset && loadingMore) return;
    const generation = reset ? ++serial : serial;
    if (reset) {
      controller?.abort();
      controller = new AbortController();
      store.set({ loading: true, listError: "" });
    } else loadingMore = true;
    try {
      const current = store.getState(),
        params = new URLSearchParams({
          ...query(current),
          limit: "100",
          offset: reset ? "0" : String(current.items.length),
        }),
        data = await request("/api/items?" + params, {
          signal: controller.signal,
        });
      if (generation !== serial) return;
      const items = reset
          ? data.items
          : [
              ...current.items,
              ...data.items.filter(
                (value) => !current.items.some((item) => item.id === value.id),
              ),
            ],
        groups = reset
          ? data.groups
          : current.groups.map((group) => ({
              ...group,
              itemIds: group.itemIds.slice(),
            }));
      if (!reset)
        for (const group of data.groups) {
          const existing = groups.find(
            (x) => x.rootId === group.rootId && x.seriesKey === group.seriesKey,
          );
          existing
            ? existing.itemIds.push(
                ...group.itemIds.filter((id) => !existing.itemIds.includes(id)),
              )
            : groups.push(group);
        }
      store.set({
        items,
        total: data.total,
        resultRoots: data.roots,
        groups,
        loading: false,
        listError: "",
        listResultRevision: (current.listResultRevision || 0) + 1,
      });
    } catch (error) {
      if (error.name === "AbortError" || generation !== serial) return;
      store.set({ loading: false, listError: error.message });
    } finally {
      loadingMore = false;
    }
  }
  function itemRow(item) {
    const selected =
        state.route.item === item.id || state.focusedItem === item.id,
      titleHighlight = item.highlights?.find((x) => x.field === "title"),
      bodyHighlight = item.highlights?.find((x) => x.field === "body");
    const root = state.roots.find((x) => x.id === item.rootId);
    const badges = Object.keys(item.formats || {})
      .filter((format) => item.formats[format])
      .map((format) => (format === "markdown" ? "MD" : format.toUpperCase()))
      .join(" · ");
    const node = button(
      [
        h(
          "span",
          { className: "item-title" },
          highlighted(item.title, titleHighlight?.ranges),
        ),
        h(
          "span",
          { className: "item-meta" },
          !state.route.rootId || state.route.scope === "all"
            ? h(
                "span",
                {
                  className:
                    "badge " +
                    ["", "amber", "blue", "plum"][(root?.order || 0) % 4],
                },
                item.rootLabel,
              )
            : null,
          item.series
            ? " " +
                String(item.series.index).padStart(2, "0") +
                "/" +
                item.series.total +
                " · "
            : " ",
          badges + " · " + formatDate(item.updatedAt),
          state.route.q
            ? h(
                "span",
                { className: "hit-count" },
                " · 命中 " + item.hits + " 处",
              )
            : null,
        ),
        h(
          "span",
          { className: "item-excerpt" },
          highlighted(
            bodyHighlight?.text || item.excerpt || "暂无摘要",
            bodyHighlight?.ranges,
          ),
        ),
      ],
      (event) => {
        if (event.metaKey || event.ctrlKey) {
          window.open(
            "/api/items/" + encodeURIComponent(item.id) + "/original",
            "_blank",
            "noopener",
          );
          return;
        }
        actions.openItem(item.id);
      },
      {
        className: "item-row" + (selected ? " active" : ""),
        "data-item-id": item.id,
        "aria-pressed": selected,
        title: item.relativePath,
      },
    );
    node.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openMenu(
        node,
        [
          {
            label: "在新标签页打开原网页",
            run: () =>
              window.open(
                "/api/items/" + encodeURIComponent(item.id) + "/original",
                "_blank",
                "noopener",
              ),
          },
          {
            label: "在访达中显示",
            run: () => actions.reveal({ itemId: item.id }),
          },
          { label: "复制路径", run: () => actions.copyItemPath(item.id) },
        ],
        event,
      );
    });
    return node;
  }
  function renderRows() {
    observer?.disconnect();
    const start = performance.now();
    rows.replaceChildren();
    if (state.listError) {
      rows.append(
        h(
          "div",
          { className: "empty-state" },
          h("h2", {}, "无法连接本地知识库"),
          h("p", {}, state.listError),
          button("重试", () => fetchPage(true)),
        ),
      );
      return;
    }
    if (!state.items.length) {
      const root = state.roots.find((value) => value.id === state.route.rootId),
        invalid =
          root && !["ok", "warning", "scanning"].includes(root.state.status),
        filtered = !!(state.route.fmt || state.route.kind);
      const title = state.loading
        ? "正在加载资料…"
        : !state.roots.length
          ? "从一个文件夹开始"
          : invalid
            ? root.state.status === "disabled"
              ? "目录已停用"
              : root.state.message || "目录不可用"
            : state.route.q
              ? "没有找到匹配内容"
              : filtered
                ? "筛选结果为空"
                : "这个目录还没有资料";
      const label = invalid
        ? root.enabled
          ? "重新定位…"
          : "启用"
        : state.route.q
          ? "清空搜索"
          : filtered
            ? "清除筛选"
            : "添加目录";
      const reset = () =>
        invalid
          ? root.enabled
            ? actions.openManager({ relocateId: root.id })
            : actions.changeRoot(root.id, { enabled: true })
          : state.route.q
            ? actions.navigate({ q: "" }, { replace: true })
            : filtered
              ? actions.navigate({ fmt: "", kind: "" })
              : actions.openManager({ focusAdd: true });
      rows.append(
        h(
          "div",
          { className: "empty-state" },
          h("div", { className: "empty-icon", "aria-hidden": true }, "⌕"),
          h("h2", {}, title),
          h(
            "p",
            {},
            state.route.q
              ? "试试更短的关键词，或扩大搜索范围。"
              : filtered
                ? "清除筛选即可查看这个范围的全部资料。"
                : "支持 HTML、MHTML 和 Markdown，源文件保留在原目录。",
          ),
          button(label, reset, { className: "primary" }),
          invalid && root.enabled
            ? button("移除来源", () => actions.removeRoot(root))
            : null,
        ),
      );
      return;
    }
    const map = new Map(state.items.map((item) => [item.id, item]));
    if (state.groups.length) {
      for (const group of state.groups) {
        const key = group.rootId + ":" + group.seriesKey,
          all = group.itemIds.map((id) => map.get(id)).filter(Boolean),
          visible = expanded.has(key) ? all : all.slice(0, 6);
        rows.append(
          h(
            "div",
            { className: "group-heading" },
            h("strong", {}, group.label),
            h(
              "span",
              { className: "mono muted" },
              all.length + " 篇" + (group.kind === "series" ? " · 按序号" : ""),
            ),
          ),
        );
        visible.forEach((item) => rows.append(itemRow(item)));
        if (all.length > 6 && !expanded.has(key))
          rows.append(
            button(
              "展开其余 " +
                (all.length - 6) +
                " 篇" +
                (state.route.q ? "（均命中）" : ""),
              () => {
                expanded.add(key);
                renderRows();
              },
              { className: "expand-group" },
            ),
          );
      }
    } else state.items.forEach((item) => rows.append(itemRow(item)));
    if (state.items.length < state.total) {
      const more = button(
        "载入更多 · " + state.items.length + "/" + state.total,
        () => fetchPage(false),
        { className: "load-more" },
      );
      rows.append(more);
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) fetchPage(false);
        },
        { root: rows, rootMargin: "100px" },
      );
      observer.observe(more);
    }
    if (state.items.length <= 100) {
      performance.measure("library-first-100-dom", {
        start,
        end: performance.now(),
      });
      requestAnimationFrame(() =>
        performance.measure("library-first-100-frame", {
          start,
          end: performance.now(),
        }),
      );
    }
  }
  function update(next) {
    state = next;
    const route = state.route,
      root = state.roots.find((x) => x.id === route.rootId);
    if (lastRouteQ !== route.q) {
      lastRouteQ = route.q;
      search.value = route.q;
    }
    clear.hidden = !search.value;
    sort.value = route.sort;
    scope.hidden = !route.q;
    scope.replaceChildren(
      segmented(
        "搜索范围",
        [
          {
            value: "root",
            label: "当前目录 · " + (root?.label || "未选择"),
            disabled: !root,
          },
          {
            value: "all",
            label: "全部目录（" + (state.totals.available || 0) + "）",
          },
        ],
        route.scope,
        (value) => actions.navigate({ scope: value }, { replace: true }),
      ),
    );
    info.textContent = route.q
      ? "「" +
        route.q +
        "」" +
        state.total +
        " 条结果 · 跨 " +
        (state.resultRoots || 0) +
        " 个目录"
      : (root?.label || "全部目录") + " · " + state.total + " 条";
    filters.replaceChildren(
      ...[
        ["", "全部"],
        ["html", "HTML"],
        ["markdown", "MD"],
      ].map(([value, label]) =>
        button(label, () => actions.navigate({ fmt: value }), {
          className: "chip" + (route.fmt === value ? " active" : ""),
          "aria-pressed": route.fmt === value,
        }),
      ),
      h("span", { className: "filter-divider" }),
      ...["series", "single"].map((value) =>
        button(
          value === "series" ? "系列" : "单篇",
          () => actions.navigate({ kind: route.kind === value ? "" : value }),
          {
            className: "chip" + (route.kind === value ? " active" : ""),
            "aria-pressed": route.kind === value,
          },
        ),
      ),
    );
    const key = JSON.stringify([query(state), state.indexRevision]);
    if (key !== lastKey) {
      lastKey = key;
      expanded.clear();
      fetchPage(true);
      return;
    }
    const groupKey = JSON.stringify([
      route.item,
      state.focusedItem,
      state.loading,
      state.listError,
    ]);
    if (lastRenderedItems !== state.items || lastGroupKey !== groupKey) {
      lastRenderedItems = state.items;
      lastGroupKey = groupKey;
      renderRows();
    }
  }
  function move(direction) {
    const nodes = [...rows.querySelectorAll("[data-item-id]")];
    if (!nodes.length) return;
    let index = nodes.findIndex(
      (node) => node.dataset.itemId === (state.focusedItem || state.route.item),
    );
    index = Math.max(0, Math.min(nodes.length - 1, index + direction));
    const id = nodes[index].dataset.itemId;
    store.set({ focusedItem: id });
    const node = [...rows.querySelectorAll("[data-item-id]")].find(
      (value) => value.dataset.itemId === id,
    );
    node?.focus();
    node?.scrollIntoView({ block: "nearest" });
  }
  return {
    update,
    move,
    openFocused: () =>
      actions.openItem(state.focusedItem || state.items[0]?.id),
    focusSearch: () => search.focus(),
    clearSearch() {
      if (search.value) {
        search.value = "";
        actions.navigate({ q: "" }, { replace: true });
      } else search.blur();
    },
    unmount() {
      clearTimeout(timer);
      controller?.abort();
      observer?.disconnect();
      container.replaceChildren();
    },
  };
}
