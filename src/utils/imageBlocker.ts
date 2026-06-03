/**
 * Utility functions for blocking/restoring remote images in email HTML.
 * Preserves data: and cid: URIs, only blocks http/https remote images.
 */

const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

/**
 * Strip remote images from HTML by moving src to data-blocked-src.
 * Also strips remote url() references in inline styles.
 */
export function stripRemoteImages(html: string): string {
  // Replace <img src="http..."> with data-blocked-src and a harmless data URI.
  // Leaving src empty makes Chromium render the familiar broken image icon.
  let result = html.replace(
    /(<img\b[^>]*?)(\ssrc\s*=\s*)(["'])(https?:\/\/[^"']*)\3/gi,
    `$1 data-blocked-src=$3$4$3 src=$3${TRANSPARENT_PIXEL}$3`,
  );

  // Replace background-image: url(http...) in inline styles
  result = result.replace(
    /url\(\s*(["']?)(https?:\/\/[^)"']*)\1\s*\)/gi,
    'url($1$1)',
  );

  return result;
}

/**
 * Restore previously blocked remote images by moving data-blocked-src back to src.
 */
export function restoreRemoteImages(html: string): string {
  return html.replace(/<img\b[^>]*\sdata-blocked-src\s*=\s*["']https?:\/\/[^"']*["'][^>]*>/gi, (tag) => {
    const blocked = tag.match(/\sdata-blocked-src\s*=\s*(["'])(https?:\/\/[^"']*)\1/i);
    if (!blocked) return tag;

    const quote = blocked[1]!;
    const src = blocked[2]!;
    let restored = tag.replace(/\sdata-blocked-src\s*=\s*(["'])https?:\/\/[^"']*\1/i, "");

    if (/\ssrc\s*=\s*(["'])[^"']*\1/i.test(restored)) {
      restored = restored.replace(/\ssrc\s*=\s*(["'])[^"']*\1/i, ` src=${quote}${src}${quote}`);
    } else {
      restored = restored.replace(/<img\b/i, `<img src=${quote}${src}${quote}`);
    }

    return restored;
  });
}

/**
 * Check if an HTML string contains any blocked images.
 */
export function hasBlockedImages(html: string): boolean {
  return /data-blocked-src\s*=\s*["']https?:\/\//i.test(html);
}
