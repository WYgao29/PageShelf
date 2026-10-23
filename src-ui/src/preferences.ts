export const THEME_KEY = "ui.theme";
export const PANE_KEY = "ui.paneWidths";

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type Appearance = "light" | "dark";

export const SIDEBAR_DEFAULT = 252;
export const LIST_DEFAULT = 384;
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 320;
export const LIST_MIN = 320;
export const LIST_MAX = 520;
export const PANE_STEP = 16;
export const READER_MIN = 480;
export const WINDOW_MIN = 960;

const LIMITS = [
  [SIDEBAR_MIN, SIDEBAR_MAX],
  [LIST_MIN, LIST_MAX],
] as const;

export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function resolveAppearance(
  preference: ThemePreference,
  prefersDark: boolean,
): Appearance {
  if (preference === "light" || preference === "dark") return preference;
  return prefersDark ? "dark" : "light";
}

export function readThemePreference(storage: Pick<Storage, "getItem">): ThemePreference {
  try {
    return normalizeThemePreference(storage.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

export function writeThemePreference(
  storage: Pick<Storage, "setItem">,
  preference: ThemePreference,
) {
  try {
    storage.setItem(THEME_KEY, preference);
  } catch {
    /* 存储不可用时保持内存中的选择。 */
  }
}

export function clampPane(index: 0 | 1, value: number) {
  const [min, max] = LIMITS[index];
  return Math.max(min, Math.min(max, value));
}

export function defaultPaneWidths(): [number, number] {
  return [SIDEBAR_DEFAULT, LIST_DEFAULT];
}

export function parsePaneWidths(raw: string | null): [number, number] {
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      !parsed.every((value) => typeof value === "number" && Number.isFinite(value))
    ) {
      return defaultPaneWidths();
    }
    return [clampPane(0, parsed[0]), clampPane(1, parsed[1])];
  } catch {
    return defaultPaneWidths();
  }
}

export function readPaneWidths(storage: Pick<Storage, "getItem">): [number, number] {
  try {
    return parsePaneWidths(storage.getItem(PANE_KEY));
  } catch {
    return defaultPaneWidths();
  }
}

export function writePaneWidths(storage: Pick<Storage, "setItem">, widths: [number, number]) {
  try {
    storage.setItem(PANE_KEY, JSON.stringify([clampPane(0, widths[0]), clampPane(1, widths[1])]));
  } catch {
    /* 写入失败时栏宽仍留在当前界面。 */
  }
}

export function nudgePane(
  widths: [number, number],
  index: 0 | 1,
  direction: -1 | 1,
): [number, number] {
  const next: [number, number] = [widths[0], widths[1]];
  next[index] = clampPane(index, next[index] + direction * PANE_STEP);
  return next;
}

export type PaneLayout = {
  collapsed: boolean;
  stored: [number, number];
  sidebar: number;
  list: number;
};

export function layoutPanes(windowWidth: number, stored: [number, number]): PaneLayout {
  const sidebar = clampPane(0, stored[0]);
  const list = clampPane(1, stored[1]);
  const normalized: [number, number] = [sidebar, list];
  if (windowWidth < WINDOW_MIN || windowWidth - sidebar - list >= READER_MIN) {
    return { collapsed: false, stored: normalized, sidebar, list };
  }
  const room = Math.max(LIST_MIN, windowWidth - READER_MIN);
  return {
    collapsed: true,
    stored: normalized,
    sidebar: 0,
    list: Math.min(list, room),
  };
}
