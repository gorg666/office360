/**
 * Build an RFC 2822 email message and encode as base64url for the Gmail API.
 */
export interface EmailAttachment {
  filename: string;
  mimeType: string;
  content: string; // base64-encoded content
  contentId?: string;
  disposition?: "attachment" | "inline";
}

export interface EmailDraft {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  htmlBody: string;
  inReplyTo?: string;
  references?: string;
  threadId?: string;
  attachments?: EmailAttachment[];
}

function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64EncodeUtf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function sanitizeMimeToken(value: string, fallback: string): string {
  const sanitized = sanitizeHeaderValue(value);
  if (!sanitized) return fallback;
  return sanitized.replace(/[^\w.+-]+/g, "_");
}

function quoteMimeParameterValue(value: string): string {
  return sanitizeHeaderValue(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function encodeMimeParameter(name: string, value: string): string {
  const sanitized = sanitizeHeaderValue(value);
  if (/^[\x20-\x7E]*$/.test(sanitized)) {
    return `${name}="${quoteMimeParameterValue(sanitized)}"`;
  }
  return `${name}*=UTF-8''${encodeURIComponent(sanitized)}`;
}

function wrapBase64(value: string): string[] {
  if (!value) return [""];
  const lines: string[] = [];
  for (let i = 0; i < value.length; i += 76) {
    lines.push(value.slice(i, i + 76));
  }
  return lines;
}

function encodeMimeHeaderValue(value: string): string {
  const sanitized = sanitizeHeaderValue(value);
  if (!/[^\x20-\x7E]/.test(sanitized)) return sanitized;

  const chunks: string[] = [];
  let current = "";
  for (const char of sanitized) {
    const next = current + char;
    if (new TextEncoder().encode(next).length > 45 && current) {
      chunks.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);

  return chunks
    .map((chunk) => `=?UTF-8?B?${base64EncodeUtf8(chunk)}?=`)
    .join("");
}

function encodeAddressHeaderValue(value: string): string {
  const sanitized = sanitizeHeaderValue(value);
  const angleMatch = sanitized.match(/^(?:"?([^"<]*)"?)\s*<([^>]+)>$/);
  if (!angleMatch) return encodeMimeHeaderValue(sanitized);

  const displayName = angleMatch[1]?.trim();
  const address = angleMatch[2]?.trim();
  if (!displayName || !address) return sanitized;
  return `${encodeMimeHeaderValue(displayName)} <${address}>`;
}

function encodeAddressList(values: string[]): string {
  return values.map(encodeAddressHeaderValue).join(", ");
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function buildAlternativePart(boundary: string, htmlBody: string): string[] {
  const textContent = htmlToPlainText(htmlBody);
  const lines: string[] = [];

  lines.push(`--${boundary}`);
  lines.push("Content-Type: text/plain; charset=UTF-8");
  lines.push("");
  lines.push(textContent);
  lines.push("");

  lines.push(`--${boundary}`);
  lines.push("Content-Type: text/html; charset=UTF-8");
  lines.push("");
  lines.push(htmlBody);
  lines.push("");

  lines.push(`--${boundary}--`);
  return lines;
}

interface InlineImage {
  cid: string;
  mimeType: string;
  base64: string;
}

/**
 * Extract base64 data URLs from HTML and replace with cid: references.
 * Returns the modified HTML and extracted inline images.
 */
function extractInlineImages(html: string): { html: string; images: InlineImage[] } {
  const images: InlineImage[] = [];
  const processed = html.replace(
    /<img([^>]*)\ssrc="data:([^;]+);base64,([^"]+)"([^>]*)>/g,
    (_match, before: string, mime: string, data: string, after: string) => {
      const cid = `inline_${Date.now()}_${images.length}@office360`;
      images.push({ cid, mimeType: mime, base64: data });
      return `<img${before} src="cid:${cid}"${after}>`;
    },
  );
  return { html: processed, images };
}

/**
 * Generate a unique Message-ID for outgoing emails.
 */
function generateMessageId(from: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  const sanitized = sanitizeHeaderValue(from);
  const domain = sanitizeMimeToken(
    sanitized.match(/@([^>\s]+)/)?.[1] ?? "office360.local",
    "office360.local",
  );
  return `<${timestamp}.${random}@${domain}>`;
}

export function buildRawEmail(draft: EmailDraft): string {
  const messageId = generateMessageId(draft.from);
  const lines: string[] = [
    `From: ${encodeAddressHeaderValue(draft.from)}`,
    `To: ${encodeAddressList(draft.to)}`,
  ];

  if (draft.cc && draft.cc.length > 0) {
    lines.push(`Cc: ${encodeAddressList(draft.cc)}`);
  }
  if (draft.bcc && draft.bcc.length > 0) {
    lines.push(`Bcc: ${encodeAddressList(draft.bcc)}`);
  }

  lines.push(`Date: ${new Date().toUTCString()}`);
  lines.push(`Message-ID: ${messageId}`);
  lines.push(`Subject: ${encodeMimeHeaderValue(draft.subject)}`);
  lines.push(`MIME-Version: 1.0`);

  if (draft.inReplyTo) {
    lines.push(`In-Reply-To: ${sanitizeHeaderValue(draft.inReplyTo)}`);
  }
  if (draft.references) {
    lines.push(`References: ${sanitizeHeaderValue(draft.references)}`);
  }

  const { html: processedHtml, images: inlineImages } = extractInlineImages(draft.htmlBody);
  const hasAttachments = draft.attachments && draft.attachments.length > 0;
  const hasInlineImages = inlineImages.length > 0;

  if (hasAttachments || hasInlineImages) {
    const mixedBoundary = `----=_Mixed_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const relatedBoundary = `----=_Related_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const altBoundary = `----=_Alt_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    if (hasAttachments) {
      lines.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
      lines.push("");

      lines.push(`--${mixedBoundary}`);
    }

    if (hasInlineImages) {
      lines.push(`Content-Type: multipart/related; boundary="${relatedBoundary}"`);
      lines.push("");

      lines.push(`--${relatedBoundary}`);
      lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
      lines.push("");
      lines.push(...buildAlternativePart(altBoundary, processedHtml));
      lines.push("");

      // Inline image parts
      for (const img of inlineImages) {
        lines.push(`--${relatedBoundary}`);
        lines.push(`Content-Type: ${img.mimeType}`);
        lines.push("Content-Transfer-Encoding: base64");
        lines.push(`Content-ID: <${img.cid}>`);
        lines.push("Content-Disposition: inline");
        lines.push("");
        lines.push(...wrapBase64(img.base64));
        lines.push("");
      }
      lines.push(`--${relatedBoundary}--`);
    } else {
      // No inline images, just alternative
      lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
      lines.push("");
      lines.push(...buildAlternativePart(altBoundary, processedHtml));
    }

    if (hasAttachments) {
      lines.push("");
      // Attachment parts
      for (const att of draft.attachments!) {
        const filenameParam = encodeMimeParameter("filename", att.filename);
        const nameParam = encodeMimeParameter("name", att.filename);
        const disposition = att.disposition ?? "attachment";
        lines.push(`--${mixedBoundary}`);
        lines.push(`Content-Type: ${sanitizeHeaderValue(att.mimeType)}; ${nameParam}`);
        lines.push("Content-Transfer-Encoding: base64");
        if (att.contentId) {
          lines.push(`Content-ID: <${sanitizeHeaderValue(att.contentId).replace(/[<>]/g, "")}>`);
        }
        lines.push(`Content-Disposition: ${disposition}; ${filenameParam}`);
        lines.push("");
        lines.push(...wrapBase64(att.content));
        lines.push("");
      }
      lines.push(`--${mixedBoundary}--`);
    }
  } else {
    const altBoundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    lines.push("");
    lines.push(...buildAlternativePart(altBoundary, processedHtml));
  }

  return base64UrlEncode(lines.join("\r\n"));
}
