import type { MessengerConversation, SendMessageParams } from "./botApiTypes";
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
