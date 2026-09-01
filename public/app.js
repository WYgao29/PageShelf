const state = { view: "all", format: "", rootId: "", query: "", items: [], settings: null, selected: null, readerFormat: "html" };
const elements = {
  allCount: document.querySelector("#allCount"), htmlCount: document.querySelector("#htmlCount"), markdownCount: document.querySelector("#markdownCount"), rootList: document.querySelector("#rootList"), settingsRootList: document.querySelector("#settingsRootList"), rootCount: document.querySelector("#rootCount"), libraryView: document.querySelector("#libraryView"), settingsView: document.querySelector("#settingsView"), viewTitle: document.querySelector("#viewTitle"), viewDescription: document.querySelector("#viewDescription"), searchInput: document.querySelector("#searchInput"), itemGrid: document.querySelector("#itemGrid"), resultCount: document.querySelector("#resultCount"), lastSynced: document.querySelector("#lastSynced"), rootForm: document.querySelector("#rootForm"), rootPath: document.querySelector("#rootPath"), rootLabel: document.querySelector("#rootLabel"), settingsMessage: document.querySelector("#settingsMessage"), refreshButton: document.querySelector("#refreshButton"), openSettings: document.querySelector("#openSettings"), dialog: document.querySelector("#itemDialog"), closeDialog: document.querySelector("#closeDialog"), dialogTitle: document.querySelector("#dialogTitle"), dialogEyebrow: document.querySelector("#dialogEyebrow"), dialogPath: document.querySelector("#dialogPath"), readerContent: document.querySelector("#readerContent"), htmlTab: document.querySelector("#htmlTab"), markdownTab: document.querySelector("#markdownTab"), openSource: document.querySelector("#openSource"), downloadSource: document.querySelector("#downloadSource"), toast: document.querySelector("#toast"),
};

async function api(route, options) {
  const response = await fetch(route, options);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(body.error || "请求失败");
  return body;
}
function formatBytes(bytes) { if (!bytes) return "0 B"; if (bytes < 1024) return bytes + " B"; if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"; return (bytes / 1024 / 1024).toFixed(1) + " MB"; }
function formatDate(value) { if (!value) return "未扫描"; return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value)); }
function escapeHtml(value) { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
function inlineMarkdown(value) { return value.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>").replace(/\x60([^\x60]+)\x60/g, "<code>$1</code>"); }
function renderMarkdown(value) {
  const lines = escapeHtml(value).split(/\r?\n/); const output = []; let inCode = false; let listOpen = false;
  for (const line of lines) {
    if (line.trim().startsWith("\x60\x60\x60")) { if (listOpen) { output.push("</ul>"); listOpen = false; } output.push(inCode ? "</pre>" : "<pre>"); inCode = !inCode; continue; }
    if (inCode) { output.push(line); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/); const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (heading) { if (listOpen) { output.push("</ul>"); listOpen = false; } const level = heading[1].length; output.push("<h" + level + ">" + inlineMarkdown(heading[2]) + "</h" + level + ">"); }
    else if (bullet) { if (!listOpen) { output.push("<ul>"); listOpen = true; } output.push("<li>" + inlineMarkdown(bullet[1]) + "</li>"); }
    else if (!line.trim()) { if (listOpen) { output.push("</ul>"); listOpen = false; } }
    else { if (listOpen) { output.push("</ul>"); listOpen = false; } output.push("<p>" + inlineMarkdown(line) + "</p>"); }
  }
  if (listOpen) output.push("</ul>"); if (inCode) output.push("</pre>"); return output.join("");
}
function sourceUrl(item, format, action) { return "/api/items/" + encodeURIComponent(item.id) + "/" + action + "/" + format; }
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
    const card = document.createElement("article"); card.className = "item-card"; const badges = []; if (item.html) badges.push("<span class=\"format-badge html\">HTML</span>"); if (item.markdown) badges.push("<span class=\"format-badge md\">MD</span>");
    card.innerHTML = "<div class=\"card-top\"><span class=\"card-folder\"></span><div class=\"badges\">" + badges.join("") + "</div></div><h2 class=\"card-title\"></h2><p class=\"card-snippet\"></p><div class=\"card-bottom\"><span></span><button class=\"open-card\">打开记录 →</button></div>";
    card.querySelector(".card-folder").textContent = item.rootLabel + " · " + item.relativePath; card.querySelector(".card-title").textContent = item.title; card.querySelector(".card-snippet").textContent = item.snippet || "这条记录没有可显示的摘要。"; card.querySelector(".card-bottom span").textContent = formatDate(item.updatedAt) + " · " + formatBytes(item.size);
    card.querySelector(".open-card").addEventListener("click", () => openItem(item)); card.addEventListener("click", (event) => { if (!event.target.closest("button")) openItem(item); }); elements.itemGrid.append(card);
  }
}
async function loadLibrary() {
  const params = new URLSearchParams(); if (state.query) params.set("q", state.query); if (state.rootId) params.set("rootId", state.rootId); if (state.format) params.set("format", state.format);
  try { const result = await api("/api/library?" + params.toString()); state.items = result.items; renderCards(); const lastScan = state.settings?.lastScan; elements.lastSynced.textContent = lastScan?.completedAt ? "上次扫描 " + formatDate(lastScan.completedAt) : "等待首次扫描"; } catch (error) { showToast(error.message); }
}
async function loadSettings() {
  state.settings = await api("/api/settings"); renderRoots(); const items = await api("/api/library"); const all = items.items; elements.allCount.textContent = all.length; elements.htmlCount.textContent = all.filter((item) => item.html).length; elements.markdownCount.textContent = all.filter((item) => item.markdown).length; renderCards();
}
async function refresh() {
  elements.refreshButton.classList.add("is-refreshing");
  try { const result = await api("/api/scan", { method: "POST" }); state.settings = await api("/api/settings"); renderRoots(); await loadLibrary(); showToast("已扫描 " + result.stats.items + " 条记录"); } catch (error) { showToast(error.message); } finally { elements.refreshButton.classList.remove("is-refreshing"); }
}
async function addRoot(event) {
  event.preventDefault(); elements.settingsMessage.textContent = "正在验证并扫描目录…";
  try { await api("/api/settings/roots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: elements.rootPath.value, label: elements.rootLabel.value }) }); elements.rootForm.reset(); state.settings = await api("/api/settings"); renderRoots(); elements.settingsMessage.textContent = "目录已添加，索引已更新。"; showToast("扫描目录已添加"); } catch (error) { elements.settingsMessage.textContent = error.message; }
}
async function removeRoot(id) {
  if (!window.confirm("移除这个扫描目录？源文件不会被删除。")) return;
  try { await api("/api/settings/roots/" + encodeURIComponent(id), { method: "DELETE" }); state.settings = await api("/api/settings"); renderRoots(); await loadLibrary(); showToast("扫描目录已移除"); } catch (error) { showToast(error.message); }
}
async function openItem(item) {
  state.selected = item; state.readerFormat = item.html ? "html" : "markdown"; elements.dialogTitle.textContent = item.title; elements.dialogEyebrow.textContent = item.rootLabel; elements.dialogPath.textContent = item.relativePath; elements.dialog.showModal(); await renderReader();
}
async function renderReader() {
  const item = state.selected; const format = state.readerFormat; const available = format === "html" ? item.html : item.markdown; elements.htmlTab.classList.toggle("active", format === "html"); elements.markdownTab.classList.toggle("active", format === "markdown"); elements.htmlTab.disabled = !item.html; elements.markdownTab.disabled = !item.markdown;
  if (!available) { elements.readerContent.innerHTML = "<div class=\"reader-empty\">这个记录没有对应格式的源文件。</div>"; return; }
  elements.openSource.href = sourceUrl(item, format, "source"); elements.downloadSource.href = sourceUrl(item, format, "download");
  if (format === "html") { elements.readerContent.innerHTML = "<iframe class=\"reader-frame\" sandbox=\"\" title=\"HTML 阅读内容\"></iframe>"; elements.readerContent.querySelector("iframe").src = sourceUrl(item, "html", "source"); }
  else { elements.readerContent.innerHTML = "<div class=\"markdown-reader\"></div>"; const source = await api(sourceUrl(item, "markdown", "source")); elements.readerContent.querySelector(".markdown-reader").innerHTML = renderMarkdown(source); }
}
function showToast(message) { elements.toast.textContent = message; elements.toast.classList.add("show"); window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => elements.toast.classList.remove("show"), 2600); }
let searchTimer;
elements.searchInput.addEventListener("input", () => { state.query = elements.searchInput.value; window.clearTimeout(searchTimer); searchTimer = window.setTimeout(loadLibrary, 180); });
document.querySelectorAll(".nav-item[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
document.querySelectorAll(".filter-chip").forEach((button) => button.addEventListener("click", () => { state.format = button.dataset.format; document.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.toggle("active", chip === button)); loadLibrary(); }));
elements.refreshButton.addEventListener("click", refresh); elements.openSettings.addEventListener("click", () => setView("settings")); elements.rootForm.addEventListener("submit", addRoot);
document.addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); elements.searchInput.focus(); } });
elements.closeDialog.addEventListener("click", () => elements.dialog.close()); elements.dialog.addEventListener("click", (event) => { if (event.target === elements.dialog) elements.dialog.close(); }); elements.htmlTab.addEventListener("click", () => { state.readerFormat = "html"; renderReader(); }); elements.markdownTab.addEventListener("click", () => { state.readerFormat = "markdown"; renderReader(); });
loadSettings().catch((error) => showToast(error.message));
