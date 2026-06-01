import { getMessageById, type DbMessage } from "@/services/db/messages";
import type { ParsedMessage } from "@/services/gmail/messageParser";
import { getDb } from "@/services/db/connection";
import { getEmailProvider } from "@/services/email/providerFactory";

export interface ReplyHeaders {
  inReplyTo?: string;
  references?: string;
}

function normalizeMessageId(value: string): string | null {
  const trimmed = value.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) return null;
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) return trimmed;
  return `<${trimmed.replace(/^<|>$/g, "")}>`;
}

function extractMessageIds(value: string | null | undefined): string[] {
  if (!value) return [];
  const bracketed = value.match(/<[^<>]+>/g)?.map((id) => id.trim()).filter(Boolean);
  if (bracketed && bracketed.length > 0) return bracketed;

  return value
    .split(/\s+/)
    .map((part) => normalizeMessageId(part))
    .filter((id): id is string => Boolean(id));
}

function getFirstMessageId(value: string | null | undefined): string | null {
  return extractMessageIds(value)[0] ?? null;
}

function appendUnique(ids: string[], next: string): string[] {
  if (ids.includes(next)) return ids;
  return [...ids, next];
}

export function buildReplyHeadersForMessage(message: DbMessage | null | undefined): ReplyHeaders {
  const parentMessageId = getFirstMessageId(message?.message_id_header);
  if (!parentMessageId) return {};

  const references = appendUnique(
    extractMessageIds(message?.references_header),
    parentMessageId,
  );

  return {
    inReplyTo: parentMessageId,
    references: references.length > 0 ? references.join(" ") : undefined,
  };
}

function buildReplyHeadersForParsedMessage(message: ParsedMessage | null | undefined): ReplyHeaders {
  const parentMessageId = getFirstMessageId(message?.messageIdHeader);
  if (!parentMessageId) return {};

  const references = appendUnique(
    extractMessageIds(message?.referencesHeader),
    parentMessageId,
  );

  return {
    inReplyTo: parentMessageId,
    references: references.length > 0 ? references.join(" ") : undefined,
  };
}

async function persistFetchedReplyHeaders(
  accountId: string,
  messageId: string,
  message: ParsedMessage,
): Promise<void> {
  if (!message.messageIdHeader && !message.referencesHeader && !message.inReplyToHeader) return;
  const db = await getDb();
  await db.execute(
    `UPDATE messages
     SET message_id_header = COALESCE($3, message_id_header),
         references_header = COALESCE($4, references_header),
         in_reply_to_header = COALESCE($5, in_reply_to_header)
     WHERE account_id = $1 AND id = $2`,
    [
      accountId,
      messageId,
      message.messageIdHeader,
      message.referencesHeader,
      message.inReplyToHeader,
    ],
  );
}

export async function buildReplyHeadersForMessageId(
  accountId: string,
  messageId: string | null | undefined,
): Promise<ReplyHeaders> {
  if (!messageId) return {};
  const message = await getMessageById(accountId, messageId);
  const storedHeaders = buildReplyHeadersForMessage(message);
  if (storedHeaders.inReplyTo) return storedHeaders;

  try {
    const provider = await getEmailProvider(accountId);
    const fetchedMessage = await provider.fetchMessage(messageId);
    await persistFetchedReplyHeaders(accountId, messageId, fetchedMessage);
    return buildReplyHeadersForParsedMessage(fetchedMessage);
  } catch (err) {
    console.warn("[replyHeaders] Failed to fetch source message headers:", err);
    return {};
  }
}
