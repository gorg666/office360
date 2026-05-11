import { getActiveProvider } from "@/services/ai/providerManager";
import { getAllAccounts, getAccount, type DbAccount } from "@/services/db/accounts";
import { getAttachmentsForAccount, getAttachmentsForMessage, type AttachmentWithContext } from "@/services/db/attachments";
import { getMessagesForThread, type DbMessage } from "@/services/db/messages";
import { insertTask, type TaskPriority } from "@/services/db/tasks";
import { searchMessages, type SearchResult } from "@/services/db/search";
import { getDb } from "@/services/db/connection";
import { useAccountStore } from "@/stores/accountStore";
import { getCalendarProvider, hasCalendarSupport } from "@/services/calendar/providerFactory";
import { getEmailProvider } from "@/services/email/providerFactory";
import { sendEmail } from "@/services/emailActions";
import { buildRawEmail } from "@/utils/emailBuilder";
import { buildReplyHeadersForMessageId } from "@/utils/replyHeaders";
import type { MessengerConversation, MessengerMessage } from "./botApiTypes";
import { sendYandexFile } from "./yandexBotApi";

interface YandexAssistantToolParams {
  token: string;
  conversation: MessengerConversation;
  messages: MessengerMessage[];
  incomingMessage: MessengerMessage;
}

export interface YandexAssistantToolResult {
  handled: boolean;
  replyText?: string;
}

interface PendingEmailDraft {
  accountId: string;
  threadId: string;
  messageId: string;
  to: string;
  subject: string;
  htmlBody: string;
}

const PENDING_EMAIL_DRAFT_KEY = "velo_yandex_assistant_pending_email_drafts:v1";
const TOOL_CONTEXT_KEY = "velo_yandex_assistant_tool_context:v1";

interface ToolContext {
  lastMailSender?: string;
  lastMailQuery?: string;
  lastMailAccountId?: string;
  lastMailThreadId?: string;
}

interface DownloadableAttachment {
  message_id: string;
  account_id: string;
  filename: string | null;
  mime_type: string | null;
  gmail_attachment_id: string | null;
  imap_part_id?: string | null;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/@media[^{]*\{[\s\S]*?\}\s*\}/gi, " ")
    .replace(/@font-face[^{]*\{[\s\S]*?\}/gi, " ")
    .replace(/\.[a-z0-9_-]+\s*\{[^}]*\}/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/table>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeCssNoise(text: string): boolean {
  const sample = text.slice(0, 1200);
  const cssSignals = [
    /@media/i,
    /\.[a-z0-9_-]+\{[^}]+:[^}]+\}/i,
    /!important/i,
    /table\.body/i,
    /mso-hide/i,
    /-webkit-|box-sizing|font-size|line-height/i,
  ].filter((pattern) => pattern.test(sample)).length;
  return cssSignals >= 2;
}

function readableEmailText(message: DbMessage): string {
  const snippet = message.snippet?.trim() ?? "";
  const text = message.body_text?.trim() ?? "";
  const html = message.body_html?.trim() ?? "";

  if (text && !looksLikeCssNoise(text)) {
    return stripHtml(text);
  }

  const fromHtml = html ? stripHtml(html) : "";
  if (fromHtml && !looksLikeCssNoise(fromHtml)) {
    return fromHtml;
  }

  if (snippet && !looksLikeCssNoise(snippet)) {
    return stripHtml(snippet);
  }

  const cleanedText = text ? stripHtml(text) : "";
  if (cleanedText && !looksLikeCssNoise(cleanedText)) {
    return cleanedText;
  }

  return snippet || cleanedText || fromHtml;
}

function base64UrlToBase64(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  const padding = normalized.length % 4;
  return padding ? `${normalized}${"=".repeat(4 - padding)}` : normalized;
}

function formatDate(timestamp?: number | null): string {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp));
}

function extractQuotedOrTail(text: string, anchors: string[]): string {
  const quoted = text.match(/[«"']([^«»"']{2,})[»"']/)?.[1]?.trim();
  if (quoted) return quoted;

  const lower = text.toLowerCase();
  for (const anchor of anchors) {
    const index = lower.indexOf(anchor);
    if (index >= 0) {
      const tail = text.slice(index + anchor.length).replace(/^(с|по|про|на тему|:|-)\s+/i, "").trim();
      if (tail) return tail;
    }
  }
  return text.trim();
}

function isFileRequest(text: string): boolean {
  const lower = normalizeText(text);
  return /(найд|отыщ|поищ).*(файл|вложен|документ)|((пришли|отправь|скинь|перешли).*(файл|вложен|документ))/i.test(lower);
}

function isTaskRequest(text: string): boolean {
  return /(созда|добав|постав|заведи).{0,20}задач/i.test(text);
}

function isCalendarRequest(text: string): boolean {
  return /(календар|событи|встреч).*(покажи|найд|что|список)|((покажи|найд).*(календар|событи|встреч))/i.test(text);
}

function isMailRequest(text: string): boolean {
  return /(найд|поищ|покажи|пришли|расскажи|прочитай|открой|проверь).{0,50}письм|письм.{0,50}(содержан|найд|ответ|входящ|свеж|последн|тема|вложен|материал)|содержан.{0,40}письм|входящ.{0,40}письм|отправител[ья]?|тема\s+письм/i.test(text);
}

function isSendPendingEmailRequest(text: string): boolean {
  return /(отправь|отправить|да[, ]+отправ|подтверждаю).{0,30}письм/i.test(text);
}

function isMailFollowUp(text: string, context: ToolContext): boolean {
  return Boolean(
    context.lastMailSender &&
    /(сегодня|сегодняшн|вчера|последн|свеж|от него|от нее|от неё|за сегодня|с сегодняшнего дня)/i.test(text),
  );
}

function isLikelySenderLookup(text: string): boolean {
  const words = normalizeSearchTerm(text).split(" ").filter(Boolean);
  return words.length >= 2 && words.length <= 4 && words.every((word) => /^[\p{L}.-]+$/u.test(word));
}

function isLatestIncomingMailRequest(text: string): boolean {
  return /(само[её]\s+)?(свеж|последн).{0,40}(входящ|письм)|входящ.{0,40}(свеж|последн|письм)/i.test(text);
}

function isCurrentMailAttachmentRequest(text: string, context: ToolContext): boolean {
  if (!context.lastMailAccountId || !context.lastMailThreadId) return false;
  return /(вложен|файл|документ|материал).{0,40}(эт(ого|ом)|последн|найденн|письм|него|нее|неё)|(?:пришли|отправь|скинь|перешли).{0,40}(эт(о|и)|их|вложен)/i.test(text);
}

async function getDefaultAccount(): Promise<DbAccount | null> {
  const activeAccountId = useAccountStore.getState().activeAccountId;
  if (activeAccountId) {
    const active = await getAccount(activeAccountId);
    if (active) return active;
  }
  const accounts = await getAllAccounts();
  return accounts.find((account) => account.is_active === 1) ?? accounts[0] ?? null;
}

function loadPendingDraft(conversationId: string): PendingEmailDraft | null {
  try {
    const raw = localStorage.getItem(PENDING_EMAIL_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, PendingEmailDraft>;
    return parsed[conversationId] ?? null;
  } catch {
    return null;
  }
}

function savePendingDraft(conversationId: string, draft: PendingEmailDraft | null): void {
  try {
    const raw = localStorage.getItem(PENDING_EMAIL_DRAFT_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, PendingEmailDraft> : {};
    if (draft) {
      parsed[conversationId] = draft;
    } else {
      delete parsed[conversationId];
    }
    localStorage.setItem(PENDING_EMAIL_DRAFT_KEY, JSON.stringify(parsed));
  } catch {
    // best-effort
  }
}

function loadToolContext(conversationId: string): ToolContext {
  try {
    const raw = localStorage.getItem(TOOL_CONTEXT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ToolContext>;
    return parsed[conversationId] ?? {};
  } catch {
    return {};
  }
}

function saveToolContext(conversationId: string, context: ToolContext): void {
  try {
    const raw = localStorage.getItem(TOOL_CONTEXT_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, ToolContext> : {};
    parsed[conversationId] = context;
    localStorage.setItem(TOOL_CONTEXT_KEY, JSON.stringify(parsed));
  } catch {
    // best-effort
  }
}

function normalizeSearchTerm(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ё]/g, "е")
    .replace(/[^\p{L}\p{N}.@_-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSqlLikeValue(value: string): string {
  return `%${normalizeSearchTerm(value).replace(/[%_]/g, (char) => `\\${char}`)}%`;
}

function attachmentDownloadId(attachment: DownloadableAttachment): string | null {
  return attachment.gmail_attachment_id ?? attachment.imap_part_id ?? null;
}

function attachmentQueryWords(query: string): string[] {
  const stopWords = new Set([
    "найди",
    "найти",
    "отыщи",
    "поищи",
    "пришли",
    "отправь",
    "скинь",
    "мне",
    "пожалуйста",
    "файл",
    "файлы",
    "документ",
    "документы",
    "вложение",
    "вложения",
    "вложениях",
    "во",
    "в",
    "из",
    "по",
    "про",
    "нужный",
    "нужные",
  ]);

  return normalizeSearchTerm(query)
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length > 1 && !stopWords.has(word));
}

function scoreAttachment(attachment: AttachmentWithContext, words: string[]): number {
  const filename = normalizeSearchTerm(attachment.filename ?? "");
  const subject = normalizeSearchTerm(attachment.subject ?? "");
  const sender = normalizeSearchTerm([attachment.from_name, attachment.from_address].filter(Boolean).join(" "));
  const haystack = normalizeSearchTerm([filename, subject, sender].join(" "));

  let score = 0;
  for (const word of words) {
    if (filename === word || filename.startsWith(`${word}.`)) score += 10;
    else if (filename.includes(word)) score += 6;
    else if (subject.includes(word)) score += 3;
    else if (sender.includes(word)) score += 2;
    else if (haystack.includes(word)) score += 1;
    else return -1;
  }

  if (attachment.filename && !attachment.is_inline) score += 2;
  if (attachment.date) score += Math.min(2, attachment.date / 10_000_000_000_000);
  return score;
}

async function findAttachments(query: string, limit = 5): Promise<AttachmentWithContext[]> {
  const accounts = await getAllAccounts();
  const words = attachmentQueryWords(query);
  const all = (await Promise.all(accounts.map((account) => getAttachmentsForAccount(account.id, 2000))))
    .flat()
    .filter((attachment) => attachment.filename?.trim() && attachmentDownloadId(attachment));

  if (!words.length) return all.slice(0, limit);

  return all
    .map((attachment) => ({ attachment, score: scoreAttachment(attachment, words) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || (b.attachment.date ?? 0) - (a.attachment.date ?? 0))
    .slice(0, limit)
    .map((item) => item.attachment);
}

async function sendAttachmentsToYandex(
  params: YandexAssistantToolParams,
  attachments: DownloadableAttachment[],
): Promise<string[]> {
  const sent: string[] = [];
  for (const attachment of attachments) {
    const id = attachmentDownloadId(attachment);
    if (!id || !attachment.filename) continue;
    const provider = await getEmailProvider(attachment.account_id);
    const file = await provider.fetchAttachment(attachment.message_id, id);
    await sendYandexFile(params.token, {
      targetKind: params.conversation.kind,
      targetId: params.conversation.id,
      fileName: attachment.filename,
      mimeType: attachment.mime_type,
      dataBase64: base64UrlToBase64(file.data),
    });
    sent.push(`«${attachment.filename}»`);
  }
  return sent;
}

async function sendCurrentMailAttachments(params: YandexAssistantToolParams, context: ToolContext): Promise<YandexAssistantToolResult> {
  if (!context.lastMailAccountId || !context.lastMailThreadId) {
    return {
      handled: true,
      replyText: "Сначала найди письмо, а затем попроси прислать его вложения.",
    };
  }

  const messages = await getMessagesForThread(context.lastMailAccountId, context.lastMailThreadId);
  const attachments = (await Promise.all(
    messages.map((message) => getAttachmentsForMessage(context.lastMailAccountId!, message.id)),
  ))
    .flat()
    .filter((attachment) => attachment.filename?.trim() && attachmentDownloadId(attachment));

  if (!attachments.length) {
    return { handled: true, replyText: "В последнем найденном письме вложений не нашёл." };
  }

  const sent = await sendAttachmentsToYandex(params, attachments.slice(0, 5));
  return {
    handled: true,
    replyText: sent.length
      ? `Отправил вложения из последнего найденного письма: ${sent.join(", ")}.`
      : "Вложения нашёл, но не смог получить их содержимое для отправки.",
  };
}

async function handleFileRequest(params: YandexAssistantToolParams): Promise<YandexAssistantToolResult> {
  const context = loadToolContext(params.conversation.id);
  if (isCurrentMailAttachmentRequest(params.incomingMessage.text, context)) {
    return sendCurrentMailAttachments(params, context);
  }

  const query = params.incomingMessage.text;
  const attachments = await findAttachments(query, /файлы|документы|вложения/i.test(params.incomingMessage.text) ? 5 : 1);
  if (!attachments.length) {
    return {
      handled: true,
      replyText: `Не нашёл подходящий файл по запросу: ${query}. Попробуй указать часть имени файла, отправителя или тему письма.`,
    };
  }

  const sent = await sendAttachmentsToYandex(params, attachments);

  return {
    handled: true,
    replyText: sent.length
      ? `Нашёл и отправил ${sent.length === 1 ? "файл" : "файлы"}: ${attachments.map((attachment) => `«${attachment.filename}» из письма «${attachment.subject ?? "без темы"}»`).join(", ")}.`
      : `Файлы нашёл, но не смог получить их содержимое для отправки.`,
  };
}

function parsePriority(text: string): TaskPriority {
  const lower = normalizeText(text);
  if (/срочн|urgent|важн/.test(lower)) return "urgent";
  if (/высок/.test(lower)) return "high";
  if (/средн/.test(lower)) return "medium";
  if (/низк/.test(lower)) return "low";
  return "none";
}

function parseDueDate(text: string): number | null {
  const lower = normalizeText(text);
  const date = new Date();
  if (/сегодня/.test(lower)) {
    date.setHours(18, 0, 0, 0);
    return Math.floor(date.getTime() / 1000);
  }
  if (/завтра/.test(lower)) {
    date.setDate(date.getDate() + 1);
    date.setHours(18, 0, 0, 0);
    return Math.floor(date.getTime() / 1000);
  }
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (iso) {
    const parsed = new Date(`${iso}T18:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : Math.floor(parsed.getTime() / 1000);
  }
  const ru = text.match(/\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\b/);
  if (ru) {
    const day = Number(ru[1]);
    const month = Number(ru[2]) - 1;
    const year = ru[3] ? Number(ru[3].length === 2 ? `20${ru[3]}` : ru[3]) : new Date().getFullYear();
    const parsed = new Date(year, month, day, 18, 0, 0, 0);
    return Number.isNaN(parsed.getTime()) ? null : Math.floor(parsed.getTime() / 1000);
  }
  return null;
}

async function handleTaskRequest(params: YandexAssistantToolParams): Promise<YandexAssistantToolResult> {
  const account = await getDefaultAccount();
  const title = extractQuotedOrTail(params.incomingMessage.text, ["задачу", "задача", "создай", "добавь", "поставь"])
    .replace(/^задач[ауи]?\s*/i, "")
    .trim();
  if (!title) {
    return { handled: true, replyText: "Не понял название задачи. Напиши, например: «создай задачу позвонить клиенту завтра»." };
  }

  const id = await insertTask({
    accountId: account?.id ?? null,
    title,
    description: `Создано из Яндекс-чата: ${params.incomingMessage.text}`,
    priority: parsePriority(params.incomingMessage.text),
    dueDate: parseDueDate(params.incomingMessage.text),
  });
  window.dispatchEvent(new CustomEvent("velo-task-created", {
    detail: { taskId: id, accountId: account?.id ?? null },
  }));

  return { handled: true, replyText: `Создал задачу: «${title}». ID: ${id}` };
}

function mailQueryWords(query: string): string[] {
  const cleaned = stripMailSearchNoise(query)
    .replace(/\b(письмо|письма|почта|почте|материал|материалы|содержание|текст|тема)\b/gi, " ");
  return attachmentQueryWords(cleaned);
}

async function searchMessagesBySql(query: string): Promise<SearchResult[]> {
  const words = mailQueryWords(query);
  if (!words.length) return [];

  const db = await getDb();
  const params: unknown[] = [];
  const conditions: string[] = [];
  for (const word of words) {
    params.push(normalizeSqlLikeValue(word));
    conditions.push(`LOWER(REPLACE(
      COALESCE(m.subject, '') || ' ' ||
      COALESCE(m.from_name, '') || ' ' ||
      COALESCE(m.from_address, '') || ' ' ||
      COALESCE(m.snippet, '') || ' ' ||
      COALESCE(m.body_text, ''),
      'ё', 'е'
    )) LIKE $${params.length} ESCAPE '\\'`);
  }

  return db.select<SearchResult[]>(
    `SELECT
       m.id as message_id,
       m.account_id,
       m.thread_id,
       m.subject,
       m.from_name,
       m.from_address,
       m.snippet,
       m.date,
       0 as rank
     FROM messages m
     WHERE ${conditions.join(" AND ")}
     ORDER BY m.date DESC
     LIMIT 5`,
    params,
  );
}

async function searchBestMessage(query: string): Promise<{ result: SearchResult; messages: DbMessage[] } | null> {
  let results: SearchResult[] = [];
  try {
    results = await searchMessages(query, undefined, 5);
  } catch {
    results = [];
  }
  if (!results.length) {
    results = await searchMessagesBySql(query);
  }
  const first = results[0];
  if (!first) return null;
  const messages = await getMessagesForThread(first.account_id, first.thread_id);
  return { result: first, messages };
}

function extractMailSender(text: string, context?: ToolContext): string | null {
  if (isLikelySenderLookup(text)) return text.trim();

  const senderStop = String.raw`(?:[,.;]|\s+про\b|\s+по\s+тем[еуы]\b|\s+с\s+тем[оы]\b|\s+на\s+тему\b|\s+за\s+(?:сегодня|вчера|\d)|\s+сегодня\b|\s+вчера\b|\s+найди\b|\s+найти\b|\s+письм|\s+сообщен|$)`;
  const explicit = text.match(new RegExp(String.raw`отправител[ья]?\s+(.+?)${senderStop}`, "i"))?.[1]?.trim();
  if (explicit) return explicit;

  const from = text.match(new RegExp(String.raw`(?:письм[оа]?|сообщени[ея]|сообщение\s+на\s+почту).{0,50}\sот\s+([А-Яа-яЁёA-Za-z0-9 ._-]{2,80})${senderStop}`, "i"))?.[1]?.trim();
  if (from && !/(него|нее|неё|сегодня|вчера|дня)/i.test(from)) return from;

  if (/(от него|от нее|от неё)/i.test(text)) return context?.lastMailSender ?? null;
  return context?.lastMailSender && isMailFollowUp(text, context) ? context.lastMailSender : null;
}

function senderQueryWords(sender: string): string[] {
  return normalizeSearchTerm(sender)
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length > 1);
}

function stripMailSearchNoise(text: string): string {
  return text
    .replace(/отправител[ья]?\s+.+?(?=,|\.|;|\s+найди|\s+найти|\s+письм|$)/i, " ")
    .replace(/\bот\s+[А-Яа-яЁёA-Za-z0-9 ._-]{2,80}(?=,|\.|;|\s+про\b|\s+по\s+тем[еуы]\b|\s+с\s+тем[оы]\b|\s+на\s+тему\b|\s+за\s+(?:сегодня|вчера|\d)|\s+сегодня\b|\s+вчера\b|$)/i, " ")
    .replace(/\b(про|по\s+тем[еуы]|с\s+тем[оы]|на\s+тему)\b/gi, " ")
    .replace(/\b(найди|найти|поищи|покажи|пришли|самое|последнее|свежее|письмо|письма|сообщение|сообщения|от него|от нее|от неё|от сегодняшнего дня|за сегодня|сегодня|вчера)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDateLowerBound(text: string): number | null {
  const lower = normalizeText(text);
  const date = new Date();
  if (/сегодня|сегодняшн|за сегодня/.test(lower)) {
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }
  if (/вчера/.test(lower)) {
    date.setDate(date.getDate() - 1);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (iso) {
    const parsed = new Date(`${iso}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }
  const ru = text.match(/\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\b/);
  if (ru) {
    const day = Number(ru[1]);
    const month = Number(ru[2]) - 1;
    const year = ru[3] ? Number(ru[3].length === 2 ? `20${ru[3]}` : ru[3]) : new Date().getFullYear();
    const parsed = new Date(year, month, day, 0, 0, 0, 0);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }
  return null;
}

async function searchLatestMessageBySender(
  sender: string,
  afterMs: number | null,
  contentQuery: string,
): Promise<{ result: SearchResult; messages: DbMessage[] } | null> {
  const db = await getDb();
  const senderWords = senderQueryWords(sender);
  const params: unknown[] = [];
  const senderConditions: string[] = [];
  const senderScoreParts: string[] = [];
  for (const word of senderWords.length ? senderWords : [sender]) {
    params.push(normalizeSqlLikeValue(word));
    const expression = `LOWER(REPLACE(COALESCE(from_name, '') || ' ' || COALESCE(from_address, ''), 'ё', 'е')) LIKE $${params.length} ESCAPE '\\'`;
    senderConditions.push(expression);
    senderScoreParts.push(`CASE WHEN ${expression} THEN 1 ELSE 0 END`);
  }
  let dateFilter = "";
  if (afterMs) {
    params.push(afterMs, Math.floor(afterMs / 1000));
    dateFilter = `AND (
       date >= $${params.length - 1}
       OR (date < 10000000000 AND date >= $${params.length})
     )`;
  }

  const queryWords = attachmentQueryWords(contentQuery);
  let contentFilter = "";
  if (queryWords.length > 0) {
    const conditions: string[] = [];
    for (const word of queryWords) {
      params.push(normalizeSqlLikeValue(word));
      conditions.push(`LOWER(REPLACE(COALESCE(subject, '') || ' ' || COALESCE(snippet, '') || ' ' || COALESCE(body_text, ''), 'ё', 'е')) LIKE $${params.length} ESCAPE '\\'`);
    }
    contentFilter = `AND ${conditions.join(" AND ")}`;
  }

  const rows = await db.select<DbMessage[]>(
    `SELECT *
     FROM messages
     WHERE ${senderConditions.join(" AND ")}
       ${dateFilter}
       ${contentFilter}
     ORDER BY date DESC
     LIMIT 1`,
    params,
  );
  let message = rows[0];
  if (!message && senderConditions.length > 1) {
    const fallbackRows = await db.select<DbMessage[]>(
      `SELECT *
       FROM messages
       WHERE (${senderConditions.join(" OR ")})
         ${dateFilter}
         ${contentFilter}
       ORDER BY (${senderScoreParts.join(" + ")}) DESC, date DESC
       LIMIT 1`,
      params,
    );
    message = fallbackRows[0];
  }
  if (!message && contentFilter) {
    return searchLatestMessageBySender(sender, afterMs, "");
  }
  if (!message) return null;

  const messages = await getMessagesForThread(message.account_id, message.thread_id);
  return {
    result: {
      message_id: message.id,
      account_id: message.account_id,
      thread_id: message.thread_id,
      subject: message.subject,
      from_name: message.from_name,
      from_address: message.from_address,
      snippet: message.snippet,
      date: message.date,
      rank: 0,
    },
    messages,
  };
}

async function searchLatestIncomingMessage(afterMs: number | null): Promise<{ result: SearchResult; messages: DbMessage[] } | null> {
  const db = await getDb();
  const params: unknown[] = [];
  let dateFilter = "";
  if (afterMs) {
    params.push(afterMs, Math.floor(afterMs / 1000));
    dateFilter = `AND (
       m.date >= $${params.length - 1}
       OR (m.date < 10000000000 AND m.date >= $${params.length})
     )`;
  }

  const rows = await db.select<DbMessage[]>(
    `SELECT m.*
     FROM messages m
     LEFT JOIN accounts a ON a.id = m.account_id
     WHERE COALESCE(TRIM(m.from_address), '') != ''
       AND LOWER(COALESCE(m.from_address, '')) != LOWER(COALESCE(a.email, ''))
       ${dateFilter}
     ORDER BY m.date DESC
     LIMIT 1`,
    params,
  );
  const message = rows[0];
  if (!message) return null;

  const messages = await getMessagesForThread(message.account_id, message.thread_id);
  return {
    result: {
      message_id: message.id,
      account_id: message.account_id,
      thread_id: message.thread_id,
      subject: message.subject,
      from_name: message.from_name,
      from_address: message.from_address,
      snippet: message.snippet,
      date: message.date,
      rank: 0,
    },
    messages,
  };
}

async function formatThreadContent(result: SearchResult, messages: DbMessage[]): Promise<string> {
  const visibleMessages = messages.slice(-5);
  const attachmentsByMessage = await Promise.all(
    visibleMessages.map((message) => getAttachmentsForMessage(message.account_id, message.id)),
  );
  const parts = visibleMessages.map((message, index) => {
    const body = readableEmailText(message).slice(0, 1800);
    const attachments = attachmentsByMessage[index]
      ?.filter((attachment) => attachment.filename?.trim() && attachment.is_inline === 0)
      .map((attachment) => {
        const size = attachment.size ? `, ${Math.ceil(attachment.size / 1024)} КБ` : "";
        return `${attachment.filename}${size}`;
      });
    return [
      `От: ${message.from_name || message.from_address || "неизвестно"}`,
      `Дата: ${formatDate(message.date)}`,
      `Текст: ${body || "(тело письма не загружено)"}`,
      attachments?.length ? `Вложения: ${attachments.join("; ")}` : "",
    ].join("\n");
  });
  return [
    `Нашёл письмо: «${result.subject ?? "без темы"}»`,
    `Отправитель: ${result.from_name || result.from_address || "неизвестно"}`,
    "",
    parts.join("\n\n---\n\n"),
  ].join("\n");
}

function extractRecipient(message: DbMessage): string | null {
  return message.reply_to || message.from_address;
}

async function generateEmailReply(messages: DbMessage[], comments: string): Promise<string> {
  const provider = await getActiveProvider();
  const emailContext = messages.map((message) => {
    const body = readableEmailText(message);
    return `От: ${message.from_name || message.from_address || "неизвестно"}\nТема: ${message.subject ?? ""}\n${body.slice(0, 2500)}`;
  }).join("\n\n---\n\n");
  return provider.complete({
    systemPrompt: "Ты помогаешь подготовить короткий деловой ответ на письмо. Верни только готовый текст письма на русском, без markdown и пояснений.",
    userContent: `Исходная переписка:\n${emailContext}\n\nКомментарии пользователя для ответа:\n${comments}`,
    maxTokens: 700,
    temperature: 0.45,
  });
}

async function handleSendPendingEmail(params: YandexAssistantToolParams): Promise<YandexAssistantToolResult> {
  const pending = loadPendingDraft(params.conversation.id);
  if (!pending) {
    return { handled: true, replyText: "Нет подготовленного письма для отправки. Сначала попроси найти письмо и подготовить ответ." };
  }

  const account = await getAccount(pending.accountId);
  if (!account) return { handled: true, replyText: "Не нашёл аккаунт для отправки подготовленного письма." };

  const headers = await buildReplyHeadersForMessageId(pending.accountId, pending.messageId);
  const raw = buildRawEmail({
    from: account.email,
    to: [pending.to],
    subject: pending.subject.startsWith("Re:") ? pending.subject : `Re: ${pending.subject}`,
    htmlBody: pending.htmlBody,
    inReplyTo: headers.inReplyTo,
    references: headers.references,
    threadId: pending.threadId,
  });
  const result = await sendEmail(pending.accountId, raw, pending.threadId);
  if (!result.success) {
    return { handled: true, replyText: `Не удалось отправить письмо: ${result.error ?? "неизвестная ошибка"}` };
  }

  savePendingDraft(params.conversation.id, null);
  return { handled: true, replyText: result.queued ? "Письмо поставлено в очередь отправки." : "Письмо отправлено." };
}

async function handleMailRequest(params: YandexAssistantToolParams): Promise<YandexAssistantToolResult> {
  const context = loadToolContext(params.conversation.id);
  const latestIncoming = isLatestIncomingMailRequest(params.incomingMessage.text);
  const sender = latestIncoming ? null : extractMailSender(params.incomingMessage.text, context);
  const afterMs = parseDateLowerBound(params.incomingMessage.text);
  const query = extractQuotedOrTail(params.incomingMessage.text, ["письмо", "письма", "найди", "поищи", "ответ"]);
  const contentQuery = stripMailSearchNoise(params.incomingMessage.text);
  const found = latestIncoming
    ? await searchLatestIncomingMessage(afterMs)
    : sender
      ? await searchLatestMessageBySender(sender, afterMs, contentQuery)
      : await searchBestMessage(query);
  if (!found) {
    if (sender) {
      saveToolContext(params.conversation.id, {
        ...context,
        lastMailSender: sender,
        lastMailQuery: query,
      });
    }
    const details = [
      latestIncoming ? "последнее входящее" : "",
      sender ? `отправитель: ${sender}` : `запрос: ${query}`,
      afterMs ? `с даты: ${formatDate(afterMs)}` : "",
    ].filter(Boolean).join(", ");
    return { handled: true, replyText: `Не нашёл письмо (${details}).` };
  }

  saveToolContext(params.conversation.id, {
    ...context,
    lastMailSender: latestIncoming ? context.lastMailSender : sender ?? found.result.from_name ?? found.result.from_address ?? context.lastMailSender,
    lastMailQuery: query,
    lastMailAccountId: found.result.account_id,
    lastMailThreadId: found.result.thread_id,
  });

  const wantsReply = /(подготов|ответ|напиши).{0,30}ответ|ответь/i.test(params.incomingMessage.text);
  if (!wantsReply) {
    const content = await formatThreadContent(found.result, found.messages);
    return { handled: true, replyText: content.slice(0, 5000) };
  }

  const lastIncoming = [...found.messages].reverse().find((message) => message.from_address);
  const recipient = lastIncoming ? extractRecipient(lastIncoming) : null;
  if (!lastIncoming || !recipient) {
    return { handled: true, replyText: "Письмо нашёл, но не смог определить получателя для ответа." };
  }

  const body = await generateEmailReply(found.messages, params.incomingMessage.text);
  savePendingDraft(params.conversation.id, {
    accountId: found.result.account_id,
    threadId: found.result.thread_id,
    messageId: lastIncoming.id,
    to: recipient,
    subject: found.result.subject ?? "",
    htmlBody: body.replace(/\n/g, "<br>"),
  });

  return {
    handled: true,
    replyText: `Нашёл письмо «${found.result.subject ?? "без темы"}» и подготовил ответ:\n\n${body}\n\nЧтобы отправить, напиши: «отправь письмо».`,
  };
}

async function handleCalendarRequest(params: YandexAssistantToolParams): Promise<YandexAssistantToolResult> {
  const account = await getDefaultAccount();
  if (!account || !(await hasCalendarSupport(account.id))) {
    return { handled: true, replyText: "Не нашёл подключённый календарь для активного аккаунта." };
  }
  const provider = await getCalendarProvider(account.id);
  const calendars = await provider.listCalendars();
  const calendar = calendars.find((item) => item.isPrimary) ?? calendars[0];
  if (!calendar) return { handled: true, replyText: "Календарей не найдено." };

  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + (/недел/i.test(params.incomingMessage.text) ? 7 : 1));
  const events = await provider.fetchEvents(calendar.remoteId, start.toISOString(), end.toISOString());
  if (!events.length) return { handled: true, replyText: `В календаре «${calendar.displayName}» ближайших событий не нашёл.` };

  return {
    handled: true,
    replyText: [
      `Ближайшие события в календаре «${calendar.displayName}»:`,
      ...events.slice(0, 8).map((event) => `- ${formatDate(event.startTime)}: ${event.summary ?? "Без названия"}`),
    ].join("\n"),
  };
}

export async function executeYandexAssistantTools(params: YandexAssistantToolParams): Promise<YandexAssistantToolResult> {
  const text = params.incomingMessage.text.trim();
  if (!text) return { handled: false };
  const context = loadToolContext(params.conversation.id);

  if (isSendPendingEmailRequest(text)) return handleSendPendingEmail(params);
  if (isCurrentMailAttachmentRequest(text, context)) return sendCurrentMailAttachments(params, context);
  if (isFileRequest(text)) return handleFileRequest(params);
  if (isTaskRequest(text)) return handleTaskRequest(params);
  if (
    isMailRequest(text) ||
    isLikelySenderLookup(text) ||
    isLatestIncomingMailRequest(text) ||
    isMailFollowUp(text, context)
  ) return handleMailRequest(params);
  if (isCalendarRequest(text)) return handleCalendarRequest(params);

  return { handled: false };
}
