(() => {
  const root = document.documentElement;
  let preference = "system";
  try {
    const stored = localStorage.getItem("ui.theme");
    if (stored === "light" || stored === "dark" || stored === "system") preference = stored;
  } catch {}
  let prefersDark = false;
  try {
    prefersDark = matchMedia("(prefers-color-scheme: dark)").matches === true;
  } catch {}
  root.dataset.theme =
    preference === "dark" || (preference !== "light" && prefersDark) ? "dark" : "light";

  let sidebar = 252;
  let list = 384;
  try {
    const parsed = JSON.parse(localStorage.getItem("ui.paneWidths") || "");
    const finite =
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      parsed.every((value) => typeof value === "number" && Number.isFinite(value));
    if (finite) {
      sidebar = Math.max(200, Math.min(320, parsed[0]));
      list = Math.max(320, Math.min(520, parsed[1]));
    }
  } catch {}
  root.style.setProperty("--sidebar-width", sidebar + "px");
  root.style.setProperty("--list-width", list + "px");
})();
