import { parseMarkdownSource } from "../../shared/markdown-source.js";
import { decodeEntities, stripHtml } from "../html-scan.js";
import { Marked } from "../../src-ui/vendor/marked-18.0.14/marked.esm.js";

const markdown = new Marked({ gfm: true, breaks: true });
markdown.use({
  extensions: [
    {
      name: "wikilink",
      level: "inline",
      start: (value) => value.indexOf("[["),
      tokenizer(value) {
        const match = /^\[\[([^\]\n]+)\]\]/.exec(value);
        if (match) {
          const [target, label] = match[1].split("|");
          return { type: "wikilink", raw: match[0], text: label || target };
        }
      },
    },
  ],
});

function tokensText(tokens) {
  return tokens.map((token) => {
    switch (token.type) {
      // Code is visible verbatim; do not interpret its punctuation, HTML or links.
      case "code":
        return token.text + "\n";
      case "codespan":
      case "escape":
      case "wikilink":
        return token.text;
      case "space":
      case "br":
      case "hr":
      case "checkbox":
        return " ";
      case "html":
        return stripHtml(token.text) +
          (token.block || /^<(?:br|hr)\b/i.test(token.text) ? " " : "");
      case "list":
        return token.items.map((item) => tokensText(item.tokens)).join(" ") + " ";
      case "table":
        return [token.header, ...token.rows]
          .map((row) => row.map((cell) => tokensText(cell.tokens)).join(" "))
          .join(" ") + " ";
      default: {
        const text = token.tokens
          ? tokensText(token.tokens)
          : decodeEntities(token.text || "");
        // Inline formatting must not split a visible word such as API_**KEY**.
        return text +
          (["paragraph", "heading", "blockquote", "list_item"].includes(token.type)
            ? " "
            : "");
      }
    }
  }).join("");
}

export const parseMarkdown = (content) =>
  parseMarkdownSource(
    Buffer.isBuffer(content) ? content.toString("utf8") : content,
  );
export function markdownText(value) {
  return tokensText(markdown.lexer(value)).replace(/\s+/g, " ").trim();
}
