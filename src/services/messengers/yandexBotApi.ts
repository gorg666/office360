import type {
  MessengerConversation,
  MessengerConversationKind,
  MessengerMessage,
  SendMessageParams,
} from "./botApiTypes";
import { messengerRequest } from "./messengerRequest";
import type { MessengerTarget } from "./credentials";

export interface YandexSendTextResponse {
  ok: boolean;
  message_id?: number;
  description?: string;
}

export interface YandexUserLink {
  ok: boolean;
  id?: string;
  chat_link?: string;
  call_link?: string;
  description?: string;
}

export interface YandexMessengerUpdateChat {
  type: string;
  id?: string;
}

export interface YandexMessengerUpdateFrom {
  id?: string;
  display_name?: string;
  login?: string;
  robot?: boolean;
}

export interface YandexMessengerUpdateFile {
  id?: string;
  name?: string;
  size?: number;
}

export interface YandexMessengerUpdate {
  message_id: number;
  timestamp: number;
  chat: YandexMessengerUpdateChat;
  from: YandexMessengerUpdateFrom;
  update_id: number;
  text?: string;
  sticker?: { id?: string; set_id?: string };
  images?: unknown[];
  file?: YandexMessengerUpdateFile;
}

export interface YandexGetUpdatesResponse {
  ok: boolean;
  updates?: YandexMessengerUpdate[];
  description?: string;
}

export function getYandexConversations(targets: MessengerTarget[]): MessengerConversation[] {
  return targets.map((target) => ({
    id: target.id,
    providerId: "yandex",
    kind: target.kind,
    title: target.title,
    subtitle: target.subtitle ?? (target.kind === "login" ? "Yandex login" : "Yandex chat_id"),
    updatedAt: target.updatedAt,
  }));
}

export async function fetchYandexMessengerUpdates(
  token: string,
  options: { offset?: number; limit?: number },
): Promise<YandexGetUpdatesResponse> {
  return messengerRequest<YandexGetUpdatesResponse>({
    providerId: "yandex",
    token,
    method: "GET",
    path: "/messages/getUpdates/",
    query: [
      ["limit", String(options.limit ?? 100)],
      ["offset", String(options.offset ?? 0)],
    ],
  });
}

export function conversationFromYandexUpdate(
  update: YandexMessengerUpdate,
): { kind: MessengerConversationKind; id: string; title: string } {
  const chatType = update.chat?.type ?? "";
  if (chatType === "private") {
    const login = update.from.login?.trim() || update.from.id?.trim() || "unknown";
    const title = update.from.display_name?.trim() || login;
    return { kind: "login", id: login, title };
  }
  const chatId = update.chat.id?.trim() || "unknown";
  return { kind: "chat", id: chatId, title: chatId };
}

function textFromYandexUpdate(update: YandexMessengerUpdate): string {
  if (update.text?.trim()) return update.text.trim();
  if (update.sticker?.id) return "[стикер]";
  if (Array.isArray(update.images) && update.images.length > 0) return "[изображение]";
  if (update.file?.name) return `[файл: ${update.file.name}]`;
  return "[сообщение]";
}

export function messengerMessageFromYandexUpdate(update: YandexMessengerUpdate): MessengerMessage {
  const { id } = conversationFromYandexUpdate(update);
  const author =
    update.from.display_name?.trim() ||
    update.from.login?.trim() ||
    update.from.id?.trim() ||
    "Собеседник";
  const ts = update.timestamp < 10_000_000_000 ? update.timestamp * 1000 : update.timestamp;
  return {
    id: `yandex-${update.update_id}-${update.message_id}`,
    providerId: "yandex",
    conversationId: id,
    direction: "incoming",
    author,
    text: textFromYandexUpdate(update),
    timestamp: ts,
    raw: update,
  };
}

export function mergeYandexConversationFromUpdate(
  update: YandexMessengerUpdate,
): MessengerConversation {
  const { kind, id, title } = conversationFromYandexUpdate(update);
  const ts = update.timestamp < 10_000_000_000 ? update.timestamp * 1000 : update.timestamp;
  return {
    id,
    providerId: "yandex",
    kind,
    title,
    subtitle: `${kind === "login" ? "login" : "chat_id"} · ${id}`,
    lastText: textFromYandexUpdate(update),
    updatedAt: ts,
    raw: update,
  };
}

/** Следующий offset для getUpdates: max(update_id) + 1 по текущей пачке (см. документацию API). */
export function nextYandexUpdateOffset(updates: YandexMessengerUpdate[]): number {
  let maxId = 0;
  for (const u of updates) {
    if (typeof u.update_id === "number" && u.update_id > maxId) {
      maxId = u.update_id;
    }
  }
  return maxId + 1;
}

export async function getYandexUserLink(token: string, login: string): Promise<YandexUserLink> {
  return messengerRequest<YandexUserLink>({
    providerId: "yandex",
    token,
    path: "/users/getUserLink",
    query: [["login", login]],
  });
}

export async function sendYandexMessage(token: string, params: SendMessageParams): Promise<YandexSendTextResponse> {
  const key = params.targetKind === "login" ? "login" : "chat_id";
  const response = await messengerRequest<YandexSendTextResponse>({
    providerId: "yandex",
    token,
    method: "POST",
    path: "/messages/sendText/",
    body: {
      [key]: params.targetId,
      text: params.text,
    },
  });

  if (!response.ok) {
    throw new Error(response.description ?? "Яндекс Messenger вернул ошибку отправки.");
  }

  return response;
}
