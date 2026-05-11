/**
 * Gmail commonly returns base64url strings without padding.
 * `atob` expects standard base64 with correct padding, so we normalize first.
 */
export function normalizeBase64UrlToStandardBase64(input: string): string {
  let s = input.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad === 2) s += "==";
  else if (pad === 3) s += "=";
  else if (pad === 1) {
    // Malformed input; still attempt decode — callers should catch failures.
    s += "===";
  }
  return s;
}

export function base64UrlToUint8Array(input: string): Uint8Array<ArrayBuffer> {
  const b64 = normalizeBase64UrlToStandardBase64(input);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length) as Uint8Array<ArrayBuffer>;
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** RFC 4648 base64 for data: URLs (not Gmail base64url). */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  const chunk = 0x8000;
  for (let i = 0; i < len; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, len)));
  }
  return btoa(binary);
}

export function uint8ArrayToBase64DataUrl(mimeType: string, bytes: Uint8Array): string {
  return `data:${mimeType};base64,${uint8ArrayToBase64(bytes)}`;
}
