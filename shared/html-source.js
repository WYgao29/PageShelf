const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
export function decodeEntities(value) {
  const entities = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    copy: "©",
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, key) => {
    if (key[0] !== "#") return entities[key.toLowerCase()] ?? match;
    const number = Number.parseInt(
      key.slice(key[1]?.toLowerCase() === "x" ? 2 : 1),
      key[1]?.toLowerCase() === "x" ? 16 : 10,
    );
    return number > 0 &&
      number <= 0x10ffff &&
      !(number >= 0xd800 && number <= 0xdfff)
      ? String.fromCodePoint(number)
      : "�";
  });
}
function tokenize(html) {
  const tokens = [],
    pattern =
      /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/g;
  let match;
  while ((match = pattern.exec(html))) {
    if (match[0].startsWith("<!")) continue;
    const tag = match[0].match(/^<\/?([\w:-]+)/)[1].toLowerCase(),
      closing = /^<\//.test(match[0]);
    tokens.push({
      start: match.index,
      end: pattern.lastIndex,
      raw: match[0],
      tag,
      closing,
      void: VOID.has(tag) || /\/\s*>$/.test(match[0]),
    });
    if (!closing && ["script", "style", "textarea", "title"].includes(tag)) {
      const closingPattern = new RegExp("</" + tag + "\\s*>", "ig");
      closingPattern.lastIndex = pattern.lastIndex;
      const end = closingPattern.exec(html);
      if (end) {
        tokens.push({
          start: end.index,
          end: closingPattern.lastIndex,
          raw: end[0],
          tag,
          closing: true,
        });
        pattern.lastIndex = closingPattern.lastIndex;
      } else pattern.lastIndex = html.length;
    }
  }
  return tokens;
}
export function attributes(raw) {
  const attrs = {};
  const attributePattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = attributePattern.exec(raw)))
    attrs[match[1].toLowerCase()] = decodeEntities(
      match[2] ?? match[3] ?? match[4],
    );
  return attrs;
}
export function findElements(html, selector = {}) {
  const tokens = tokenize(html),
    results = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.closing) continue;
    const attrs = attributes(token.raw);
    if (
      (selector.tag && token.tag !== selector.tag) ||
      (selector.id && attrs.id !== selector.id) ||
      (selector.cls && !attrs.class?.split(/\s+/).includes(selector.cls))
    )
      continue;
    let end = token.end,
      closeStart = token.end,
      depth = 1;
    if (!token.void) {
      for (let next = index + 1; next < tokens.length; next++) {
        const other = tokens[next];
        if (other.tag !== token.tag) continue;
        if (other.closing) depth--;
        else if (!other.void) depth++;
        if (!depth) {
          end = other.end;
          closeStart = other.start;
          break;
        }
      }
      if (depth) {
        closeStart = html.length;
        end = html.length;
      }
    }
    const innerHTML = html.slice(token.end, closeStart);
    results.push({
      innerHTML,
      text: stripHtml(innerHTML),
      start: token.start,
      end,
      attrs,
    });
  }
  return results;
}
export function findElement(html, selector) {
  return findElements(html, selector)[0] || null;
}
export function stripElements(html, selectors) {
  const ranges = selectors
    .flatMap((selector) => findElements(html, selector))
    .sort((a, b) => a.start - b.start);
  let output = "",
    end = 0;
  for (const range of ranges) {
    if (range.start < end) continue;
    output += html.slice(end, range.start);
    end = range.end;
  }
  return output + html.slice(end);
}
export function stripHtml(value) {
  return decodeEntities(
    value
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(
        /<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
        " ",
      )
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

// Remove source CSS before inert DOM parsing: CSP also checks inert styles.
// This preserves text/selection attributes; DOMPurify still performs sanitization.
export function stripPresentation(html) {
  const tokens = tokenize(html);
  let output = "",
    end = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.start < end) continue;
    output += html.slice(end, token.start);
    if (!token.closing && token.tag === "style") {
      const closing = tokens
        .slice(index + 1)
        .find((value) => value.closing && value.tag === "style");
      end = closing?.end ?? html.length;
    } else {
      if (token.tag !== "link")
        output += token.closing
          ? token.raw
          : token.raw.replace(
              /([\w:-]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g,
              (attribute, name) =>
                name.toLowerCase() === "style" ? "" : attribute,
            );
      end = token.end;
    }
  }
  return output + html.slice(end);
}
