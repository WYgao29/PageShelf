import { closeOpenMenu } from "./components/menu";

export function registerShortcuts(dispatch: (command: string) => void, now = Date.now, platform = document.documentElement.dataset.platform || "darwin") {
  let prefixUntil = 0;
  const resetPrefix = () => { prefixUntil = 0; };
  const handler = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    const key = event.key.toLowerCase();
    const target = event.target instanceof Element ? event.target : document.body;
    const editable = target.closest("input,textarea,select,[contenteditable]:not([contenteditable=false])");
    const dialog = document.querySelector("dialog[open]");
    const run = (command: string) => { event.preventDefault(); prefixUntil = 0; dispatch(command); };
    if (event.key === "Escape") {
      prefixUntil = 0;
      if (closeOpenMenu()) { event.preventDefault(); return; }
      if (dialog) return;
      if (editable && target.id !== "search-input") return;
      run("escape-search"); return;
    }
    if (dialog || document.querySelector('[role="menu"]')) { prefixUntil = 0; return; }
    const primary = platform === "darwin" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (primary && !event.altKey && !event.shiftKey) {
      const command = ({ k: "focus-search", "\\": "toggle-sidebar", "[": "back", "]": "forward" } as Record<string, string>)[key];
      if (command) { run(command); return; }
    }
    if (key === "enter" && target.id === "search-input") { run("open-item"); return; }
    if (editable || event.metaKey || event.ctrlKey || event.altKey) { prefixUntil = 0; return; }
    if (prefixUntil && now() < prefixUntil) {
      prefixUntil = 0;
      if (key === "a") { run("all-roots"); return; }
      if (/^[1-9]$/.test(key)) { run("root-" + key); return; }
    }
    prefixUntil = 0;
    if (key === "g" && !event.shiftKey) { prefixUntil = now() + 1000; return; }
    if (event.key === "?" || (event.shiftKey && key === "/")) { run("help"); return; }
    if (event.shiftKey && key === "r") { run("scan-all"); return; }
    if (event.shiftKey && key === "m") { run("manage-roots"); return; }
    const command = ({ "/": "focus-search", j: "next-item", k: "previous-item", "[": "previous-article", "]": "next-article", v: "cycle-view", n: event.shiftKey ? "previous-hit" : "next-hit", t: "cycle-theme" } as Record<string, string>)[key];
    if (command) run(command);
    else if (event.key === "Enter" && (target === document.body || target.id === "list-rows")) run("open-item");
  };
  document.addEventListener("keydown", handler);
  window.addEventListener("blur", resetPrefix);
  window.addEventListener("pageshelf-route", resetPrefix);
  return () => { document.removeEventListener("keydown", handler); window.removeEventListener("blur", resetPrefix); window.removeEventListener("pageshelf-route", resetPrefix); };
}
