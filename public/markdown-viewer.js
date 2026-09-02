function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function inlineMarkdown(value) {
  return value
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\x60([^\x60]+)\x60/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function parseTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const content = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return content.split("|").map((cell) => cell.trim());
}

function isTableSeparator(line) {
  const cells = parseTableRow(line);
  return Boolean(cells?.length && cells.every((cell) => /^:?-{3,}:?$/.test(cell)));
}

function renderMarkdown(value) {
  const lines = escapeHtml(value).split(/\r?\n/);
  const output = [];
  let inCode = false;
  let listOpen = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().startsWith("\x60\x60\x60")) {
      if (listOpen) { output.push("</ul>"); listOpen = false; }
      output.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) { output.push(line); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    const quote = line.match(/^&gt;\s?(.*)$/);
    const tableHeader = parseTableRow(line);
    if (tableHeader && isTableSeparator(lines[index + 1] || "")) {
      if (listOpen) { output.push("</ul>"); listOpen = false; }
      output.push("<table><thead><tr>" + tableHeader.map((cell) => "<th>" + inlineMarkdown(cell) + "</th>").join("") + "</tr></thead><tbody>");
      index += 2;
      while (index < lines.length) {
        const row = parseTableRow(lines[index]);
        if (!row || !row.length) break;
        output.push("<tr>" + row.map((cell) => "<td>" + inlineMarkdown(cell) + "</td>").join("") + "</tr>");
        index += 1;
      }
      output.push("</tbody></table>");
      index -= 1;
    } else if (quote) {
      if (listOpen) { output.push("</ul>"); listOpen = false; }
      const quoteLines = [quote[1]];
      while (index + 1 < lines.length) {
        const nextQuote = lines[index + 1].match(/^&gt;\s?(.*)$/);
        if (!nextQuote) break;
        quoteLines.push(nextQuote[1]);
        index += 1;
      }
      output.push("<blockquote>" + quoteLines.map((item) => "<p>" + inlineMarkdown(item) + "</p>").join("") + "</blockquote>");
    } else if (/^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)) {
      if (listOpen) { output.push("</ul>"); listOpen = false; }
      output.push("<hr>");
    } else if (heading) {
      if (listOpen) { output.push("</ul>"); listOpen = false; }
      const level = heading[1].length;
      output.push("<h" + level + ">" + inlineMarkdown(heading[2]) + "</h" + level + ">");
    } else if (bullet) {
      if (!listOpen) { output.push("<ul>"); listOpen = true; }
      output.push("<li>" + inlineMarkdown(bullet[1]) + "</li>");
    } else if (ordered) {
      if (listOpen) { output.push("</ul>"); listOpen = false; }
      const orderedItems = [ordered[1]];
      while (index + 1 < lines.length) {
        const nextOrdered = lines[index + 1].match(/^\s*\d+\.\s+(.+)$/);
        if (!nextOrdered) break;
        orderedItems.push(nextOrdered[1]);
        index += 1;
      }
      output.push("<ol>" + orderedItems.map((item) => "<li>" + inlineMarkdown(item) + "</li>").join("") + "</ol>");
    } else if (!line.trim()) {
      if (listOpen) { output.push("</ul>"); listOpen = false; }
    } else {
      if (listOpen) { output.push("</ul>"); listOpen = false; }
      output.push("<p>" + inlineMarkdown(line) + "</p>");
    }
  }
  if (listOpen) output.push("</ul>");
  if (inCode) output.push("</code></pre>");
  return output.join("");
}

function markdownSourceUrl() {
  const source = new URLSearchParams(window.location.search).get("source");
  if (!source) throw new Error("缺少 Markdown 来源地址");
  const url = new URL(source, window.location.origin);
  if (url.origin !== window.location.origin || !/^\/api\/items\/[^/]+\/source\/markdown$/.test(url.pathname)) {
    throw new Error("Markdown 来源地址无效");
  }
  return url.href;
}

async function loadMarkdown() {
  const content = document.querySelector("#markdownContent");
  try {
    const response = await window.fetch(markdownSourceUrl());
    if (!response.ok) throw new Error("Markdown 文件读取失败");
    const source = await response.text();
    content.innerHTML = renderMarkdown(source);
  } catch (error) {
    content.innerHTML = "<p class=\"reader-status reader-error\">" + escapeHtml(error.message || "Markdown 文件读取失败") + "。</p>";
  }
}

loadMarkdown();
