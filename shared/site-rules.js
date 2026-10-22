export const SITE_RULES = [
  {
    id: "zsxq",
    name: "知识星球",
    match: { titleIncludes: ["知识星球"], hostIncludes: ["zsxq.com"] },
    content: [{ cls: "topic-detail" }, { cls: "talk-content-container" }],
    title: [{ tag: "h1", cls: "topic-detail" }],
    strip: [{ cls: "comment-container" }, { tag: "nav" }, { tag: "aside" }],
    titleSuffix: [
      "| 深度连接铁杆粉丝，运营高品质社群，知识变现的工具",
      "知识星球",
    ],
  },
  {
    id: "newtype",
    name: "newtype",
    match: { selectorExists: [{ cls: "ql-editor" }] },
    content: [{ cls: "ql-editor" }],
    titleInContent: [{ tag: "h1" }],
    title: [{ tag: "h1", cls: "title" }],
    author: { textPattern: "来自：\\s*(.+?)\\s+(\\d{4}年\\d{2}月\\d{2}日)" },
    titleSuffix: ["newtype"],
  },
  {
    id: "article",
    name: null,
    match: { selectorExists: [{ tag: "article" }, { tag: "main" }] },
    content: [{ tag: "article" }, { tag: "main" }],
    strip: [{ tag: "nav" }, { tag: "aside" }, { tag: "footer" }],
  },
];
export function selectorString(selector) {
  return (
    (selector.tag || "") +
    (selector.cls ? "." + selector.cls : "") +
    (selector.id ? "#" + selector.id : "")
  );
}

export function matchSite({ title = "", url = "", exists }) {
  return (
    SITE_RULES.find((rule) => rule.content.some(exists)) ||
    SITE_RULES.find(
      (rule) =>
        rule.match.titleIncludes?.some((value) => title.includes(value)) ||
        rule.match.hostIncludes?.some((value) => url.includes(value)),
    )
  );
}
