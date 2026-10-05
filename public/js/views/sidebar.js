import { h, button, formatDate } from "../dom.js";
import { request } from "../api.js";
import { openMenu } from "../components/menu.js";
import { toast } from "../components/toast.js";
export function mount(container, store, actions) {
  const body = h("div", { className: "sidebar-scroll" }),
    footer = h("footer", { className: "sidebar-footer" }),
    theme = button("◐", actions.cycleTheme, {
      className: "icon-button",
      "aria-label": "切换主题",
    });
  container.append(
    h(
      "div",
      { className: "brand" },
      h(
        "span",
        { className: "brand-logo", "aria-hidden": true },
        h("i"),
        h("i"),
        h("i"),
      ),
      h("strong", {}, "我的对话库"),
      theme,
    ),
    body,
    footer,
  );
  const expanded = new Set(),
    series = new Map();
  let editing = false,
    state = store.getState(),
    lastRevision;
  async function rename(root, anchor) {
    if (state.readOnly) return;
    editing = true;
    const input = h("input", {
      "aria-label": "目录名称",
      value: root.label,
      className: "inline-label",
      maxlength: 80,
    });
    anchor.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      try {
        if (save && input.value !== root.label)
          await actions.changeRoot(root.id, { label: input.value });
      } catch (error) {
        toast(error.message, { error: true });
      } finally {
        editing = false;
        update(store.getState());
      }
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
  }
  function rootMenu(root, anchor, event) {
    openMenu(
      anchor,
      [
        {
          label: "重扫此目录",
          run: () => actions.scan(root.id),
          disabled: state.busyScan,
        },
        {
          label: "重命名",
          run: () =>
            rename(
              root,
              anchor.closest(".root-row").querySelector(".root-name"),
            ),
          disabled: state.readOnly,
        },
        {
          label: "在访达中显示",
          run: () => actions.reveal({ rootId: root.id }),
        },
        ...(!["ok", "warning", "scanning", "disabled"].includes(
          root.state.status,
        )
          ? [
              {
                label: "重新定位…",
                run: () => actions.openManager({ relocateId: root.id }),
                disabled: state.readOnly,
              },
            ]
          : []),
        {
          label: root.enabled ? "停用" : "启用",
          run: () => actions.changeRoot(root.id, { enabled: !root.enabled }),
          disabled: state.readOnly,
        },
        {
          label: "移除…",
          run: () => actions.removeRoot(root),
          danger: true,
          disabled: state.readOnly,
        },
      ],
      event,
    );
  }
  async function loadSeries(root) {
    if (series.has(root.id)) return;
    series.set(root.id, []);
    try {
      const data = await request(
        "/api/roots/" + encodeURIComponent(root.id) + "/series",
      );
      series.set(
        root.id,
        data.series.sort((a, b) =>
          a.name.localeCompare(b.name, "zh-CN", { numeric: true }),
        ),
      );
      if (!editing) update(store.getState());
    } catch (error) {
      toast(error.message, { error: true });
    }
  }
  function update(next) {
    state = next;
    if (editing) return;
    if (lastRevision !== state.indexRevision) {
      series.clear();
      lastRevision = state.indexRevision;
    }
    const route = state.route;
    body.replaceChildren(
      button(
        [
          h("span", {}, "✦ 全部目录"),
          h("span", { className: "root-count" }, state.totals.items || 0),
        ],
        () => actions.selectRoot(""),
        {
          "data-all-roots": "",
          className: "all-roots" + (!route.rootId ? " active" : ""),
          "aria-current": !route.rootId ? "page" : undefined,
        },
      ),
      h(
        "div",
        { className: "source-heading" },
        h("span", {}, "来源目录"),
        button("管理", () => actions.openManager(), {
          className: "text-button",
          "data-open-manager": "",
        }),
      ),
    );
    if (!state.roots.length)
      body.append(h("p", { className: "no-roots" }, "还没有来源目录"));
    for (const root of state.roots) {
      const selected = route.rootId === root.id,
        isExpanded = selected || expanded.has(root.id),
        progress = state.scan.running.find((x) => x.rootId === root.id),
        status = root.state.status,
        invalid = !["ok", "warning", "scanning", "disabled"].includes(status);
      const name = h(
        "span",
        {
          className: "root-name truncate",
          onDblclick: (event) => {
            event.stopPropagation();
            rename(root, event.currentTarget);
          },
        },
        root.label,
      );
      const nav = button(
        [
          h(
            "span",
            { className: "root-title" },
            h("span", {
              className: "status-dot " + status,
              "aria-hidden": true,
            }),
            name,
          ),
          h(
            "span",
            { className: "root-path mono truncate" },
            progress
              ? `扫描中 ${progress.files.done}/${progress.files.total}…`
              : status === "disabled"
                ? "已停用"
                : root.displayPath,
          ),
        ],
        () => actions.selectRoot(root.id),
        {
          "data-root-id": root.id,
          className: "root-nav",
          "aria-current": selected ? "page" : undefined,
          title:
            root.path +
            "\n" +
            (root.state.message ||
              "上次扫描 " + formatDate(root.state.lastScan?.completedAt)),
        },
      );
      const count = invalid
        ? h(
            "span",
            { className: "badge error" },
            status === "missing"
              ? "目录不存在"
              : status === "denied"
                ? "无权限"
                : status === "not_directory"
                  ? "不是文件夹"
                  : "扫描失败",
          )
        : h(
            "span",
            { className: "root-count" },
            status === "disabled" ? "" : root.counts.items,
          );
      const more = button("⋯", (event) => rootMenu(root, event.currentTarget), {
        className: "icon-button root-more",
        "aria-label": root.label + "操作",
      });
      const row = h(
        "div",
        {
          className: "root-row" + (selected ? " active" : ""),
          onContextmenu: (event) => {
            event.preventDefault();
            rootMenu(root, more, event);
          },
        },
        button(
          isExpanded ? "▾" : "▸",
          () => {
            expanded.has(root.id)
              ? expanded.delete(root.id)
              : expanded.add(root.id);
            update(state);
          },
          {
            className: "root-chevron icon-button",
            "aria-label": "展开 " + root.label,
            "aria-expanded": isExpanded,
          },
        ),
        nav,
        count,
        more,
      );
      body.append(row);
      if (isExpanded && !invalid && root.enabled) {
        loadSeries(root);
        const all = series.get(root.id) || [],
          moreExpanded = expanded.has(root.id + ":more"),
          visible = moreExpanded ? all : all.slice(0, 12);
        body.append(
          h(
            "div",
            { className: "root-series" },
            visible.map((value) =>
              button(
                [
                  h("span", { className: "truncate" }, value.name),
                  h("span", { className: "mono" }, value.total),
                ],
                () => actions.selectSeries(root.id, value.key),
                {
                  "data-series-key": value.key,
                  className:
                    "series-link" +
                    (route.seriesKey === value.key ? " active" : ""),
                  "aria-current":
                    route.seriesKey === value.key ? "page" : undefined,
                },
              ),
            ),
            all.length > 12 && !moreExpanded
              ? button(
                  "更多 " + (all.length - 12) + " 个",
                  () => {
                    expanded.add(root.id + ":more");
                    update(state);
                  },
                  { className: "text-button" },
                )
              : null,
          ),
        );
      }
    }
    footer.replaceChildren(
      button("＋ 添加目录", () => actions.openManager({ focusAdd: true }), {
        className: "add-source",
      }),
      h(
        "div",
        { className: "sidebar-bottom" },
        button("⚙ 设置", () => actions.openManager(), {
          className: "text-button",
        }),
        button("↻ 全部重扫", () => actions.scan(), {
          className: "text-button",
          disabled: state.busyScan,
        }),
        h(
          "span",
          { className: "last-scanned mono" },
          state.busyScan
            ? "扫描中"
            : "上次 " +
                formatDate(
                  state.roots
                    .map((x) => x.state.lastScan?.completedAt)
                    .filter(Boolean)
                    .sort()
                    .at(-1),
                ),
        ),
      ),
    );
  }
  return {
    update,
    unmount() {
      container.replaceChildren();
    },
    collapse: () => document.body.classList.toggle("sidebar-collapsed"),
  };
}
