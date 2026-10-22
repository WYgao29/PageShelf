import { findRanges, parseQuery } from "../../../shared/text-search.js";
export function createFind({ article, query = "", onChange = () => {} }) {
  const nodes = [],
    walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement.closest("code,pre,mark")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
  let text = "",
    previousBlock,
    node;
  while ((node = walker.nextNode())) {
    const block = node.parentElement.closest(
      "p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote",
    );
    if (previousBlock && previousBlock !== block) text += "\n";
    previousBlock = block;
    nodes.push({
      node,
      start: text.length,
      end: text.length + node.textContent.length,
    });
    text += node.textContent;
  }
  const ranges = findRanges(text, parseQuery(query).include),
    matches = ranges.map(() => []);
  let current = -1;
  for (const value of nodes) {
    const overlaps = ranges
      .map((range, index) => ({
        start: Math.max(range[0], value.start) - value.start,
        end: Math.min(range[1], value.end) - value.start,
        index,
      }))
      .filter((range) => range.end > range.start)
      .sort((a, b) => b.start - a.start);
    for (const range of overlaps) {
      const selected = value.node.splitText(range.start);
      selected.splitText(range.end - range.start);
      const mark = document.createElement("mark");
      mark.className = "reader-hit";
      mark.textContent = selected.textContent;
      selected.replaceWith(mark);
      matches[range.index].unshift(mark);
    }
  }
  function next(direction = 1) {
    if (!matches.length) return 0;
    current =
      current < 0
        ? direction > 0
          ? 0
          : matches.length - 1
        : (current + direction + matches.length) % matches.length;
    matches.forEach((marks, index) =>
      marks.forEach((mark) =>
        mark.classList.toggle("current-hit", index === current),
      ),
    );
    matches[current][0]?.scrollIntoView({
      block: "center",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
    onChange(current + 1, matches.length);
    return current + 1;
  }
  function destroy() {
    matches.flat().forEach((mark) => {
      const parent = mark.parentNode;
      mark.replaceWith(document.createTextNode(mark.textContent));
      parent?.normalize();
    });
  }
  return {
    total: matches.length,
    get current() {
      return current + 1;
    },
    next,
    destroy,
  };
}
