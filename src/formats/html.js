export function decodeText(buffer, charset = 'utf-8') { try { return new TextDecoder(charset).decode(buffer); } catch { return buffer.toString('utf8'); } }
export function parseHtml(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content), head = bytes.toString('latin1', 0, 4096), charset = head.match(/<meta[^>]+charset\s*=\s*["']?([^\s"';/>]+)/i)?.[1] || 'utf-8';
  return { html: decodeText(bytes, charset), charset };
}
