import assert from "node:assert/strict";
import test from "node:test";
import { shellAuditErrors } from "../shared/shell-audit.js";

function record(width, theme) {
  const collapsed = width === 960;
  const sidebar = collapsed ? 0 : 252;
  const list = 384;
  return {
    requestedWidth: width,
    requestedTheme: theme,
    appliedTheme: theme,
    innerWidth: width,
    backgroundColor: theme === "dark" ? "#FF111214" : "#FFFFFFFF",
    theme,
    tokens: {
      bg: theme === "dark" ? "#111214" : "#FFFFFF",
      accent: theme === "dark" ? "#93C5FD" : "#1E40AF",
      brandText: theme === "dark" ? "#ECECEE" : "#16171A",
      headerHeight: "48px",
      titlebarHeight: "52px",
    },
    titlebarHeight: "52px",
    titlebarVisibleCount: 1,
    titlebarVisibility: "visible",
    titlebarPane: collapsed ? "list" : "sidebar",
    titlebarLeft: 0,
    titlebarTop: 0,
    titlebarWidth: collapsed ? list : sidebar,
    listHeaderTop: collapsed ? 52 : 0,
    listHeaderHeight: "48px",
    readerHeaderHeight: "48px",
    sidebarWidth: sidebar,
    listWidth: list,
    readerWidth: width - sidebar - list,
    sidebarCollapsed: collapsed,
    sidebarVisibility: collapsed ? "hidden" : "visible",
    sidebarInert: collapsed,
    sideSplitter: {
      tabIndex: collapsed ? -1 : 0,
      valueNow: 252,
      valueMin: 200,
      valueMax: 320,
      center: collapsed ? 0 : 252,
      width: 8,
      visibility: collapsed ? "hidden" : "visible",
    },
    listSplitter: {
      tabIndex: 0,
      valueNow: 384,
      valueMin: 320,
      valueMax: 520,
      center: collapsed ? 384 : 636,
      width: 8,
      visibility: "visible",
    },
    focus: { outlineWidth: "2px", outlineStyle: "solid" },
    wordmark: {
      fontFamily: '"Space Grotesk", Inter, sans-serif',
      fontWeight: "700",
      letterSpacing: "-1.04px",
      fontSize: "16px",
      color: theme === "dark" ? "rgb(236, 236, 238)" : "rgb(22, 23, 26)",
    },
    markSrc: theme === "dark" ? "/assets/pageshelf-mark-dark.svg" : "/assets/pageshelf-mark.svg",
    skip: "跳到阅读区",
  };
}

test("shell audit accepts the six no-screenshot layout records", () => {
  const records = [];
  for (const width of [1440, 1280, 960]) {
    for (const theme of ["light", "dark"]) records.push(record(width, theme));
  }
  assert.deepEqual(shellAuditErrors(records), []);
});

test("shell audit reports a short reading pane and a wrong theme token", () => {
  const records = [];
  for (const width of [1440, 1280, 960]) {
    for (const theme of ["light", "dark"]) records.push(record(width, theme));
  }
  records[0].readerWidth = 100;
  records[1].tokens.bg = "#111827";
  records[4].titlebarWidth = 40;
  records[4].titlebarPane = "sidebar";
  records[4].listHeaderTop = 0;
  const errors = shellAuditErrors(records);
  assert.ok(errors.some((error) => error.includes("阅读区")));
  assert.ok(errors.some((error) => error.includes("--bg")));
  assert.ok(errors.some((error) => error.includes("960:light 标题条宽度")));
  assert.ok(errors.some((error) => error.includes("960:light 标题条所在栏")));
  assert.ok(errors.some((error) => error.includes("960:light 资料栏头起点")));
});
