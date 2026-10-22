import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

function boot(options: {
  theme?: string | null;
  panes?: string | null;
  prefersDark?: boolean;
  fail?: boolean;
}) {
  const root = {
    dataset: {} as Record<string, string>,
    style: {
      values: new Map<string, string>(),
      setProperty(name: string, value: string) {
        this.values.set(name, value);
      },
    },
  };
  const storage = new Map<string, string>();
  if (options.theme) storage.set("ui.theme", options.theme);
  if (options.panes) storage.set("ui.paneWidths", options.panes);
  const context = {
    document: { documentElement: root },
    localStorage: {
      getItem(key: string) {
        if (options.fail) throw new Error("denied");
        return storage.has(key) ? storage.get(key) : null;
      },
    },
    matchMedia(query: string) {
      if (options.fail) throw new Error("denied");
      return { matches: query.includes("dark") && options.prefersDark === true };
    },
  };
  vm.runInNewContext(
    readFileSync(path.join(process.cwd(), "src-ui/static/theme-boot.js"), "utf8"),
    context,
  );
  return root;
}

describe("theme boot script", () => {
  it("resolves a stored theme before styles can paint", () => {
    expect(boot({ theme: "dark" }).dataset.theme).toBe("dark");
    expect(boot({ theme: "light", prefersDark: true }).dataset.theme).toBe("light");
    expect(boot({ theme: "system", prefersDark: true }).dataset.theme).toBe("dark");
    expect(boot({ theme: "system", prefersDark: false }).dataset.theme).toBe("light");
    expect(boot({ theme: "blue", prefersDark: true }).dataset.theme).toBe("dark");
  });

  it("falls back to defaults when storage is bad or throws", () => {
    const broken = boot({ panes: "nope", theme: "light" });
    expect(broken.style.values.get("--sidebar-width")).toBe("252px");
    expect(broken.style.values.get("--list-width")).toBe("384px");
    const clamped = boot({ panes: "[10,900]" });
    expect(clamped.style.values.get("--sidebar-width")).toBe("200px");
    expect(clamped.style.values.get("--list-width")).toBe("520px");
    const failed = boot({ fail: true, prefersDark: true });
    expect(failed.dataset.theme).toBe("light");
    expect(failed.style.values.get("--sidebar-width")).toBe("252px");
  });
});
