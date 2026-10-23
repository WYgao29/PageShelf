import readabilityUrl from "../../vendor/readability-0.6.0/Readability.js?url";
import DOMPurify from "../../vendor/dompurify-3.4.16/purify.es.mjs";
import { matchSite, selectorString } from "../../../shared/site-rules.js";
import { renderMarkdown } from "./markdown.js";
import { createFind } from "./find.js";
import { stripPresentation } from "../../../shared/html-source.js";
export const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "p",
    "br",
    "hr",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "li",
    "blockquote",
    "pre",
    "code",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "img",
    "figure",
    "figcaption",
    "a",
    "strong",
    "em",
    "b",
    "i",
    "u",
    "s",
    "del",
    "sup",
    "sub",
    "span",
    "div",
    "mark",
    "input",
  ],
  ALLOWED_ATTR: [
    "href",
    "src",
    "alt",
    "title",
    "colspan",
    "rowspan",
    "type",
    "checked",
    "disabled",
    "id",
    "data-wikilink",
  ],
  ALLOWED_URI_REGEXP: /^(?:https?:|data:image\/|#|pageshelf:\/\/source\/)/i,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ADD_URI_SAFE_ATTR: [
    "type",
    "checked",
    "disabled",
    "colspan",
    "rowspan",
    "data-wikilink",
  ],
  FORBID_TAGS: [
    "style",
    "script",
    "iframe",
    "object",
    "embed",
    "form",
    "link",
    "meta",
    "svg",
    "math",
    "template",
  ],
  KEEP_CONTENT: true,
  RETURN_DOM_FRAGMENT: true,
  SANITIZE_NAMED_PROPS: true,
};
let readabilityPromise;
function loadReadability() {
  readabilityPromise ||= new Promise((resolve, reject) => {
    if (globalThis.Readability) {
      resolve(globalThis.Readability);
      return;
    }
    const script = document.createElement("script");
    script.src = readabilityUrl;
    script.onload = () => resolve(globalThis.Readability);
    script.onerror = () => reject(new Error("通用正文抽取库加载失败"));
    document.head.append(script);
  });
  return readabilityPromise;
}
const rasterData = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp)(?:;[^,]*)?,/i;
const absoluteSource = /^(?:[a-z][a-z\d+.-]*:|\/|\\)/i;
function localImagePath(source) {
  if (absoluteSource.test(source)) return null;
  const pathname = source.split(/[?#]/, 1)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(pathname.replace(/%(?![\da-f]{2})/gi, "%25"));
  } catch {
    decoded = pathname;
  }
  return decoded && !decoded.includes("\0") && !absoluteSource.test(decoded) ? decoded : null;
}

function prepareImages(container, item, markdown) {
  for (const image of container.querySelectorAll("img")) {
    const source = image.getAttribute("src") || "";
    image.removeAttribute("srcset");
    if (rasterData.test(source)) continue;
    const localPath = markdown && localImagePath(source);
    if (localPath)
      image.setAttribute(
        "src",
        "pageshelf://source/" +
          encodeURIComponent(item.id) +
          "/asset?path=" +
          encodeURIComponent(localPath),
      );
    else {
      image.removeAttribute("src");
      image.setAttribute(
        "alt",
        "外部图片未加载" +
          (image.getAttribute("alt") ? " · " + image.getAttribute("alt") : ""),
      );
    }
  }
}

function prepareAnchors(container) {
  const aliases = new Map();
  const safeIds = new Set();
  for (const element of container.querySelectorAll("[id],a[name]")) {
    const names = [element.getAttribute("id"), element.getAttribute("name")].filter(Boolean);
    element.removeAttribute("id");
    element.removeAttribute("name");
    if (!names.length) continue;
    const id = "reader-anchor-" + (safeIds.size + 1);
    element.id = id;
    safeIds.add(id);
    for (const name of names) if (!aliases.has(name)) aliases.set(name, id);
  }
  return { aliases, safeIds };
}

export async function buildReader({
  item,
  html,
  markdown,
  items = [],
  query = "",
  onFindChange,
}) {
  const isMarkdown = markdown !== undefined && markdown !== null;
  // The hosting page must have the production CSP before this first parse.
  const documentText = isMarkdown
    ? renderMarkdown(markdown, { item, items }).html
    : html || "";
  const parsed = new DOMParser().parseFromString(
    stripPresentation(documentText),
    "text/html",
  );
  let selected = isMarkdown ? parsed.body : null,
    site;
  if (!isMarkdown) {
    site = matchSite({
      title: parsed.title,
      exists: (selector) => !!parsed.querySelector(selectorString(selector)),
    });
    for (const selector of site?.content || []) {
      selected = parsed.querySelector(selectorString(selector));
      if (selected) break;
    }
  }
  if (!selected) {
    try {
      const Readability = await loadReadability(),
        readable = new Readability(parsed.cloneNode(true)).parse();
      if (!readable)
        return {
          status: "fallback",
          reason: "未找到正文",
          article: null,
          toc: [],
          find: null,
        };
      selected = new DOMParser().parseFromString(
        readable.content,
        "text/html",
      ).body;
    } catch (error) {
      return {
        status: "fallback",
        reason: error.message,
        article: null,
        toc: [],
        find: null,
      };
    }
  }
  selected = selected.cloneNode(true);
  for (const selector of [
    ...(site?.strip || []),
    { tag: "nav" },
    { tag: "aside" },
    { tag: "footer" },
  ])
    selected
      .querySelectorAll(selectorString(selector))
      .forEach((node) => node.remove());
  prepareImages(selected, item, isMarkdown);
  const article = document.createElement("article");
  article.className = "reading-article";
  // Only sanitized nodes enter the live reading DOM.
  const dirty = selected.ownerDocument.createElement("div");
  dirty.append(...selected.childNodes);
  const anchors = prepareAnchors(dirty);
  article.append(DOMPurify.sanitize(dirty, PURIFY_CONFIG));
  for (const element of article.querySelectorAll("[id]")) {
    const id = element.id.replace(/^user-content-/, "");
    if (anchors.safeIds.has(id)) element.id = id;
    else element.removeAttribute("id");
  }
  for (const input of article.querySelectorAll("input")) {
    if (input.type !== "checkbox") input.remove();
    else input.disabled = true;
  }
  for (const image of article.querySelectorAll("img")) {
    if (!image.getAttribute("src")) {
      const placeholder = document.createElement("span");
      placeholder.className = "image-placeholder";
      placeholder.textContent = image.alt || "外部图片未加载";
      image.replaceWith(placeholder);
    } else {
      image.loading = "lazy";
      image.decoding = "async";
      const paragraph = image.parentElement;
      if (paragraph?.tagName === "P" && paragraph.children.length === 1 && !paragraph.textContent.trim())
        image.classList.add("standalone-image");
    }
  }
  for (const link of article.querySelectorAll("a[href]")) {
    if (
      !link.hasAttribute("data-wikilink") &&
      !link.getAttribute("href").startsWith("#")
    ) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
  }
  const heading = article.querySelector("h1");
  if (heading && heading.textContent.trim() === item.title) {
    if (heading.id) {
      const target = document.createElement("span");
      target.id = heading.id;
      heading.replaceWith(target);
    } else heading.remove();
  }
  if (!isMarkdown && [...article.textContent.trim()].length < 200)
    return {
      status: "fallback",
      reason: "抽取正文不足 200 字",
      article: null,
      toc: [],
      find: null,
    };
  const headingIds = new Map();
  const toc = [...article.querySelectorAll("h2,h3")].map((heading, index) => {
    const previousId = heading.id;
    heading.id = "section-" + (index + 1);
    if (previousId) headingIds.set(previousId, heading.id);
    return {
      id: heading.id,
      level: Number(heading.tagName[1]),
      text: heading.textContent.trim(),
      element: heading,
    };
  });
  for (const link of article.querySelectorAll('a[href^="#"]:not([data-wikilink])')) {
    let original = link.getAttribute("href").slice(1);
    try { original = decodeURIComponent(original); } catch { /* Literal percent signs can occur in source IDs. */ }
    const target = anchors.aliases.get(original);
    if (target) link.setAttribute("href", "#" + (headingIds.get(target) || target));
  }
  const find = createFind({ article, query, onChange: onFindChange });
  return {
    article,
    toc,
    find,
    status: "reader",
    site: site?.id || (isMarkdown ? "markdown" : "readability"),
  };
}
