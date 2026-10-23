import { describe, expect, it } from "vitest";
import {
  LIST_DEFAULT,
  LIST_MAX,
  LIST_MIN,
  PANE_STEP,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  defaultPaneWidths,
  layoutPanes,
  normalizeThemePreference,
  nudgePane,
  parsePaneWidths,
  readPaneWidths,
  readThemePreference,
  resolveAppearance,
  writePaneWidths,
  writeThemePreference,
} from "./preferences";

describe("theme preference", () => {
  it("keeps the three stored values and falls back otherwise", () => {
    expect(normalizeThemePreference("system")).toBe("system");
    expect(normalizeThemePreference("light")).toBe("light");
    expect(normalizeThemePreference("dark")).toBe("dark");
    expect(normalizeThemePreference("blue")).toBe("system");
    expect(normalizeThemePreference(null)).toBe("system");
    expect(readThemePreference({ getItem: () => "nope" })).toBe("system");
    expect(readThemePreference({ getItem: () => { throw new Error("denied"); } })).toBe("system");
  });

  it("follows the system only while the preference is system", () => {
    expect(resolveAppearance("system", true)).toBe("dark");
    expect(resolveAppearance("system", false)).toBe("light");
    expect(resolveAppearance("light", true)).toBe("light");
    expect(resolveAppearance("dark", false)).toBe("dark");
  });

  it("stores ui.theme as a plain string and ignores write failures", () => {
    const saved = new Map<string, string>();
    writeThemePreference(
      { setItem: (key, value) => saved.set(key, value) },
      "dark",
    );
    expect(saved.get("ui.theme")).toBe("dark");
    expect(() =>
      writeThemePreference(
        { setItem: () => { throw new Error("denied"); } },
        "light",
      ),
    ).not.toThrow();
  });
});

describe("pane widths", () => {
  it("returns defaults for missing, bad, and unreadable values", () => {
    expect(parsePaneWidths(null)).toEqual([SIDEBAR_DEFAULT, LIST_DEFAULT]);
    expect(parsePaneWidths("not-json")).toEqual(defaultPaneWidths());
    expect(parsePaneWidths("[1]")).toEqual(defaultPaneWidths());
    expect(parsePaneWidths('["a", "b"]')).toEqual(defaultPaneWidths());
    expect(parsePaneWidths("[252, 384, 10]")).toEqual(defaultPaneWidths());
    expect(readPaneWidths({ getItem: () => { throw new Error("denied"); } })).toEqual(defaultPaneWidths());
  });

  it("clamps finite pairs and steps by 16px", () => {
    expect(parsePaneWidths("[10, 900]")).toEqual([SIDEBAR_MIN, LIST_MAX]);
    expect(parsePaneWidths("[400, 100]")).toEqual([SIDEBAR_MAX, LIST_MIN]);
    expect(PANE_STEP).toBe(16);
    expect(nudgePane([252, 384], 0, 1)).toEqual([268, 384]);
    expect(nudgePane([252, 384], 0, -1)).toEqual([236, 384]);
    expect(nudgePane([320, 384], 0, 1)).toEqual([320, 384]);
    expect(nudgePane([200, 320], 1, -1)).toEqual([200, 320]);
    expect(nudgePane([252, 520], 1, 1)).toEqual([252, 520]);
  });

  it("keeps the stored width when a narrow window only caps the visible list", () => {
    expect(layoutPanes(1440, [252, 384])).toMatchObject({
      collapsed: false,
      sidebar: 252,
      list: 384,
    });
    expect(layoutPanes(1280, [252, 384])).toMatchObject({ collapsed: false, sidebar: 252, list: 384 });
    expect(layoutPanes(960, [252, 384])).toMatchObject({ collapsed: true, sidebar: 0, list: 384 });
    expect(layoutPanes(960, [252, 520]).stored).toEqual([252, 520]);
    expect(layoutPanes(960, [252, 520])).toMatchObject({ collapsed: true, sidebar: 0, list: 480 });
    expect(layoutPanes(0, [252, 384]).collapsed).toBe(false);
  });

  it("writes a clamped JSON pair and swallows storage errors", () => {
    const saved = new Map<string, string>();
    writePaneWidths({ setItem: (key, value) => saved.set(key, value) }, [10, 900]);
    expect(saved.get("ui.paneWidths")).toBe("[200,520]");
    expect(() =>
      writePaneWidths({ setItem: () => { throw new Error("denied"); } }, [252, 384]),
    ).not.toThrow();
  });
});
