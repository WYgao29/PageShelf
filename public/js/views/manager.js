import { h, button, formatDate, bytes } from "../dom.js";
import { request } from "../api.js";
import { openDialog } from "../components/dialog.js";
import { openMenu } from "../components/menu.js";
import { toast } from "../components/toast.js";
export function mount(container, store, actions) {
  let modal,
    relocateDialog,
    table,
    pathInput,
    labelInput,
    previewHost,
    addButton,
    warning,
    previewTimer,
    previewSerial = 0,
    checked = null,
    state = store.getState();
  const rows = new Map();
  function showPreview(result) {
    checked = result;
    previewHost.replaceChildren();
    if (!result) return;
    for (const error of result.errors || [])
      previewHost.append(h("p", { className: "danger-text" }, error.message));
    if (result.valid)
      previewHost.append(
        h(
          "p",
          { className: "muted" },
          `${result.counts.files} 个文件 · ${result.counts.items} 条资料`,
        ),
      );
    if (result.duplicateLabel)
      previewHost.append(
        h(
          "p",
          { className: "warning-text" },
          "显示名与其他目录相同；资料仍按路径区分。",
        ),
      );
    if (result.overlap)
      previewHost.append(
        h(
          "div",
          { className: "overlap-warning" },
          h("strong", {}, "目录重叠 · 最深目录优先"),
          h("p", {}, result.overlap.message),
          result.overlap.affectedSeries?.length
            ? h(
                "p",
                {},
                "将重新计算：" +
                  result.overlap.affectedSeries
                    .map(
                      (series) => series.name + "（" + series.count + " 篇）",
                    )
                    .join("、"),
              )
            : null,
          result.overlap.parentId
            ? button(
                "不添加，查看父目录",
                () => {
                  modal.close();
                  actions.selectRoot(result.overlap.parentId);
                },
                { className: "text-button" },
              )
            : null,
        ),
      );
    addButton.disabled = !result.valid || state.readOnly;
  }
  async function preview() {
    const serial = ++previewSerial;
    addButton.disabled = true;
    if (!pathInput.value.trim()) {
      showPreview(null);
      return;
    }
    try {
      const data = await request("/api/roots?dryRun=1", {
        method: "POST",
        body: {
          path: pathInput.value,
          label: labelInput.value.trim() || undefined,
        },
      });
      if (serial === previewSerial && modal) showPreview(data);
    } catch (error) {
      if (serial === previewSerial && modal) {
        showPreview(null);
        previewHost.append(h("p", { className: "danger-text" }, error.message));
      }
    }
  }
  const fingerprint = (value) =>
    JSON.stringify([
      value?.path,
      value?.counts,
      value?.overlap?.moved,
      value?.overlap?.parentAfter,
    ]);
  async function add() {
    if (addButton.disabled) return;
    clearTimeout(previewTimer);
    const serial = ++previewSerial,
      input = {
        path: pathInput.value,
        label: labelInput.value.trim() || undefined,
      };
    addButton.disabled = true;
    try {
      const next = await request("/api/roots?dryRun=1", {
        method: "POST",
        body: input,
      });
      if (serial !== previewSerial || !modal) return;
      if (!next.valid) {
        showPreview(next);
        return;
      }
      if (fingerprint(next) !== fingerprint(checked)) {
        showPreview(next);
        previewHost.append(
          h(
            "p",
            { className: "warning-text" },
            "目录内容或归属已变化，请查看更新后的结果，再次点击添加。",
          ),
        );
        return;
      }
      await actions.addRoot(input);
      if (serial === previewSerial && modal) {
        pathInput.value = "";
        labelInput.value = "";
        showPreview(null);
      }
      toast("目录已添加");
    } catch (error) {
      toast(error.message, { error: true });
    } finally {
      if (modal) addButton.disabled = !checked?.valid || state.readOnly;
    }
  }
  async function relocate(root) {
    let previewValue,
      timer,
      serial = 0,
      closed = false;
    const input = h("input", {
        value: root.path,
        "aria-label": "新目录路径",
        className: "full-width",
      }),
      output = h("div", { "aria-live": "polite" });
    const save = button(
      "重新定位",
      async () => {
        clearTimeout(timer);
        const generation = ++serial,
          path = input.value;
        save.disabled = true;
        try {
          const current = await request(
            "/api/roots/" + encodeURIComponent(root.id) + "?dryRun=1",
            { method: "PATCH", body: { path } },
          );
          if (closed || generation !== serial) return;
          if (!current.valid) {
            previewValue = current;
            output.textContent = (current.errors || [])
              .map((value) => value.message)
              .join("；");
            return;
          }
          if (
            previewValue &&
            fingerprint(current) !== fingerprint(previewValue)
          ) {
            previewValue = current;
            output.textContent =
              "归属已变化，请再次确认：" +
              (current.overlap?.message || current.counts.items + " 条资料");
            return;
          }
          await actions.changeRoot(root.id, { path });
          dialog.close();
          toast("目录位置已更新，条目 ID 保持不变");
        } catch (error) {
          if (!closed) output.textContent = error.message;
        } finally {
          if (!closed)
            save.disabled = previewValue?.valid === false || state.readOnly;
        }
      },
      { className: "primary", disabled: state.readOnly },
    );
    const choose = button("选择文件夹…", async () => {
      choose.disabled = true;
      try {
        const result = await request("/api/system/choose-folder", {
          method: "POST",
        });
        if (!result.cancelled && !closed) {
          input.value = result.path;
          input.dispatchEvent(new Event("input"));
        }
      } catch (error) {
        if (!closed) output.textContent = error.message;
      } finally {
        choose.disabled = false;
      }
    });
    const dialog = openDialog({
      title: "重新定位 · " + root.label,
      content: [
        h(
          "p",
          { className: "muted" },
          "选择移动后的目录。内部相对路径不变时，原条目链接继续可用。",
        ),
        input,
        choose,
        output,
      ],
      footer: [button("取消", () => dialog.close()), save],
      onClose: () => {
        closed = true;
        serial++;
        clearTimeout(timer);
        relocateDialog = null;
      },
    });
    relocateDialog = dialog;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const generation = ++serial,
        path = input.value;
      previewValue = null;
      save.disabled = true;
      timer = setTimeout(async () => {
        try {
          const value = await request(
            "/api/roots/" + encodeURIComponent(root.id) + "?dryRun=1",
            { method: "PATCH", body: { path } },
          );
          if (closed || generation !== serial) return;
          previewValue = value;
          output.textContent = value.valid
            ? value.overlap?.message || value.counts.items + " 条资料"
            : (value.errors || []).map((error) => error.message).join("；");
          save.disabled = !value.valid || state.readOnly;
        } catch (error) {
          if (!closed && generation === serial)
            output.textContent = error.message;
        }
      }, 300);
    });
    input.focus();
    input.select();
  }
  function reorder(id, target) {
    const ids = state.roots.map((root) => root.id),
      from = ids.indexOf(id),
      to = ids.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    actions.reorderRoots(ids);
  }
  function rootRow(root) {
    const label = h("input", {
        "data-root-label-input": root.id,
        "aria-label": root.label + "显示名",
        value: root.label,
        className: "root-label-edit",
        disabled: state.readOnly,
      }),
      description = h("div", { className: "manager-path mono" }),
      status = h("div", { className: "manager-status" }),
      stats = h("div", { className: "manager-counts" });
    let saving = false;
    const save = async () => {
      if (
        saving ||
        label.value ===
          (store.getState().roots.find((x) => x.id === root.id)?.label ||
            root.label)
      )
        return;
      saving = true;
      try {
        await actions.changeRoot(root.id, { label: label.value });
      } catch (error) {
        label.value =
          store.getState().roots.find((x) => x.id === root.id)?.label ||
          root.label;
        toast(error.message, { error: true });
      } finally {
        saving = false;
      }
    };
    label.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        save();
        label.blur();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        label.value =
          store.getState().roots.find((x) => x.id === root.id)?.label ||
          root.label;
        label.blur();
      }
    });
    label.addEventListener("blur", save);
    const menu = button(
      "⋯",
      (event) => {
        const value = store.getState().roots.find((x) => x.id === root.id);
        openMenu(event.currentTarget, [
          {
            label: "增量重扫",
            run: () => actions.scan(root.id),
            disabled: state.busyScan,
          },
          {
            label: "全量重扫",
            run: () => actions.scan(root.id, { full: true }),
            disabled: state.busyScan,
          },
          {
            label: "重新定位…",
            run: () => relocate(value),
            disabled: state.readOnly,
          },
          {
            label: value.enabled ? "停用" : "启用",
            run: () => actions.changeRoot(root.id, { enabled: !value.enabled }),
            disabled: state.readOnly,
          },
          {
            label:
              value.options.series === "off" ? "启用系列识别" : "关闭系列识别",
            run: () =>
              actions.changeRoot(root.id, {
                options: {
                  series: value.options.series === "off" ? "auto" : "off",
                },
              }),
            disabled: state.readOnly,
          },
          {
            label: "在访达中显示",
            run: () => actions.reveal({ rootId: root.id }),
          },
          null,
          {
            label: "移除…",
            run: () => actions.removeRoot(value),
            danger: true,
            disabled: state.readOnly,
          },
        ]);
      },
      { className: "icon-button", "aria-label": root.label + "目录操作" },
    );
    const handle = button("⋮⋮", () => {}, {
      className: "drag-handle icon-button",
      draggable: !state.readOnly,
      "aria-label": "拖动或 Alt 加方向键排序",
      disabled: state.readOnly,
    });
    handle.addEventListener("dragstart", (event) =>
      event.dataTransfer.setData("text/plain", root.id),
    );
    const node = h(
      "div",
      { className: "manager-row", "data-manager-root": root.id },
      handle,
      h("div", { className: "manager-name" }, label, description),
      stats,
      status,
      menu,
    );
    node.addEventListener("dragover", (event) => {
      if (!state.readOnly) {
        event.preventDefault();
        node.classList.add("drop-target");
      }
    });
    node.addEventListener("dragleave", () =>
      node.classList.remove("drop-target"),
    );
    node.addEventListener("drop", (event) => {
      event.preventDefault();
      node.classList.remove("drop-target");
      reorder(event.dataTransfer.getData("text/plain"), root.id);
    });
    node.addEventListener("keydown", (event) => {
      if (
        event.altKey &&
        ["ArrowUp", "ArrowDown"].includes(event.key) &&
        !state.readOnly
      ) {
        event.preventDefault();
        const index = state.roots.findIndex((x) => x.id === root.id),
          target = state.roots[index + (event.key === "ArrowUp" ? -1 : 1)];
        if (target) reorder(root.id, target.id);
      }
    });
    return { node, label, description, status, stats, menu };
  }
  function render() {
    warning.textContent =
      state.startupWarning ||
      (state.readOnly ? "当前配置为只读，仍可浏览资料、重扫和清理缓存。" : "");
    warning.hidden = !warning.textContent;
    modal?.element
      .querySelectorAll("[data-global-scan]")
      .forEach((button) => (button.disabled = state.busyScan));
    const currentIds = new Set(state.roots.map((root) => root.id));
    for (const [id, row] of rows)
      if (!currentIds.has(id)) {
        row.node.remove();
        rows.delete(id);
      }
    for (const root of state.roots) {
      let row = rows.get(root.id);
      if (!row) {
        row = rootRow(root);
        rows.set(root.id, row);
      }
      const index = state.roots.indexOf(root);
      if (table.children[index] !== row.node)
        table.insertBefore(row.node, table.children[index] || null);
      if (document.activeElement !== row.label) row.label.value = root.label;
      row.label.disabled = state.readOnly;
      row.description.textContent = root.displayPath;
      row.description.title = root.path;
      row.stats.replaceChildren(
        h("strong", {}, root.counts.items + " 条"),
        h(
          "span",
          { className: "muted" },
          root.counts.html +
            " HTML · " +
            root.counts.mhtml +
            " MHTML · " +
            root.counts.markdown +
            " MD",
        ),
        h(
          "span",
          { className: "mono muted" },
          "上次 " + formatDate(root.state.lastScan?.completedAt),
        ),
      );
      const progress = state.scan.running.find((x) => x.rootId === root.id),
        duplicate =
          state.roots.filter((x) => x.label === root.label).length > 1;
      row.status.replaceChildren(
        h(
          "span",
          { className: "status-caption " + root.state.status },
          progress
            ? `扫描中 ${progress.files.done}/${progress.files.total}`
            : root.state.status === "ok"
              ? "正常"
              : root.state.status === "disabled"
                ? "已停用"
                : root.state.message || "有扫描问题",
        ),
      );
      if (duplicate)
        row.status.append(
          h("span", { className: "badge amber" }, "显示名相同"),
        );
      if (root.state.excludes?.length)
        row.status.append(
          h(
            "span",
            { className: "muted" },
            "排除 " + root.state.excludes.length + " 个子目录",
          ),
        );
      if (root.state.issues?.length)
        row.status.append(
          button(
            root.state.issues.length + " 个问题",
            () =>
              openDialog({
                title: "扫描问题 · " + root.label,
                content: h(
                  "ul",
                  { className: "file-list" },
                  root.state.issues.map((issue) =>
                    h("li", {}, issue.path + "：" + issue.message),
                  ),
                ),
              }),
            { className: "text-button" },
          ),
        );
      if (progress) {
        const bar = h("span");
        bar.style.width =
          (progress.files.total
            ? (100 * progress.files.done) / progress.files.total
            : 0) + "%";
        row.status.append(h("div", { className: "progress" }, bar));
      }
    }
    if (!state.roots.length && !table.querySelector(".manager-empty"))
      table.append(
        h(
          "p",
          { className: "manager-empty muted" },
          "还没有来源目录。添加保存资料的文件夹即可开始。",
        ),
      );
    if (state.roots.length) table.querySelector(".manager-empty")?.remove();
    addButton.disabled = !checked?.valid || state.readOnly;
  }
  function open() {
    pathInput = h("input", {
      id: "root-path",
      placeholder: "粘贴文件夹的完整路径",
      "aria-label": "目录路径",
      autocomplete: "off",
    });
    labelInput = h("input", {
      id: "root-label",
      placeholder: "显示名（可留空）",
      "aria-label": "新目录显示名",
      maxlength: 80,
    });
    previewHost = h("div", { id: "root-preview", "aria-live": "polite" });
    addButton = button("添加目录", add, {
      id: "add-root",
      className: "primary",
      disabled: true,
    });
    warning = h("p", { className: "manager-warning", role: "status" });
    table = h("div", { className: "manager-table" });
    const choose = button("选择文件夹…", async () => {
      choose.disabled = true;
      try {
        const result = await request("/api/system/choose-folder", {
          method: "POST",
        });
        if (!result.cancelled && modal) {
          pathInput.value = result.path;
          await preview();
        }
      } catch (error) {
        toast(error.message, { error: true });
      } finally {
        choose.disabled = false;
      }
    });
    const form = h(
      "form",
      {
        className: "root-add-form",
        onSubmit: (event) => {
          event.preventDefault();
          add();
        },
      },
      h("h3", {}, "添加来源目录"),
      h(
        "div",
        { className: "add-inputs" },
        pathInput,
        choose,
        labelInput,
        addButton,
      ),
      previewHost,
    );
    for (const input of [pathInput, labelInput])
      input.addEventListener("input", () => {
        clearTimeout(previewTimer);
        ++previewSerial;
        checked = null;
        addButton.disabled = true;
        previewTimer = setTimeout(preview, 300);
      });
    modal = openDialog({
      title: "目录管理",
      className: "manager",
      content: [
        warning,
        h(
          "div",
          { className: "manager-intro" },
          h(
            "p",
            { className: "muted" },
            "管理本地资料来源。父子目录重叠时，资料归属最深的可用目录。",
          ),
          button("全部重扫", () => actions.scan(), {
            disabled: state.busyScan,
            "data-global-scan": "",
          }),
          button("全量重扫", () => actions.scan(undefined, { full: true }), {
            disabled: state.busyScan,
            "data-global-scan": "",
          }),
        ),
        table,
        form,
      ],
      footer: [
        button("打开废纸篓", () => actions.reveal({ trash: true })),
        button("清除缓存", async () => {
          try {
            await request("/api/cache", { method: "DELETE" });
            toast("正文缓存已清除");
          } catch (error) {
            toast(error.message, { error: true });
          }
        }),
        button("完成", () => modal.close(), { className: "primary" }),
      ],
      onClose: () => {
        clearTimeout(previewTimer);
        previewSerial++;
        modal = null;
        relocateDialog?.close();
        rows.clear();
        checked = null;
        actions.closeManager();
      },
    });
    render();
    if (state.managerFocus?.focusAdd) pathInput.focus();
    if (state.managerFocus?.relocateId) {
      const root = state.roots.find(
        (x) => x.id === state.managerFocus.relocateId,
      );
      if (root) relocate(root);
    }
  }
  function update(next) {
    state = next;
    if (state.route.settings) {
      if (!modal) open();
      else render();
    } else if (modal) modal.close();
  }
  return {
    update,
    unmount() {
      modal?.close();
    },
    close: () => modal?.close(),
  };
}
