import { invoke } from "@tauri-apps/api/core";
import type { MessengerAttachment, MessengerConversation, MessengerMessage, SendMessageParams } from "./botApiTypes";

export interface MaxBotInfo {
  user_id: number;
  first_name?: string;
  username?: string | null;
  name?: string | null;
  is_bot?: boolean;
}

interface MaxName {
  name?: string;
  firstName?: string;
  lastName?: string;
}

interface MaxContact {
  id?: number;
  names?: MaxName[];
  phone?: number;
}

interface MaxSession {
  profile?: {
    contact?: MaxContact;
  };
  chats?: MaxChat[];
  contacts?: MaxContact[] | Record<string, MaxContact>;
  users?: MaxContact[] | Record<string, MaxContact>;
  messages?: Record<string, MaxMessage[]>;
  [key: string]: unknown;
}

interface MaxChat {
  id?: number;
  chat_id?: number;
  title?: string;
  type?: string;
  status?: string;
  last_event_time?: number;
  lastEventTime?: number;
  time?: number;
  lastMessage?: MaxMessage;
  last_message?: MaxMessage;
  participants?: number[] | Record<string, number | unknown>;
  participantsCount?: number;
  owner?: number;
  name?: string;
  chatTitle?: string;
  [key: string]: unknown;
}

interface MaxMessage {
  id?: number | string;
  message_id?: string;
  sender?: number | { user_id?: number; username?: string | null; first_name?: string; last_name?: string; name?: string | null };
  senderId?: number;
  recipient?: { chat_id?: number; user_id?: number };
  timestamp?: number;
  time?: number;
  text?: string | null;
  message?: {
    text?: string | null;
    attaches?: Array<Record<string, unknown>>;
    attachments?: Array<Record<string, unknown>>;
  } | null;
  body?: {
    mid?: string;
    text?: string | null;
    attachments?: Array<Record<string, unknown>>;
  } | null;
  attaches?: Array<Record<string, unknown>>;
  attachments?: Array<Record<string, unknown>>;
  link?: unknown;
  [key: string]: unknown;
}

interface MaxHistoryResponse {
  payload?: unknown;
  messages?: MaxMessage[];
  [key: string]: unknown;
}

function getMaxChatId(chat: MaxChat): string | null {
  if (typeof chat.id === "number") return String(chat.id);
  if (typeof chat.chat_id === "number") return String(chat.chat_id);
  return null;
}

function messageText(message: MaxMessage | undefined): string {
  if (!message) return "Событие MAX";
  const nestedMessage = isRecord(message.message) ? message.message : null;
  const body = isRecord(message.body) ? message.body : null;
  const text = stringValue(body?.text) ?? stringValue(nestedMessage?.text) ?? stringValue(message.text);
  const attachments = message.body?.attachments ?? message.message?.attaches ?? message.message?.attachments ?? message.attaches ?? message.attachments;
  if (text?.trim()) return text;
  if (attachments?.length) return `Вложения: ${attachments.length}`;
  if (message.link) return "Пересланное/ответное сообщение";
  return "Сообщение без текста";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function getMaxAttachments(message: MaxMessage | undefined): MessengerAttachment[] {
  const attachments = message?.body?.attachments ?? message?.message?.attaches ?? message?.message?.attachments ?? message?.attaches ?? message?.attachments;
  if (!attachments?.length) return [];

  return attachments.flatMap<MessengerAttachment>((attachment, index) => {
    const type = String(attachment._type ?? attachment.type ?? "").toUpperCase();
    const id = String(attachment.photoId ?? attachment.videoId ?? attachment.fileId ?? attachment.audioId ?? attachment.contactId ?? index);
    const title = String(attachment.name ?? attachment.fileName ?? attachment.title ?? (type || "Вложение"));
    if (type === "PHOTO") {
      const baseUrl = typeof attachment.baseUrl === "string" ? attachment.baseUrl : undefined;
      const previewData = typeof attachment.previewData === "string" ? attachment.previewData : undefined;
      return [{
        id: `photo-${id}`,
        kind: "photo" as const,
        title: title === "PHOTO" ? "Изображение" : title,
        url: baseUrl,
        previewUrl: previewData ? `data:image/jpeg;base64,${previewData}` : baseUrl,
        raw: attachment,
      }];
    }
    if (type === "VIDEO") {
      const thumbnail = typeof attachment.thumbnail === "string" ? attachment.thumbnail : undefined;
      return [{
        id: `video-${id}`,
        kind: "video" as const,
        title: title === "VIDEO" ? "Видео" : title,
        previewUrl: thumbnail,
        raw: attachment,
      }];
    }
    if (type === "FILE") {
      return [{
        id: `file-${id}`,
        kind: "file" as const,
        title,
        size: typeof attachment.size === "number" ? attachment.size : undefined,
        raw: attachment,
      }];
    }
    if (type === "AUDIO") {
      return [{
        id: `audio-${id}`,
        kind: "audio" as const,
        title: "Аудио",
        raw: attachment,
      }];
    }
    if (type === "CONTACT") {
      return [{
        id: `contact-${id}`,
        kind: "contact" as const,
        title: String(attachment.name ?? "Контакт"),
        previewUrl: typeof attachment.photoUrl === "string" ? attachment.photoUrl : undefined,
        raw: attachment,
      }];
    }
    return [];
  });
}

function contactName(contact: MaxContact | undefined): string {
  const name = contact?.names?.[0];
  const fullName = [name?.firstName, name?.lastName].filter(Boolean).join(" ").trim();
  return (name?.name ?? fullName) || "MAX";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMaxMessage(value: unknown): value is MaxMessage {
  if (!isRecord(value)) return false;
  return (
    isRecord(value.message)
    || isRecord(value.body)
    || typeof value.text === "string"
    || typeof value.id === "number"
    || typeof value.id === "string"
    || typeof value.message_id === "string"
  );
}

function extractHistoryMessages(value: unknown): MaxMessage[] {
  if (Array.isArray(value)) {
    const directMessages = value.filter(isMaxMessage);
    if (directMessages.length) return directMessages;
    return value.flatMap(extractHistoryMessages);
  }

  if (!isRecord(value)) return [];

  const knownContainers = [
    value.messages,
    value.items,
    value.history,
    value.entries,
    value.payload,
    value.data,
  ];
  for (const container of knownContainers) {
    const messages = extractHistoryMessages(container);
    if (messages.length) return messages;
  }

  return isMaxMessage(value) ? [value] : [];
}

function collectContacts(value: unknown, map: Map<string, MaxContact>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isRecord(item) && typeof item.id === "number") {
        map.set(String(item.id), item as MaxContact);
      }
    }
    return;
  }

  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (isRecord(item)) {
        const contact = item as MaxContact;
        const id = typeof contact.id === "number" ? String(contact.id) : key;
        map.set(id, { ...contact, id: Number(id) || contact.id });
      }
    }
  }
}

function contactMapFromSession(data: MaxSession): Map<string, MaxContact> {
  const map = new Map<string, MaxContact>();
  collectContacts(data.contacts, map);
  collectContacts(data.users, map);
  if (data.profile?.contact?.id) {
    map.set(String(data.profile.contact.id), data.profile.contact);
  }
  return map;
}

function participantIds(chat: MaxChat): string[] {
  const participants = chat.participants;
  if (Array.isArray(participants)) return participants.map(String);
  if (isRecord(participants)) return Object.keys(participants);
  return [];
}

function readableChatTitle(chat: MaxChat, id: string, contacts: Map<string, MaxContact>, profileId: string | null): string {
  const explicitTitle = chat.title ?? chat.name ?? chat.chatTitle;
  if (explicitTitle?.trim()) return explicitTitle;

  const ids = participantIds(chat).filter((participantId) => participantId !== profileId);
  const namedParticipants = ids
    .map((participantId) => contacts.get(participantId))
    .filter((contact): contact is MaxContact => Boolean(contact))
    .map(contactName)
    .filter((name) => name && name !== "MAX");

  if ((chat.type === "DIALOG" || chat.participantsCount === 2) && namedParticipants[0]) {
    return namedParticipants[0];
  }

  const lastMessage = chat.lastMessage ?? chat.last_message;
  const senderId = lastMessage ? getSenderId(lastMessage) : null;
  const senderName = senderId && senderId !== profileId ? contacts.get(senderId) : null;
  if (senderName) return contactName(senderName);

  if (namedParticipants.length) {
    const visibleNames = namedParticipants.slice(0, 3).join(", ");
    const rest = Math.max(0, namedParticipants.length - 3);
    return rest ? `${visibleNames} +${rest}` : visibleNames;
  }

  return `Чат ${id}`;
}

function getSenderId(message: MaxMessage): string | null {
  if (typeof message.sender === "number") return String(message.sender);
  const senderId = message.sender?.user_id ?? message.senderId;
  return typeof senderId === "number" ? String(senderId) : null;
}

function getSenderName(message: MaxMessage): string {
  if (typeof message.sender === "number") return `Пользователь ${message.sender}`;
  const sender = message.sender;
  const author = [sender?.first_name, sender?.last_name].filter(Boolean).join(" ").trim();
  return (sender?.username ?? author) || sender?.name || (message.senderId ? `Пользователь ${message.senderId}` : "MAX");
}

function normalizeMaxMessage(message: MaxMessage, conversationId: string, profileId: string | null): MessengerMessage {
  const senderId = getSenderId(message);
  const isOutgoing = Boolean(profileId && senderId === profileId);
  return {
    id: String(message.id ?? message.message_id ?? message.body?.mid ?? `${conversationId}-${message.timestamp ?? message.time ?? Date.now()}`),
    providerId: "max",
    conversationId,
    direction: isOutgoing ? "outgoing" : "incoming",
    author: isOutgoing ? "Вы" : getSenderName(message),
    text: messageText(message),
    attachments: getMaxAttachments(message),
    timestamp: message.timestamp ?? message.time,
    raw: message,
  };
}

function normalizeSessionMessage(message: MaxMessage, conversationId: string, profileId: string | null): MessengerMessage {
  return normalizeMaxMessage(message, conversationId, profileId);
}

function normalizeSession(data: MaxSession): { profileId: string | null; conversations: MessengerConversation[] } {
  const profileId = data.profile?.contact?.id ? String(data.profile.contact.id) : null;
  const contacts = contactMapFromSession(data);
  const conversations = (data.chats ?? []).flatMap((chat) => {
    const id = getMaxChatId(chat);
    if (!id) return [];
    const lastMessage = chat.lastMessage ?? chat.last_message;
    return [{
      id,
      providerId: "max" as const,
      kind: "chat" as const,
      title: readableChatTitle(chat, id, contacts, profileId),
      subtitle: chat.type ?? chat.status ?? "MAX client chat",
      lastText: lastMessage ? messageText(lastMessage) : undefined,
      updatedAt: chat.lastEventTime ?? chat.last_event_time ?? chat.time,
      raw: chat,
    }];
  });
  return { profileId, conversations };
}

export async function getMaxMe(token: string): Promise<MaxBotInfo> {
  const session = await invoke<MaxSession>("max_client_get_session", { token });
  const contact = session.profile?.contact;
  const name = contact?.names?.[0];
  return {
    user_id: contact?.id ?? 0,
    first_name: name?.firstName,
    name: contactName(contact),
    is_bot: false,
  };
}

export async function getMaxConversations(token: string): Promise<MessengerConversation[]> {
  const session = await invoke<MaxSession>("max_client_get_session", { token });
  return normalizeSession(session).conversations;
}

export async function getMaxUpdates(token: string, marker: number | null): Promise<{
  conversations: MessengerConversation[];
  messages: MessengerMessage[];
  marker: number | null;
}> {
  void marker;
  const session = await invoke<MaxSession>("max_client_get_session", { token });
  return { conversations: normalizeSession(session).conversations, messages: [], marker: null };
}

export async function connectMaxClient(token: string): Promise<MessengerConversation[]> {
  const session = await invoke<MaxSession>("max_client_connect", { token });
  return normalizeSession(session).conversations;
}

export async function disconnectMaxClient(): Promise<void> {
  await invoke("max_client_disconnect");
}

export function normalizeMaxClientEvent(event: unknown, profileId: string | null): {
  conversation: MessengerConversation | null;
  message: MessengerMessage | null;
} {
  const data = event as {
    opcode?: number;
    payload?: {
      chatId?: number | string;
      chat_id?: number | string;
      message?: MaxMessage;
      messages?: MaxMessage[];
      timestamp?: number;
      time?: number;
    };
  };
  const payload = data.payload;
  const liveMessage = payload?.message ?? extractHistoryMessages(payload)[0];
  const chatId = payload?.chatId ?? payload?.chat_id ?? liveMessage?.recipient?.chat_id;

  if (typeof chatId !== "number" && typeof chatId !== "string") {
    return { conversation: null, message: null };
  }

  if (!liveMessage) {
    return { conversation: null, message: null };
  }

  const conversationId = String(chatId);
  const message = normalizeMaxMessage(liveMessage, conversationId, profileId);
  return {
    conversation: {
      id: conversationId,
      providerId: "max",
      kind: "chat",
      title: `Чат ${conversationId}`,
      subtitle: "MAX client chat",
      lastText: message.text,
      updatedAt: message.timestamp ?? payload?.timestamp ?? payload?.time ?? Date.now(),
      raw: event,
    },
    message,
  };
}

export async function getMaxMessages(token: string, chatId: string): Promise<MessengerMessage[]> {
  const session = await invoke<MaxSession>("max_client_get_session", { token });
  const profileId = normalizeSession(session).profileId;
  const data = await invoke<MaxHistoryResponse>("max_client_get_history", {
    token,
    chatId,
    count: 50,
    fromTimestamp: null,
  });
  const messages = extractHistoryMessages(data.payload).length ? extractHistoryMessages(data.payload) : extractHistoryMessages(data.messages ?? data);
  return messages.map((message) => normalizeSessionMessage(message, chatId, profileId)).sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}

export async function sendMaxMessage(token: string, params: SendMessageParams): Promise<void> {
  if (params.targetKind !== "chat") {
    throw new Error("MAX client protocol отправляет сообщения по chat_id. Выберите диалог из списка или укажите chat_id.");
  }
  await invoke("max_client_send_message", {
    token,
    chatId: params.targetId,
    text: params.text,
    replyId: null,
    attachments: params.attachments ?? [],
  });
}

export async function startMaxAuth(phone: string): Promise<{ payload?: { token?: string } }> {
  return invoke("max_client_start_auth", { phone });
}

export interface MaxAuthCodeResult {
  token?: string;
  needsPassword?: boolean;
  passwordChallenge?: {
    trackId?: string;
    hint?: string;
    [key: string]: unknown;
  };
  needsRegistration?: boolean;
  registrationToken?: string;
  missingToken?: boolean;
  auth?: unknown;
}

export async function checkMaxAuthCode(authToken: string, code: string): Promise<MaxAuthCodeResult> {
  return invoke("max_client_check_code", { authToken, code });
}

export async function completeMaxRegistration(registrationToken: string, firstName: string, lastName?: string): Promise<{ token?: string }> {
  return invoke("max_client_complete_registration", {
    registrationToken,
    firstName,
    lastName: lastName?.trim() || null,
  });
}

export async function checkMaxPassword(trackId: string, password: string): Promise<{ token?: string }> {
  return invoke("max_client_check_password", { trackId, password });
}
