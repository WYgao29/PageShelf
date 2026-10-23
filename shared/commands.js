export const COMMANDS = Object.freeze([
  { id: "focus-search", label: "搜索资料", key: "⌘K / /", accelerator: "CommandOrControl+K", menu: "view" },
  { id: "toggle-sidebar", label: "折叠或显示侧栏", key: "⌘\\", accelerator: "CommandOrControl+\\", menu: "view" },
  { id: "cycle-theme", label: "切换主题", key: "t", menu: "view" },
  { id: "cycle-view", label: "切换阅读视图", key: "v", menu: "view" },
  { id: "scan-all", label: "全部重扫", key: "Shift+R", menu: "view" },
  { id: "manage-roots", label: "目录管理", key: "Shift+M", menu: "view" },
  { id: "help", label: "快捷键帮助", key: "?", menu: "view" },
  { id: "back", label: "后退", key: "⌘[", accelerator: "CommandOrControl+[", menu: "go" },
  { id: "forward", label: "前进", key: "⌘]", accelerator: "CommandOrControl+]", menu: "go" },
  { id: "next-item", label: "下一条", key: "j", menu: "go" },
  { id: "previous-item", label: "上一条", key: "k", menu: "go" },
  { id: "open-item", label: "打开选中条目", key: "Enter", menu: "go" },
  { id: "previous-article", label: "系列上一篇", key: "[", menu: "go" },
  { id: "next-article", label: "系列下一篇", key: "]", menu: "go" },
  { id: "next-hit", label: "下一处正文命中", key: "n", menu: "go" },
  { id: "previous-hit", label: "上一处正文命中", key: "Shift+N", menu: "go" },
  { id: "all-roots", label: "全部目录", key: "g a", menu: "go" },
]);

export function commandForInput(input, platform = process.platform) {
  if (input.type !== "keyDown" || input.alt || input.shift) return null;
  const primary = platform === "darwin" ? input.meta && !input.control : input.control && !input.meta;
  if (!primary) return null;
  return ({ k: "focus-search", "\\": "toggle-sidebar", "[": "back", "]": "forward" })[input.key?.toLowerCase()] || null;
}
