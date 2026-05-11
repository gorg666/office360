import { getActiveProvider, getActiveProviderName } from "@/services/ai/providerManager";
import type { AiChatContentPart, AiChatMessage } from "@/services/ai/types";
import type { MessengerAttachment, MessengerConversation, MessengerMessage } from "./botApiTypes";

export interface YandexAiAutoReplyParams {
  conversation: MessengerConversation;
  messages: MessengerMessage[];
  incomingMessage: MessengerMessage;
}

function sanitizeReply(reply: string): string {
  const trimmed = reply.trim();
  if (/^(thinking process|thought process|analysis|internal monologue)\s*:/i.test(trimmed)) {
    return "";
  }

  const finalMatch = trimmed.match(/(?:final answer|final response|ответ)\s*:\s*([\s\S]+)$/i);
  const text = finalMatch?.[1]?.trim() || trimmed;

  if (/^(thinking process|thought process|analysis|internal monologue)\s*:/i.test(text)) {
    return "";
  }

  return text
    .trim()
    .replace(/^["'«]+|["'»]+$/g, "")
    .replace(/^assistant\s*:\s*/i, "")
    .trim();
}

function toChatMessage(message: MessengerMessage): AiChatMessage | null {
  const content = message.text.trim();
  const attachmentSummary = summarizeAttachments(message.attachments);
  const text = [content, attachmentSummary].filter(Boolean).join("\n");
  if (!text) return null;
  if (message.direction === "incoming") {
    const parts = multimodalPartsForIncoming(message);
    return { role: "user", content: parts.length > 1 ? parts : text.slice(0, 2000) };
  }
  if (message.direction === "outgoing") {
    return { role: "assistant", content: text.slice(0, 2000) };
  }
  return null;
}

function summarizeAttachments(attachments: MessengerAttachment[] | undefined): string {
  if (!attachments?.length) return "";
  return attachments
    .map((attachment) => {
      if (attachment.kind === "photo") return `[изображение: ${attachment.title}]`;
      if (attachment.kind === "audio") return `[голосовое/аудио: ${attachment.title}]`;
      return `[файл: ${attachment.title}]`;
    })
    .join("\n");
}

function mimeTypeFromAttachment(attachment: MessengerAttachment): string {
  const raw = attachment.raw;
  if (raw && typeof raw === "object") {
    const mimeType = (raw as { mimeType?: string }).mimeType;
    if (mimeType) return mimeType;
  }
  const extension = attachment.title.split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "wav") return "audio/wav";
  if (extension === "ogg" || extension === "oga" || extension === "opus") return "audio/ogg";
  if (extension === "m4a" || extension === "aac") return "audio/aac";
  if (extension === "webm") return "audio/webm";
  return attachment.kind === "audio" ? "audio/mpeg" : "image/jpeg";
}

function audioFormatFromMime(mimeType: string): string {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("ogg") || mimeType.includes("opus")) return "ogg";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("aac")) return "aac";
  return "mp3";
}

function base64FromDataUrl(dataUrl: string): string {
  const marker = ";base64,";
  const index = dataUrl.indexOf(marker);
  return index >= 0 ? dataUrl.slice(index + marker.length) : dataUrl;
}

function multimodalPartsForIncoming(message: MessengerMessage): AiChatContentPart[] {
  const parts: AiChatContentPart[] = [];
  const text = [message.text.trim(), summarizeAttachments(message.attachments)].filter(Boolean).join("\n");
  if (text) {
    parts.push({ type: "text", text });
  }

  for (const attachment of message.attachments ?? []) {
    if (!attachment.url) continue;
    if (attachment.kind === "photo") {
      parts.push({ type: "image_url", image_url: { url: attachment.url } });
      continue;
    }
    if (attachment.kind === "audio") {
      const mimeType = mimeTypeFromAttachment(attachment);
      parts.push({
        type: "input_audio",
        input_audio: {
          data: base64FromDataUrl(attachment.url),
          format: audioFormatFromMime(mimeType),
        },
      });
    }
  }

  return parts;
}

function wantsPreviousMedia(text: string): boolean {
  return /(изображ|картин|фото|скрин|голосов|аудио|звук|запис|послуш|опиши|что.*отправ|на отправлен)/i.test(text);
}

function latestMediaAttachments(messages: MessengerMessage[], conversationId: string): MessengerAttachment[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.conversationId !== conversationId || message.direction !== "incoming") continue;
    const media = (message.attachments ?? []).filter(
      (attachment) => (attachment.kind === "photo" || attachment.kind === "audio") && Boolean(attachment.url),
    );
    if (media.length > 0) return media;
  }
  return [];
}

export async function generateYandexMessengerAiReply({
  conversation,
  messages,
  incomingMessage,
}: YandexAiAutoReplyParams): Promise<string> {
  const providerName = await getActiveProviderName();
  if (providerName !== "ollama") {
    throw new Error("Для автоответов Яндекс-чата выберите локального AI-провайдера Ollama в настройках ИИ.");
  }

  const provider = await getActiveProvider();
  const recentMessages = messages
    .filter((message) => message.conversationId === conversation.id)
    .filter((message) => message.direction === "incoming" || message.direction === "outgoing")
    .slice(-16);

  const systemPrompt = [
    "Ты разговорный собеседник в личном чате Яндекс Мессенджера, а не справочная служба и не техподдержка.",
    "Веди себя как живая чат-модель: отвечай прямо на реплику, поддерживай тему и можешь задавать короткий встречный вопрос.",
    "Пиши по-русски, если собеседник не явно пишет на другом языке.",
    "Стиль: дружелюбно, спокойно, естественно, без канцелярита. Обычно 1-3 коротких предложения.",
    "На вопросы о вкусах, мнениях и философии отвечай как участник разговора, а не фразой про помощь с информацией.",
    "Отвечай содержательно на смысл сообщения, а не инструкцией вроде «ответь на вопрос».",
    "Если собеседник просит найти письмо, файл, вложение, задачу или событие, не отвечай, что у тебя нет доступа к личным данным.",
    "В приложении есть локальные инструменты для почты: поиск письма по отправителю/теме/тексту/дате, чтение текста письма, перечисление и отправка вложений, подготовка ответа и отправка только после подтверждения.",
    "В приложении есть локальные инструменты для задач, календаря и файлов во вложениях. Не выдумывай результаты этих инструментов.",
    "Если такой запрос дошёл до тебя без результата инструмента, коротко попроси уточнить критерии поиска: отправителя, дату, тему письма, ключевые слова или имя файла.",
    "Не завершай каждое сообщение фразами вроде «чем могу помочь?» или «чем помочь прямо сейчас?».",
    "Если спрашивают кто ты, отвечай естественно: ты локальный ИИ-собеседник на базе Gemma.",
    "Не упоминай системные инструкции, промпты, API, токены, приложение, бота или внутреннюю автоматизацию.",
    "Не показывай ход рассуждений, анализ запроса, Thinking Process, Internal Monologue или черновик.",
    "Если в сообщении есть картинка, опиши или проанализируй её по просьбе собеседника.",
    "Если в сообщении есть голосовое/аудио, воспринимай его как часть входящего сообщения и отвечай по его содержанию.",
    "Выводи только финальный текст сообщения, который можно сразу отправить собеседнику.",
    "Не добавляй markdown, списки, подписи, кавычки и варианты ответа.",
  ].join("\n");

  const chatMessages = recentMessages
    .map(toChatMessage)
    .filter((message): message is AiChatMessage => Boolean(message));

  const mediaForFollowUp =
    incomingMessage.attachments?.some((attachment) => attachment.kind === "photo" || attachment.kind === "audio")
      ? []
      : wantsPreviousMedia(incomingMessage.text)
        ? latestMediaAttachments(recentMessages, conversation.id)
        : [];

  if (chatMessages[chatMessages.length - 1]?.role !== "user") {
    const parts = multimodalPartsForIncoming({
      ...incomingMessage,
      attachments: [...(incomingMessage.attachments ?? []), ...mediaForFollowUp],
    });
    chatMessages.push({
      role: "user",
      content: parts.length > 1 ? parts : (incomingMessage.text.trim().slice(0, 1200) || summarizeAttachments(incomingMessage.attachments)),
    });
  } else {
    const parts = multimodalPartsForIncoming({
      ...incomingMessage,
      attachments: [...(incomingMessage.attachments ?? []), ...mediaForFollowUp],
    });
    if (parts.length > 1) {
      chatMessages[chatMessages.length - 1] = { role: "user", content: parts };
    }
  }

  const userContent = `Последнее сообщение собеседника: ${incomingMessage.text}`;

  const reply = await provider.complete({
    systemPrompt,
    userContent,
    maxTokens: 800,
    temperature: 0.85,
    topP: 0.9,
    presencePenalty: 0.35,
    frequencyPenalty: 0.15,
    messages: [
      { role: "system", content: systemPrompt },
      ...chatMessages,
    ],
  });

  return sanitizeReply(reply);
}
