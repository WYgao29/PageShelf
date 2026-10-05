import { h } from "../dom.js";
export const skeleton = () =>
  h(
    "div",
    { className: "skeleton", role: "status", "aria-label": "正在加载正文" },
    h("div"),
    h("div"),
    h("div"),
  );
