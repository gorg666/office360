/**
 * Извлечение text/plain и text/html из сырого RFC 822 (в т.ч. вложенный multipart).
 * Нужно для локального сохранения отправленных писем — нельзя класть в body_html весь MIME.
 */

function normalizeNewlines(raw: string): string {
  return raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function parseHeadersBlock(headerBlock: string): Map<string, string> {
  const headers = new Map<string, string>();
  const unfolded = headerBlock.replace(/\n([ \t])/g, " ");
  for (const line of unfolded.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const name = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();
    headers.set(name, value);
  }
  return headers;
}

function getBoundary(contentTypeHeader: string): string | null {
  const m = contentTypeHeader.match(/boundary="?([^";\s]+)"?/i);
  return m?.[1] ?? null;
}

/** Разбивает тело multipart на сегменты (без преамбулы и закрывающего `--boundary--`). */
function splitMultipartSegments(body: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  const chunks = body.split(marker);
  const out: string[] = [];
  for (let i = 1; i < chunks.length; i++) {
    let chunk = chunks[i] ?? "";
    if (chunk.startsWith("--")) break;
    if (chunk.startsWith("\r\n")) chunk = chunk.slice(2);
    else if (chunk.startsWith("\n")) chunk = chunk.slice(1);
    chunk = chunk.replace(/\s+$/, "");
    if (chunk.trim()) out.push(chunk);
  }
  return out;
}

function splitPartHeadersAndBody(segment: string): { headers: Map<string, string>; body: string } {
  const splitIdx = segment.indexOf("\n\n");
  if (splitIdx === -1) {
    return { headers: new Map(), body: segment };
  }
  const headerBlock = segment.slice(0, splitIdx);
  const body = segment.slice(splitIdx + 2);
  return { headers: parseHeadersBlock(headerBlock), body };
}

function extractBodiesRecursive(entityBody: string, contentTypeHeader: string): { text: string | null; html: string | null } {
  const ct = contentTypeHeader.toLowerCase();
  const boundary = getBoundary(contentTypeHeader);

  if (boundary && ct.includes("multipart/")) {
    let text: string | null = null;
    let html: string | null = null;
    const segments = splitMultipartSegments(entityBody, boundary);
    for (const segment of segments) {
      const { headers, body } = splitPartHeadersAndBody(segment);
      const partCt = headers.get("content-type") ?? "text/plain";
      const inner = extractBodiesRecursive(body, partCt);
      if (!text && inner.text) text = inner.text;
      if (!html && inner.html) html = inner.html;
      if (text && html) break;
    }
    return { text, html };
  }

  const trimmed = entityBody.trim();
  if (!trimmed) return { text: null, html: null };

  if (ct.includes("text/html")) {
    return { text: null, html: trimmed };
  }
  if (ct.includes("text/plain")) {
    return { text: trimmed, html: null };
  }

  return { text: null, html: null };
}

export function extractTextAndHtmlFromRawEmail(raw: string): { text: string | null; html: string | null } {
  const normalized = normalizeNewlines(raw);
  const headerEnd = normalized.indexOf("\n\n");
  if (headerEnd === -1) return { text: null, html: null };
  const headerBlock = normalized.slice(0, headerEnd);
  const body = normalized.slice(headerEnd + 2);
  const headers = parseHeadersBlock(headerBlock);
  const contentType = headers.get("content-type") ?? "text/plain; charset=UTF-8";
  return extractBodiesRecursive(body, contentType);
}
