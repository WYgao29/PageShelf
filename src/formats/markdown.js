import { parseMarkdownSource } from "../../public/js/shared/markdown-source.js";
export const parseMarkdown = (content) =>
  parseMarkdownSource(
    Buffer.isBuffer(content) ? content.toString("utf8") : content,
  );
export function markdownText(value) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_, target, label) => label || target,
    )
    .replace(/[#>*_`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
