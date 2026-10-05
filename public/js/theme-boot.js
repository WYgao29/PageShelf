(() => {
  let theme = "system";
  try {
    theme = localStorage.getItem("ui.theme") || "system";
  } catch {}
  document.documentElement.dataset.theme = ["light", "dark"].includes(theme)
    ? theme
    : matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
})();
