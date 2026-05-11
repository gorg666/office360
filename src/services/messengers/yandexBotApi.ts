import type {
  MessengerConversation,
  MessengerConversationKind,
  MessengerMessage,
  SendMessageParams,
} from "./botApiTypes";
import { messengerDownloadFile, messengerRequest, messengerSendFileBase64 } from "./messengerRequest";
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

export interface YandexMessengerUpdateImage {
  id?: string;
  file_id?: string;
  fileId?: string;
  width?: number;
  height?: number;
  size?: number;
  name?: string;
}

export interface YandexMessengerUpdate {
  message_id: number;
  timestamp: number;
  chat: YandexMessengerUpdateChat;
  from: YandexMessengerUpdateFrom;
  update_id: number;
  text?: string;
  sticker?: { id?: string; set_id?: string };
  images?: YandexMessengerUpdateImage[] | YandexMessengerUpdateImage;
  image?: YandexMessengerUpdateImage;
  photo?: YandexMessengerUpdateImage;
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
  if (imageCandidatesFromYandexUpdate(update).length > 0) return "[изображение]";
  if (update.file?.name) return `[файл: ${update.file.name}]`;
  return "[сообщение]";
}

function inferAttachmentKind(fileName: string | undefined): "audio" | "file" {
  const extension = fileName?.split(".").pop()?.toLowerCase();
  if (extension && ["mp3", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac", "webm"].includes(extension)) {
    return "audio";
  }
  return "file";
}

function stringField(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const field = record[key];
    if (typeof field === "string" && field.trim()) return field.trim();
  }
  return undefined;
}

function numberField(value: unknown, keys: string[]): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const field = record[key];
    if (typeof field === "number" && Number.isFinite(field)) return field;
  }
  return undefined;
}

function arrayField(value: unknown): unknown[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function imageCandidatesFromYandexUpdate(update: YandexMessengerUpdate): unknown[] {
  return [
    ...arrayField(update.images),
    ...arrayField(update.image),
    ...arrayField(update.photo),
  ];
}

function collectFileIds(value: unknown, ids: Set<string> = new Set()): Set<string> {
  if (!value || typeof value !== "object") return ids;
  if (Array.isArray(value)) {
    for (const item of value) collectFileIds(item, ids);
    return ids;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["file_id", "fileId", "id"]) {
    const field = record[key];
    if (typeof field === "string" && field.trim()) ids.add(field.trim());
  }
  for (const nestedKey of ["file", "original", "preview", "thumbnail", "sizes", "images", "image"]) {
    collectFileIds(record[nestedKey], ids);
  }
  return ids;
}

function attachmentsFromYandexUpdate(update: YandexMessengerUpdate): MessengerMessage["attachments"] {
  const attachments: NonNullable<MessengerMessage["attachments"]> = [];

  for (const image of imageCandidatesFromYandexUpdate(update)) {
    const ids = [...collectFileIds(image)];
    if (!ids.length) {
      console.warn("[yandex-messenger] image update has no file id:", image);
      continue;
    }
    for (const id of ids) {
      attachments.push({
        id,
        kind: "photo",
        title: stringField(image, ["name", "file_name", "fileName"]) ?? "Изображение",
        size: numberField(image, ["size"]),
        raw: image,
      });
    }
  }

  if (update.file?.id) {
    attachments.push({
      id: update.file.id,
      kind: inferAttachmentKind(update.file.name),
      title: update.file.name ?? "Файл",
      size: update.file.size,
      raw: update.file,
    });
  }

  return attachments.length ? attachments : undefined;
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
    attachments: attachmentsFromYandexUpdate(update),
    timestamp: ts,
    raw: update,
  };
}

export async function hydrateYandexMessageAttachments(
  token: string,
  messages: MessengerMessage[],
): Promise<MessengerMessage[]> {
  return Promise.all(messages.map(async (message) => {
    if (message.providerId !== "yandex" || !message.attachments?.length) return message;

    const attachments = await Promise.all(message.attachments.map(async (attachment) => {
      if (attachment.url || attachment.previewUrl) return attachment;
      if (attachment.kind !== "photo" && attachment.kind !== "audio") return attachment;
      try {
        const file = await messengerDownloadFile({
          providerId: "yandex",
          token,
          fileId: attachment.id,
          fileName: attachment.title,
        });
        return {
          ...attachment,
          url: file.dataUrl,
          previewUrl: attachment.kind === "photo" ? file.dataUrl : attachment.previewUrl,
          size: attachment.size ?? file.size,
          raw: {
            ...(typeof attachment.raw === "object" && attachment.raw ? attachment.raw : {}),
            mimeType: file.mimeType,
          },
        };
      } catch (error) {
        console.warn("[yandex-messenger] attachment download failed:", error);
        return attachment;
      }
    }));

    const hasHydratedPhoto = attachments.some((attachment) => attachment.kind === "photo" && (attachment.url || attachment.previewUrl));
    const normalizedAttachments = hasHydratedPhoto
      ? attachments.filter((attachment) => attachment.kind !== "photo" || attachment.url || attachment.previewUrl)
      : attachments;

    return { ...message, attachments: normalizedAttachments };
  }));
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

export async function sendYandexFile(token: string, params: {
  targetKind: MessengerConversationKind;
  targetId: string;
  fileName: string;
  mimeType?: string | null;
  dataBase64: string;
}): Promise<YandexSendTextResponse> {
  const response = await messengerSendFileBase64({
    providerId: "yandex",
    token,
    targetKind: params.targetKind,
    targetId: params.targetId,
    fileName: params.fileName,
    mimeType: params.mimeType,
    dataBase64: params.dataBase64,
  });

  if (!response.ok) {
    throw new Error(response.description ?? "Яндекс Messenger вернул ошибку отправки файла.");
  }

  return response;
}
