import { storageGet, storageSet } from "../dom.js";
export function mountSplitters() {
  let widths = storageGet("ui.paneWidths", [252, 384]);
  if (
    !Array.isArray(widths) ||
    widths.length !== 2 ||
    !Number.isFinite(widths[0]) ||
    !Number.isFinite(widths[1])
  )
    widths = [252, 384];
  const elements = [
      document.querySelector("#split-side"),
      document.querySelector("#split-list"),
    ],
    minimums = [200, 320],
    maximums = [320, 520];
  function apply() {
    widths = widths.map((value, index) =>
      Math.max(minimums[index], Math.min(maximums[index], value)),
    );
    document.documentElement.style.setProperty("--w-side", widths[0] + "px");
    document.documentElement.style.setProperty("--w-list", widths[1] + "px");
    elements.forEach((element, index) => {
      element.setAttribute("aria-valuemin", minimums[index]);
      element.setAttribute("aria-valuemax", maximums[index]);
      element.setAttribute("aria-valuenow", widths[index]);
    });
    storageSet("ui.paneWidths", widths);
  }
  elements.forEach((element, index) => {
    element.addEventListener("dblclick", () => {
      widths = [252, 384];
      apply();
    });
    element.addEventListener("keydown", (event) => {
      if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        widths[index] += event.key === "ArrowRight" ? 10 : -10;
        apply();
      }
    });
    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const start = event.clientX,
        initial = widths[index];
      element.setPointerCapture(event.pointerId);
      document.body.classList.add("resizing");
      const move = (e) => {
        widths[index] = initial + e.clientX - start;
        apply();
      };
      const done = () => {
        element.removeEventListener("pointermove", move);
        document.body.classList.remove("resizing");
      };
      element.addEventListener("pointermove", move);
      element.addEventListener("pointerup", done, { once: true });
      element.addEventListener("pointercancel", done, { once: true });
    });
  });
  apply();
  return {
    reset() {
      widths = [252, 384];
      apply();
    },
  };
}
