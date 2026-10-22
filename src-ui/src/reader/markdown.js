import { Marked } from "../../vendor/marked-18.0.14/marked.esm.js";
import { parseMarkdownSource } from "../shared/markdown-source.js";
import { resolveWikilink } from "./wiki.js";
const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
export function renderMarkdown(source, { item, items = [] }) {
  const parsed = parseMarkdownSource(source),
    marked = new Marked({ gfm: true, breaks: true });
  marked.use({
    extensions: [
      {
        name: "wikilink",
        level: "inline",
        start: (value) => value.indexOf("[["),
        tokenizer(value) {
          const match = /^\[\[([^\]\n]+)\]\]/.exec(value);
          if (match) {
            const [target, label] = match[1].split("|");
            return {
              type: "wikilink",
              raw: match[0],
              target,
              label: label || target,
            };
          }
        },
        renderer(token) {
          const resolved = resolveWikilink(token.target, item, items);
          return resolved.status === "resolved"
            ? `<a data-wikilink="${escape(resolved.item.id)}" href="#item-${encodeURIComponent(resolved.item.id)}">${escape(token.label)}</a>`
            : `<span data-wikilink="${resolved.status}">${escape(token.label)}</span>`;
        },
      },
    ],
  });
  return { html: marked.parse(parsed.body), source: parsed };
}
