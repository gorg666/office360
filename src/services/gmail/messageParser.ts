import type { GmailMessage, GmailMessagePart, GmailHeader } from "./client";
import { parseAuthenticationResults } from "./authParser";
import { normalizeBase64UrlToStandardBase64 } from "@/utils/base64url";
import { decodeMimeWords } from "@/utils/mimeHeaderDecode";
import { parseSingleEmailAddress } from "@/utils/emailAddressParse";

export interface ParsedAttachment {
  filename: string;
  mimeType: string;
  size: number;
  gmailAttachmentId: string;
  contentId: string | null;
  isInline: boolean;
}

export interface ParsedMessage {
  id: string;
  threadId: string;
  fromAddress: string | null;
  fromName: string | null;
  toAddresses: string | null;
  ccAddresses: string | null;
  bccAddresses: string | null;
  replyTo: string | null;
  subject: string | null;
  snippet: string;
  date: number;
  isRead: boolean;
  isStarred: boolean;
  bodyHtml: string | null;
  bodyText: string | null;
  rawSize: number;
  internalDate: number;
  labelIds: string[];
  hasAttachments: boolean;
  attachments: ParsedAttachment[];
  listUnsubscribe: string | null;
  listUnsubscribePost: string | null;
  authResults: string | null;
  messageIdHeader: string | null;
  referencesHeader: string | null;
  inReplyToHeader: string | null;
}

export function parseGmailMessage(msg: GmailMessage): ParsedMessage {
  const headers = msg.payload.headers;
  let { name: fromName, address: fromAddress } = parseSingleEmailAddress(getHeader(headers, "From"));
  if (!fromName?.trim() && fromAddress) {
    const sender = parseSingleEmailAddress(getHeader(headers, "Sender"));
    if (
      sender.name?.trim() &&
      sender.address &&
      sender.address.trim().toLowerCase() === fromAddress.trim().toLowerCase()
    ) {
      fromName = sender.name;
    }
  }

  const bodyHtml = extractBody(msg.payload, "text/html");
  const bodyText = extractBody(msg.payload, "text/plain");
  const attachments = extractAttachments(msg.payload);
  const authResult = parseAuthenticationResults(headers);

  return {
    id: msg.id,
    threadId: msg.threadId,
    fromAddress: fromAddress,
    fromName: fromName,
    toAddresses: decodeHeaderValue(getHeader(headers, "To")),
    ccAddresses: decodeHeaderValue(getHeader(headers, "Cc")),
    bccAddresses: decodeHeaderValue(getHeader(headers, "Bcc")),
    replyTo: decodeHeaderValue(getHeader(headers, "Reply-To")),
    subject: decodeHeaderValue(getHeader(headers, "Subject")),
    snippet: msg.snippet,
    date: parseInt(msg.internalDate, 10),
    isRead: !msg.labelIds.includes("UNREAD"),
    isStarred: msg.labelIds.includes("STARRED"),
    bodyHtml: bodyHtml ? decodeBase64Url(bodyHtml) : null,
    bodyText: bodyText ? decodeBase64Url(bodyText) : null,
    rawSize: msg.sizeEstimate,
    internalDate: parseInt(msg.internalDate, 10),
    labelIds: msg.labelIds,
    hasAttachments: attachments.length > 0,
    attachments,
    listUnsubscribe: decodeHeaderValue(getHeader(headers, "List-Unsubscribe")),
    listUnsubscribePost: decodeHeaderValue(getHeader(headers, "List-Unsubscribe-Post")),
    authResults: authResult ? JSON.stringify(authResult) : null,
    messageIdHeader: getHeader(headers, "Message-ID"),
    referencesHeader: getHeader(headers, "References"),
    inReplyToHeader: getHeader(headers, "In-Reply-To"),
  };
}

function getHeader(headers: GmailHeader[], name: string): string | null {
  const header = headers.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return header?.value ?? null;
}

function decodeHeaderValue(value: string | null): string | null {
  return decodeMimeWords(value);
}

function extractBody(
  part: GmailMessagePart,
  mimeType: string,
): string | null {
  if (part.mimeType === mimeType && part.body.data) {
    return part.body.data;
  }

  if (part.parts) {
    for (const child of part.parts) {
      const result = extractBody(child, mimeType);
      if (result) return result;
    }
  }

  return null;
}

function extractAttachments(part: GmailMessagePart): ParsedAttachment[] {
  const results: ParsedAttachment[] = [];
  collectAttachments(part, results);
  return results;
}

function collectAttachments(part: GmailMessagePart, results: ParsedAttachment[]): void {
  if (part.body.attachmentId) {
    const contentIdHeader = part.headers?.find(
      (h) => h.name.toLowerCase() === "content-id",
    );
    const contentDisposition = part.headers?.find(
      (h) => h.name.toLowerCase() === "content-disposition",
    );
    const hasFilename = part.filename && part.filename.length > 0;
    const hasCid = !!contentIdHeader?.value;
    const isInline = contentDisposition?.value?.toLowerCase().startsWith("inline") ?? false;

    // Collect parts with a filename (regular attachments) or a Content-ID (CID inline images)
    if (hasFilename || hasCid) {
      results.push({
        filename: part.filename || contentIdHeader?.value?.replace(/[<>]/g, "") || "inline",
        mimeType: part.mimeType,
        size: part.body.size,
        gmailAttachmentId: part.body.attachmentId,
        contentId: contentIdHeader?.value?.replace(/[<>]/g, "") ?? null,
        isInline: isInline && !hasFilename,
      });
    }
  }

  if (part.parts) {
    for (const child of part.parts) {
      collectAttachments(child, results);
    }
  }
}

function decodeBase64Url(data: string): string {
  // Gmail uses URL-safe base64 (often without padding)
  const base64 = normalizeBase64UrlToStandardBase64(data);
  try {
    return decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join(""),
    );
  } catch {
    // Fallback for binary data
    return atob(base64);
  }
}
