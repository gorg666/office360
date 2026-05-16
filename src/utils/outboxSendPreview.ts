import { base64UrlToUint8Array } from "@/utils/base64url";
import { decodeMimeWords } from "@/utils/mimeHeaderDecode";

export interface OutboxSendPreview {
  recipient: string;
  subject: string;
}

function decodeRawEmailUtf8(rawBase64Url: string): string {
  const bytes = base64UrlToUint8Array(rawBase64Url);
  return new TextDecoder().decode(bytes);
}

function readHeaderValue(raw: string, name: string): string | null {
  const re = new RegExp(`^${name}:\\s*(.+)$`, "im");
  const match = raw.match(re);
  if (!match?.[1]) return null;
  const line = match[1].trim();
  return decodeMimeWords(line) ?? line;
}

function extractFromRaw(raw: string): OutboxSendPreview {
  const subject = readHeaderValue(raw, "Subject") ?? "(без темы)";
  const recipient = readHeaderValue(raw, "To") ?? "(получатель не указан)";
  return { recipient, subject };
}

/** Parse recipient/subject from a queued sendMessage operation params JSON. */
export function parseOutboxSendPreview(paramsJson: string): OutboxSendPreview {
  try {
    const params = JSON.parse(paramsJson) as {
      rawBase64Url?: string;
      subject?: string;
      to?: string;
    };
    if (typeof params.subject === "string" || typeof params.to === "string") {
      return {
        recipient: params.to?.trim() || "(получатель не указан)",
        subject: params.subject?.trim() || "(без темы)",
      };
    }
    if (params.rawBase64Url) {
      return extractFromRaw(decodeRawEmailUtf8(params.rawBase64Url));
    }
  } catch {
    // fall through
  }
  return { recipient: "—", subject: "—" };
}
