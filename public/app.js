const state = { view: "all", format: "", rootId: "", query: "", items: [], settings: null };
const elements = {
  allCount: document.querySelector("#allCount"), htmlCount: document.querySelector("#htmlCount"), markdownCount: document.querySelector("#markdownCount"), rootList: document.querySelector("#rootList"), settingsRootList: document.querySelector("#settingsRootList"), rootCount: document.querySelector("#rootCount"), libraryView: document.querySelector("#libraryView"), settingsView: document.querySelector("#settingsView"), viewTitle: document.querySelector("#viewTitle"), viewDescription: document.querySelector("#viewDescription"), searchInput: document.querySelector("#searchInput"), itemGrid: document.querySelector("#itemGrid"), resultCount: document.querySelector("#resultCount"), lastSynced: document.querySelector("#lastSynced"), rootForm: document.querySelector("#rootForm"), rootPath: document.querySelector("#rootPath"), chooseRootPath: document.querySelector("#chooseRootPath"), rootLabel: document.querySelector("#rootLabel"), settingsMessage: document.querySelector("#settingsMessage"), refreshButton: document.querySelector("#refreshButton"), openSettings: document.querySelector("#openSettings"), toast: document.querySelector("#toast"),
};
let libraryRequestSerial = 0;

async function api(route, options) {
  const response = await fetch(route, options);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(body?.error || "请求失败");
  return body;
}
function formatBytes(bytes) { if (!bytes) return "0 B"; if (bytes < 1024) return bytes + " B"; if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"; return (bytes / 1024 / 1024).toFixed(1) + " MB"; }
function formatDate(value) { if (!value) return "未扫描"; return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value)); }
function sourceUrl(item, format, action) { return "/api/items/" + encodeURIComponent(item.id) + "/" + action + "/" + format; }
function markdownViewerUrl(item) { return "/assets/markdown-viewer.html?source=" + encodeURIComponent(sourceUrl(item, "markdown", "source")); }
function webSource(item) { return item.html ? "html" : item.mhtml ? "mhtml" : ""; }
function createSourceAction(item, format) {
  const action = document.createElement("a");
  action.className = "card-action source-action " + format + "-action";
  const selectedFormat = format === "html" ? webSource(item) : format;
  action.textContent = format === "html" ? selectedFormat === "mhtml" ? "MHTML 打开" : "HTML 打开" : "Markdown 打开";
  if (selectedFormat && item[selectedFormat]) {
    action.href = selectedFormat === "markdown" ? markdownViewerUrl(item) : sourceUrl(item, selectedFormat, "source");
    action.target = "_blank";
    action.rel = "noopener";
  } else {
    action.classList.add("is-disabled");
    action.setAttribute("aria-disabled", "true");
    action.addEventListener("click", (event) => event.preventDefault());
  }
  return action;
}
function updateCounts(items) {
  elements.allCount.textContent = items.length;
  elements.htmlCount.textContent = items.filter((item) => item.html || item.mhtml).length;
  elements.markdownCount.textContent = items.filter((item) => item.markdown).length;
}
function notifyScan(result, label = "扫描完成") {
  const issueText = result.errors?.length ? "，发现 " + result.errors.length + " 个问题" : "";
  showToast(label + " " + result.stats.items + " 条记录" + issueText);
}
function setView(view, rootId = "") {
  state.view = view; state.rootId = rootId; state.format = view === "html" || view === "markdown" ? view : "";
  document.querySelectorAll(".nav-item[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  elements.libraryView.classList.toggle("hidden", view === "settings"); elements.settingsView.classList.toggle("hidden", view !== "settings");
  const titles = { all: ["全部内容", "把散落的对话，重新放回一个顺手的入口。"], html: ["HTML 阅读", "保留原始页面的结构、样式和阅读体验。"], markdown: ["Markdown", "适合搜索、迁移和长期保存的原始版本。"], settings: ["设置", "管理内容来源，让新对话自动出现在这里。"] };
  elements.viewTitle.textContent = titles[view][0]; elements.viewDescription.textContent = titles[view][1];
  document.querySelectorAll(".filter-chip").forEach((button) => button.classList.toggle("active", button.dataset.format === state.format));
  if (view !== "settings") loadLibrary();
}
function renderRoots() {
  const roots = state.settings?.roots || []; elements.rootList.replaceChildren(); elements.settingsRootList.replaceChildren(); elements.rootCount.textContent = roots.length + " 个目录";
  if (!roots.length) { elements.rootList.innerHTML = "<div class=\"sidebar-empty\">还没有扫描目录<br>去设置里添加一个吧</div>"; elements.settingsRootList.innerHTML = "<div class=\"sidebar-empty\">添加第一个扫描目录后，内容会自动出现在这里。</div>"; return; }
  for (const root of roots) {
    const nav = document.createElement("button"); nav.className = "root-button"; nav.innerHTML = "<span class=\"root-glyph\"></span><span></span>"; nav.lastElementChild.textContent = root.label; nav.addEventListener("click", () => setView("all", root.id)); elements.rootList.append(nav);
    const row = document.createElement("div"); row.className = "settings-root-row"; row.innerHTML = "<div class=\"root-info\"><strong></strong><span></span></div><button class=\"remove-root\">移除</button>"; row.querySelector("strong").textContent = root.label; row.querySelector("span").textContent = root.path; row.querySelector(".remove-root").addEventListener("click", () => removeRoot(root.id)); elements.settingsRootList.append(row);
  }
}
function renderCards() {
  elements.itemGrid.replaceChildren(); elements.resultCount.textContent = state.items.length;
  if (!state.items.length) { const empty = document.createElement("div"); empty.className = "empty-state"; empty.innerHTML = "<div><strong>" + (state.query ? "没有找到匹配内容" : "这里还很安静") + "</strong><p>" + (state.query ? "试试换一个关键词，或搜索正文里的独特词语。" : "去设置里添加保存对话的文件夹，开始建立你的索引。") + "</p></div>"; elements.itemGrid.append(empty); return; }
  for (const item of state.items) {
    const card = document.createElement("article"); card.className = "item-card"; const badges = []; if (item.html) badges.push("<span class=\"format-badge html\">HTML</span>"); if (item.mhtml) badges.push("<span class=\"format-badge html\">MHTML</span>"); if (item.markdown) badges.push("<span class=\"format-badge md\">MD</span>");
    card.innerHTML = "<div class=\"card-top\"><span class=\"card-folder\"></span><div class=\"badges\">" + badges.join("") + "</div></div><h2 class=\"card-title\"></h2><p class=\"card-snippet\"></p><div class=\"card-bottom\"><span></span></div><div class=\"card-actions\" aria-label=\"文章操作\"></div>";
    card.querySelector(".card-folder").textContent = item.rootLabel + " · " + item.relativePath; card.querySelector(".card-title").textContent = item.title; card.querySelector(".card-snippet").textContent = item.snippet || "这条记录没有可显示的摘要。"; card.querySelector(".card-bottom span").textContent = formatDate(item.updatedAt) + " · " + formatBytes(item.size);
    const actions = card.querySelector(".card-actions"); actions.append(createSourceAction(item, "html"), createSourceAction(item, "markdown"));
    const deleteAction = document.createElement("button"); deleteAction.className = "card-action delete-action"; deleteAction.type = "button"; deleteAction.textContent = "删除"; deleteAction.addEventListener("click", () => void deleteItem(item, deleteAction)); actions.append(deleteAction);
    elements.itemGrid.append(card);
  }
}
async function loadLibrary() {
  const requestSerial = ++libraryRequestSerial;
  const params = new URLSearchParams(); if (state.query) params.set("q", state.query); if (state.rootId) params.set("rootId", state.rootId); if (state.format) params.set("format", state.format);
  try {
    const result = await api("/api/library?" + params.toString());
    if (requestSerial !== libraryRequestSerial) return;
    state.items = result.items;
    renderCards();
    const lastScan = state.settings?.lastScan;
    elements.lastSynced.textContent = lastScan?.completedAt ? "上次扫描 " + formatDate(lastScan.completedAt) : "等待首次扫描";
  } catch (error) {
    if (requestSerial === libraryRequestSerial) showToast(error.message);
  }
}
async function loadSettings() {
  state.settings = await api("/api/settings"); renderRoots(); const items = await api("/api/library"); const all = items.items; updateCounts(all); state.items = all; renderCards();
}
async function refresh() {
  elements.refreshButton.classList.add("is-refreshing");
  try { const result = await api("/api/scan", { method: "POST" }); updateCounts(result.items); state.settings = await api("/api/settings"); renderRoots(); await loadLibrary(); notifyScan(result); } catch (error) { showToast(error.message); } finally { elements.refreshButton.classList.remove("is-refreshing"); }
}
async function addRoot(event) {
  event.preventDefault(); elements.settingsMessage.textContent = "正在验证并扫描目录…";
  try { const result = await api("/api/settings/roots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: elements.rootPath.value, label: elements.rootLabel.value }) }); updateCounts(result.scan.items); elements.rootForm.reset(); state.settings = await api("/api/settings"); renderRoots(); elements.settingsMessage.textContent = "目录已添加，索引已更新。"; notifyScan(result.scan, "目录已添加，扫描完成"); } catch (error) { elements.settingsMessage.textContent = error.message; }
}
async function chooseRoot() {
  elements.chooseRootPath.disabled = true;
  elements.settingsMessage.textContent = "正在打开文件夹选择器…";
  try {
    const result = await api("/api/settings/choose-folder", { method: "POST" });
    if (result.cancelled) {
      elements.settingsMessage.textContent = "已取消选择。";
      return;
    }
    elements.rootPath.value = result.path;
    elements.settingsMessage.textContent = "已选择文件夹，请点击“添加并扫描”。";
  } catch (error) {
    elements.settingsMessage.textContent = error.message;
  } finally {
    elements.chooseRootPath.disabled = false;
  }
}
async function removeRoot(id) {
  if (!window.confirm("移除这个扫描目录？源文件不会被删除。")) return;
  try { const result = await api("/api/settings/roots/" + encodeURIComponent(id), { method: "DELETE" }); updateCounts(result.items); state.settings = await api("/api/settings"); renderRoots(); await loadLibrary(); notifyScan(result, "扫描目录已移除，扫描完成"); } catch (error) { showToast(error.message); }
}
async function deleteItem(item, trigger) {
  if (!window.confirm("确定删除“" + item.title + "”吗？\n这会同时删除对应的源文件，且无法恢复。")) return;
  trigger.disabled = true;
  try {
    const result = await api("/api/items/" + encodeURIComponent(item.id), { method: "DELETE" });
    updateCounts(result.scan.items);
    state.settings = await api("/api/settings");
    renderRoots();
    await loadLibrary();
    notifyScan(result.scan, "记录已删除，扫描完成");
  } catch (error) {
    showToast(error.message);
  } finally {
    trigger.disabled = false;
  }
}
function showToast(message) { elements.toast.textContent = message; elements.toast.classList.add("show"); window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => elements.toast.classList.remove("show"), 2600); }
let searchTimer;
elements.searchInput.addEventListener("input", () => { state.query = elements.searchInput.value; window.clearTimeout(searchTimer); searchTimer = window.setTimeout(loadLibrary, 180); });
document.querySelectorAll(".nav-item[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
document.querySelectorAll(".filter-chip").forEach((button) => button.addEventListener("click", () => { state.format = button.dataset.format; document.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.toggle("active", chip === button)); loadLibrary(); }));
elements.refreshButton.addEventListener("click", refresh); elements.openSettings.addEventListener("click", () => setView("settings")); elements.rootForm.addEventListener("submit", addRoot); elements.chooseRootPath.addEventListener("click", chooseRoot);
document.addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); elements.searchInput.focus(); } });
loadSettings().catch((error) => showToast(error.message));
