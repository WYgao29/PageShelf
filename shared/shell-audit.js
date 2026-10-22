const THEMES = {
  light: {
    bg: "#FFFFFF",
    accent: "#1E40AF",
    brandText: "#16171A",
    window: "#FFFFFF",
  },
  dark: {
    bg: "#111214",
    accent: "#93C5FD",
    brandText: "#ECECEE",
    window: "#111214",
  },
};

export function shellProbeSource() {
  return `(() => {
    const css = getComputedStyle(document.documentElement);
    const sidebar = document.getElementById("sidebar");
    const list = document.getElementById("list-pane");
    const reader = document.getElementById("reader-pane");
    const shell = document.querySelector(".app-shell");
    const shownTitlebar = (element) => {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const box = element.getBoundingClientRect();
      return box.width > 1 && box.height > 1;
    };
    const titlebars = [...document.querySelectorAll(".titlebar")].filter(shownTitlebar);
    const titlebar = titlebars[0] || null;
    const listHeader = document.querySelector("#list-pane .pane-header");
    const readerHeader = document.querySelector("#reader-pane .pane-header");
    const side = document.getElementById("split-side");
    const splitList = document.getElementById("split-list");
    const wordmark = document.querySelector(".wordmark");
    const mark = document.querySelector(".brand-mark");
    const skip = document.querySelector(".skip-link");
    const radio = document.querySelector('.theme-option[aria-checked="true"]');
    if (radio) {
      try { radio.focus({ focusVisible: true }); }
      catch (error) { radio.focus(); }
    }
    const focus = radio ? getComputedStyle(radio) : null;
    const word = wordmark ? getComputedStyle(wordmark) : null;
    const shellBox = shell.getBoundingClientRect();
    const titlebarBox = titlebar ? titlebar.getBoundingClientRect() : null;
    const listHeaderBox = listHeader ? listHeader.getBoundingClientRect() : null;
    const center = (element) => {
      const box = element.getBoundingClientRect();
      return box.left + box.width / 2 - shellBox.left;
    };
    const splitter = (element) => ({
      tabIndex: element.tabIndex,
      valueNow: Number(element.getAttribute("aria-valuenow")),
      valueMin: Number(element.getAttribute("aria-valuemin")),
      valueMax: Number(element.getAttribute("aria-valuemax")),
      center: center(element),
      width: element.getBoundingClientRect().width,
      visibility: getComputedStyle(element).visibility,
    });
    return {
      innerWidth: window.innerWidth,
      theme: document.documentElement.dataset.theme || "",
      titlebarMode: document.documentElement.dataset.titlebar || "",
      tokens: {
        bg: css.getPropertyValue("--bg").trim(),
        accent: css.getPropertyValue("--accent").trim(),
        brandText: css.getPropertyValue("--brand-text").trim(),
        headerHeight: css.getPropertyValue("--header-height").trim(),
        titlebarHeight: css.getPropertyValue("--titlebar-height").trim(),
      },
      titlebarHeight: titlebar ? getComputedStyle(titlebar).height : "",
      titlebarVisibleCount: titlebars.length,
      titlebarVisibility: titlebar ? getComputedStyle(titlebar).visibility : "",
      titlebarPane: titlebar && titlebar.closest("#list-pane") ? "list" : titlebar && titlebar.closest("#sidebar") ? "sidebar" : "",
      titlebarLeft: titlebarBox ? titlebarBox.left - shellBox.left : null,
      titlebarTop: titlebarBox ? titlebarBox.top - shellBox.top : null,
      titlebarWidth: titlebarBox ? titlebarBox.width : 0,
      listHeaderTop: listHeaderBox ? listHeaderBox.top - shellBox.top : null,
      listHeaderHeight: listHeader ? getComputedStyle(listHeader).height : "",
      readerHeaderHeight: readerHeader ? getComputedStyle(readerHeader).height : "",
      sidebarWidth: sidebar.getBoundingClientRect().width,
      listWidth: list.getBoundingClientRect().width,
      readerWidth: reader.getBoundingClientRect().width,
      sidebarCollapsed: shell.getAttribute("data-sidebar") === "collapsed",
      sidebarVisibility: getComputedStyle(sidebar).visibility,
      sidebarInert: sidebar.inert === true,
      sideSplitter: splitter(side),
      listSplitter: splitter(splitList),
      focus: {
        outlineWidth: focus ? focus.outlineWidth : "",
        outlineStyle: focus ? focus.outlineStyle : "",
      },
      wordmark: {
        fontFamily: word ? word.fontFamily : "",
        fontWeight: word ? word.fontWeight : "",
        letterSpacing: word ? word.letterSpacing : "",
        fontSize: word ? word.fontSize : "",
        color: word ? word.color : "",
      },
      markSrc: mark ? String(mark.getAttribute("src") || mark.currentSrc || mark.src || "") : "",
      skip: skip ? skip.textContent.trim() : "",
    };
  })()`;
}

export function colorCandidates(value) {
  const text = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  const found = new Set();
  if (!text) return found;
  found.add(text);
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (hex) {
    let body = hex[1];
    if (body.length === 3) body = body.split("").map((part) => part + part).join("");
    if (body.length === 8) {
      found.add("#" + body.slice(0, 6));
      found.add("#" + body.slice(2, 8));
    } else {
      found.add("#" + body);
    }
  }
  const rgb = text.match(/^rgba?\((\d+),(\d+),(\d+)/);
  if (rgb) {
    const body = rgb.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, "0")).join("");
    found.add("#" + body);
  }
  return found;
}

export function sameColor(actual, expected) {
  const want = colorCandidates(expected);
  const got = colorCandidates(actual);
  for (const color of got) if (want.has(color)) return true;
  return false;
}

function near(actual, expected, slack) {
  return typeof actual === "number" && Number.isFinite(actual) && Math.abs(actual - expected) <= slack;
}

function pxNear(value, expected, slack) {
  return near(Number.parseFloat(value), expected, slack);
}

// hiddenInset 红绿灯原点 x=16。三枚 14px 按钮中心距 20px，右缘是 16+20+20+14。
const TRAFFIC_LIGHT_RIGHT = 70;

export function shellAuditErrors(records) {
  const errors = [];
  if (!Array.isArray(records) || records.length !== 6) {
    return ["布局测量应为 1440、1280、960 与亮暗共 6 组，实际 " + (records ? records.length : 0) + " 组"];
  }
  const seen = new Set();
  for (const record of records) {
    const width = record.requestedWidth;
    const theme = record.requestedTheme;
    const key = width + ":" + theme;
    seen.add(key);
    const label = key;
    const palette = THEMES[theme];
    if (!palette) {
      errors.push(label + " 主题无效");
      continue;
    }
    if (record.appliedTheme !== theme) errors.push(label + " 点击后主题是 " + record.appliedTheme);
    if (record.theme !== theme) errors.push(label + " data-theme 是 " + record.theme);
    if (!near(record.innerWidth, width, 1)) errors.push(label + " 内容宽度 " + record.innerWidth);
    if (!sameColor(record.backgroundColor, palette.window))
      errors.push(label + " 窗口背景 " + record.backgroundColor);
    if (!sameColor(record.tokens?.bg, palette.bg)) errors.push(label + " --bg " + record.tokens?.bg);
    if (!sameColor(record.tokens?.accent, palette.accent))
      errors.push(label + " --accent " + record.tokens?.accent);
    if (!sameColor(record.tokens?.brandText, palette.brandText))
      errors.push(label + " --brand-text " + record.tokens?.brandText);
    if (!pxNear(record.tokens?.titlebarHeight, 52, 0.1))
      errors.push(label + " --titlebar-height " + record.tokens?.titlebarHeight);
    if (!pxNear(record.tokens?.headerHeight, 48, 0.1))
      errors.push(label + " --header-height " + record.tokens?.headerHeight);
    if (record.titlebarVisibleCount !== 1) errors.push(label + " 可见标题条 " + record.titlebarVisibleCount);
    if (record.titlebarVisibility !== "visible") errors.push(label + " 标题条可见性 " + record.titlebarVisibility);
    if (!pxNear(record.titlebarHeight, 52, 0.5)) errors.push(label + " 标题条 " + record.titlebarHeight);
    if (!near(record.titlebarTop, 0, 1)) errors.push(label + " 标题条顶 " + record.titlebarTop);
    if (!near(record.titlebarLeft, 0, 2)) errors.push(label + " 标题条左 " + record.titlebarLeft);
    if (!(record.titlebarWidth >= TRAFFIC_LIGHT_RIGHT))
      errors.push(label + " 标题条宽度 " + record.titlebarWidth);
    if (!pxNear(record.listHeaderHeight, 48, 0.5))
      errors.push(label + " 资料栏头 " + record.listHeaderHeight);
    if (!pxNear(record.readerHeaderHeight, 48, 0.5))
      errors.push(label + " 阅读栏头 " + record.readerHeaderHeight);
    if (record.readerWidth < 480) errors.push(label + " 阅读区 " + record.readerWidth);
    const collapsed = width === 960;
    if (record.sidebarCollapsed !== collapsed) errors.push(label + " 侧栏折叠 " + record.sidebarCollapsed);
    if (collapsed) {
      if (record.titlebarPane !== "list") errors.push(label + " 标题条所在栏 " + record.titlebarPane);
      if (!(record.listHeaderTop >= 52)) errors.push(label + " 资料栏头起点 " + record.listHeaderTop);
      if (record.sidebarWidth > 1) errors.push(label + " 侧栏宽度 " + record.sidebarWidth);
      if (record.sidebarVisibility !== "hidden") errors.push(label + " 侧栏仍可见");
      if (record.sidebarInert !== true) errors.push(label + " 侧栏仍可聚焦");
      if (record.sideSplitter?.tabIndex !== -1) errors.push(label + " 侧栏分隔条仍可 Tab");
      if (record.sideSplitter?.visibility !== "hidden") errors.push(label + " 侧栏分隔条仍可见");
    } else {
      if (record.titlebarPane !== "sidebar") errors.push(label + " 标题条所在栏 " + record.titlebarPane);
      if (!near(record.listHeaderTop, 0, 1)) errors.push(label + " 资料栏头起点 " + record.listHeaderTop);
      if (!near(record.sidebarWidth, 252, 2)) errors.push(label + " 侧栏宽度 " + record.sidebarWidth);
      if (record.sidebarVisibility === "hidden") errors.push(label + " 侧栏被隐藏");
      if (record.sidebarInert === true) errors.push(label + " 侧栏被标为 inert");
      if (record.sideSplitter?.tabIndex !== 0) errors.push(label + " 侧栏分隔条 tabIndex");
      if (!near(record.sideSplitter?.center, 252, 2))
        errors.push(label + " 侧栏分隔条位置 " + record.sideSplitter?.center);
      if (!near(record.listSplitter?.center, 636, 2))
        errors.push(label + " 列表分隔条位置 " + record.listSplitter?.center);
    }
    if (!near(record.listWidth, 384, 2)) errors.push(label + " 列表宽度 " + record.listWidth);
    if (collapsed && !near(record.listSplitter?.center, 384, 2))
      errors.push(label + " 列表分隔条位置 " + record.listSplitter?.center);
    const side = record.sideSplitter || {};
    const list = record.listSplitter || {};
    if (side.valueMin !== 200 || side.valueMax !== 320 || side.valueNow !== 252)
      errors.push(label + " 侧栏夹取 " + [side.valueMin, side.valueNow, side.valueMax].join("/"));
    if (list.valueMin !== 320 || list.valueMax !== 520 || list.valueNow !== 384)
      errors.push(label + " 列表夹取 " + [list.valueMin, list.valueNow, list.valueMax].join("/"));
    if (list.tabIndex !== 0) errors.push(label + " 列表分隔条 tabIndex");
    if (!collapsed && !(side.width >= 8)) errors.push(label + " 侧栏分隔条命中区 " + side.width);
    if (!(list.width >= 8)) errors.push(label + " 列表分隔条命中区 " + list.width);
    if (record.focus?.outlineStyle !== "solid" || !pxNear(record.focus?.outlineWidth, 2, 0.1))
      errors.push(label + " 焦点环 " + record.focus?.outlineStyle + " " + record.focus?.outlineWidth);
    const word = record.wordmark || {};
    if (!String(word.fontFamily).toLowerCase().includes("space grotesk"))
      errors.push(label + " 字标字体 " + word.fontFamily);
    if (String(word.fontWeight) !== "700") errors.push(label + " 字标字重 " + word.fontWeight);
    const fontSize = Number.parseFloat(word.fontSize);
    const spacing = Number.parseFloat(word.letterSpacing);
    if (!near(spacing, -0.065 * fontSize, 0.25))
      errors.push(label + " 字标字距 " + word.letterSpacing + " / " + word.fontSize);
    if (!sameColor(word.color, palette.brandText)) errors.push(label + " 字标颜色 " + word.color);
    const src = String(record.markSrc);
    if (theme === "dark") {
      if (!src.includes("pageshelf-mark-dark")) errors.push(label + " 暗色标 " + src);
    } else if (!src.includes("pageshelf-mark") || src.includes("pageshelf-mark-dark") || src.includes("mark-small")) {
      errors.push(label + " 亮色标 " + src);
    }
    if (record.skip !== "跳到阅读区") errors.push(label + " skip-link " + record.skip);
    if (near(record.sidebarWidth, 252, 2) && near(record.listWidth, 384, 2)) {
      if (!near(record.sidebarWidth + record.listWidth + record.readerWidth, record.innerWidth, 3))
        errors.push(label + " 三栏宽度之和 " + (record.sidebarWidth + record.listWidth + record.readerWidth));
    }
  }
  for (const width of [1440, 1280, 960]) {
    for (const theme of ["light", "dark"]) {
      if (!seen.has(width + ":" + theme)) errors.push("缺少 " + width + " " + theme);
    }
  }
  return errors;
}
