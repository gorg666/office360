import DOMPurify from "dompurify";

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    // Keep cid: on <img> until EmailRenderer replaces with data: URIs (RFC 2392 inline images).
    ALLOW_UNKNOWN_PROTOCOLS: true,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    ALLOWED_ATTR: [
      "href", "src", "alt", "title", "width", "height", "class", "style",
      "target", "rel", "colspan", "rowspan", "cellpadding", "cellspacing",
      "border", "align", "valign", "bgcolor", "color", "dir", "lang",
      "data-blocked-src",
    ],
  });
}
