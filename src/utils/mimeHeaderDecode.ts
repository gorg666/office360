/**
 * Decode RFC 2047 encoded-words in email headers (e.g. Subject, From display name).
 * Pattern: =?charset?B|b|Q|q?encoded-text?=
 */

import { normalizeBase64UrlToStandardBase64 } from "@/utils/base64url";

const ENCODED_WORD = /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g;
const MOJIBAKE_MARKERS = /[ÃÂÐÑ][\u0080-\u00FF]?/;

function decodeCharsetBytes(bytes: Uint8Array, charsetRaw: string): string {
  const charset = charsetRaw.replace(/^["']|["']$/g, "").trim();

  const normalized =
    /^utf-?8$/i.test(charset) ? "utf-8" : charset.toLowerCase();

  try {
    return new TextDecoder(normalized).decode(bytes);
  } catch {
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      return new TextDecoder("iso-8859-1").decode(bytes);
    }
  }
}

function decodeBChunk(charset: string, text: string): string {
  const cleaned = text.replace(/\s/g, "");
  if (!cleaned) return "";
  const base64 = normalizeBase64UrlToStandardBase64(cleaned);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return decodeCharsetBytes(bytes, charset);
}

function decodeQChunk(charset: string, text: string): string {
  const withSpaces = text.replace(/_/g, " ");
  const bytes: number[] = [];
  for (let i = 0; i < withSpaces.length; i++) {
    const c = withSpaces[i]!;
    if (c === "=" && i + 2 < withSpaces.length) {
      const hex = withSpaces.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(c.charCodeAt(0));
  }
  return decodeCharsetBytes(new Uint8Array(bytes), charset);
}

/** Decode all encoded-words in a header value; leaves plain segments unchanged. */
export function decodeMimeWords(input: string | null | undefined): string | null {
  if (input == null) return null;
  if (!/=\?[^?]+\?[bBqQ]\?/i.test(input)) return repairUtf8Mojibake(input);

  const decoded = input.replace(ENCODED_WORD, (_m, charset: string, enc: string, text: string) => {
    try {
      if (enc.toUpperCase() === "B") return decodeBChunk(charset, text);
      if (enc.toUpperCase() === "Q") return decodeQChunk(charset, text);
    } catch {
      return _m;
    }
    return _m;
  });

  return repairUtf8Mojibake(decoded);
}

function repairUtf8Mojibake(input: string): string {
  let current = input;

  for (let i = 0; i < 2; i++) {
    if (!MOJIBAKE_MARKERS.test(current)) break;
    const repaired = decodeLatin1BytesAsUtf8(current);
    if (!repaired || scoreHeaderText(repaired) <= scoreHeaderText(current)) break;
    current = repaired;
  }

  return current;
}

function decodeLatin1BytesAsUtf8(input: string): string | null {
  const bytes = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code > 0xff) return null;
    bytes[i] = code;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function scoreHeaderText(value: string): number {
  const cyrillic = value.match(/[А-Яа-яЁё]/g)?.length ?? 0;
  const markers = value.match(/[ÃÂÐÑ]/g)?.length ?? 0;
  return cyrillic * 2 - markers * 3;
}
