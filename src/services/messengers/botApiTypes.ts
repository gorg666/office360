import type { MessengerProviderId } from "./credentials";

export type MessengerConversationKind = "chat" | "user" | "login";

export interface MessengerConversation {
  id: string;
  providerId: MessengerProviderId;
  kind: MessengerConversationKind;
  title: string;
  subtitle: string;
  lastText?: string;
  updatedAt?: number;
  raw?: unknown;
}

export interface MessengerMessage {
  id: string;
  providerId: MessengerProviderId;
  conversationId: string;
  direction: "incoming" | "outgoing" | "system";
  author: string;
  text: string;
  attachments?: MessengerAttachment[];
  timestamp?: number;
  raw?: unknown;
}

export interface MessengerAttachment {
  id: string;
  kind: "photo" | "video" | "file" | "audio" | "contact";
  title: string;
  url?: string;
  previewUrl?: string;
  size?: number;
  raw?: unknown;
}

export interface MessengerAttachmentUpload {
  path: string;
  kind: "photo" | "video" | "file";
  name?: string;
  mimeType?: string;
}

export interface SendMessageParams {
  providerId: MessengerProviderId;
  targetKind: MessengerConversationKind;
  targetId: string;
  text: string;
  attachments?: MessengerAttachmentUpload[];
}
