import { fetch } from "@tauri-apps/plugin-http";
import type { AiProviderClient, AiCompletionRequest, AiChatContentPart, AiChatMessage } from "../types";

function normalizeServerRoot(serverUrl: string): string {
  const trimmed = serverUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/api/v1")) return trimmed.slice(0, -7);
  if (trimmed.endsWith("/v1")) return trimmed.slice(0, -3);
  return trimmed;
}

function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const trimmedKey = apiKey?.trim();
  if (trimmedKey) {
    headers.Authorization = `Bearer ${trimmedKey}`;
  }
  return headers;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: { message?: string }; message?: string };
    return body.error?.message ?? body.message ?? `${response.status} ${response.statusText}`;
  } catch {
    try {
      return await response.text();
    } catch {
      return `${response.status} ${response.statusText}`;
    }
  }
}

interface ChatMessageContentPart {
  type?: string;
  text?: string;
  content?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string;
    text?: string;
    message?: {
      content?: string | ChatMessageContentPart[];
      refusal?: string;
    };
  }>;
}

interface LmStudioChatResponse {
  output?: Array<{
    type?: string;
    content?: string;
  }>;
}

function normalizeContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const item = part as ChatMessageContentPart;
          return item.text ?? item.content ?? "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function extractChatCompletionText(data: ChatCompletionResponse): string {
  const choice = data.choices?.[0];
  const content = normalizeContent(choice?.message?.content);
  if (content.trim()) return content;

  const fallback =
    choice?.message?.refusal ??
    choice?.text ??
    "";
  return fallback.trim();
}

function hasNativeMultimodalInput(messages: AiChatMessage[]): boolean {
  return messages.some((message) => (
    Array.isArray(message.content) &&
    message.content.some((part) => part.type === "image_url")
  ));
}

function messageRoleLabel(role: AiChatMessage["role"]): string {
  if (role === "system") return "Инструкция";
  if (role === "assistant") return "Ассистент";
  return "Собеседник";
}

function textFromChatContent(content: AiChatMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "input_audio") return "[аудио вложение]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function imagePartsFromChatContent(content: AiChatMessage["content"]): AiChatContentPart[] {
  if (!Array.isArray(content)) return [];
  return content.filter((part) => part.type === "image_url");
}

function buildNativeLmStudioInput(messages: AiChatMessage[]): Array<{ type: "text"; content: string } | { type: "image"; data_url: string }> {
  const text = messages
    .map((message) => {
      const content = textFromChatContent(message.content).trim();
      if (!content) return "";
      return `${messageRoleLabel(message.role)}: ${content}`;
    })
    .filter(Boolean)
    .join("\n\n");

  const input: Array<{ type: "text"; content: string } | { type: "image"; data_url: string }> = [];
  if (text) input.push({ type: "text", content: text });

  for (const message of messages) {
    for (const part of imagePartsFromChatContent(message.content)) {
      if (part.type === "image_url") {
        input.push({ type: "image", data_url: part.image_url.url });
      }
    }
  }

  return input;
}

function extractNativeLmStudioText(data: LmStudioChatResponse): string {
  const message = (data.output ?? [])
    .filter((item) => item.type === "message" && typeof item.content === "string")
    .map((item) => item.content?.trim() ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();

  if (message) return message;

  const hasReasoningOnly = (data.output ?? []).some((item) => item.type === "reasoning");
  if (hasReasoningOnly) {
    throw new Error("LM Studio вернул только reasoning без финального сообщения. Увеличьте лимит вывода или отключите reasoning у модели.");
  }

  return "";
}

async function postNativeLmStudioChat(
  serverUrl: string,
  model: string,
  apiKey: string | undefined,
  messages: AiChatMessage[],
  maxTokens: number,
  options?: Pick<AiCompletionRequest, "temperature" | "topP">,
): Promise<string> {
  const root = normalizeServerRoot(serverUrl);
  const response = await fetch(`${root}/api/v1/chat`, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify({
      model,
      input: buildNativeLmStudioInput(messages),
      max_output_tokens: Math.max(maxTokens, 800),
      temperature: options?.temperature,
      top_p: options?.topP,
    }),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const data = await response.json() as LmStudioChatResponse;
  return extractNativeLmStudioText(data);
}

async function postOpenAiChat(
  serverUrl: string,
  model: string,
  apiKey: string | undefined,
  messages: AiChatMessage[],
  maxTokens: number,
  options?: Pick<AiCompletionRequest, "temperature" | "topP" | "presencePenalty" | "frequencyPenalty">,
): Promise<string> {
  if (hasNativeMultimodalInput(messages)) {
    return postNativeLmStudioChat(serverUrl, model, apiKey, messages, maxTokens, options);
  }

  const root = normalizeServerRoot(serverUrl);
  const response = await fetch(`${root}/v1/chat/completions`, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: options?.temperature,
      top_p: options?.topP,
      presence_penalty: options?.presencePenalty,
      frequency_penalty: options?.frequencyPenalty,
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const data = await response.json() as ChatCompletionResponse;
  return extractChatCompletionText(data);
}

export async function testOllamaConnection(
  serverUrl: string,
  model: string,
  apiKey?: string,
): Promise<{ success: boolean; message: string }> {
  const root = normalizeServerRoot(serverUrl);

  try {
    const modelsResponse = await fetch(`${root}/v1/models`, {
      method: "GET",
      headers: buildHeaders(apiKey),
    });

    if (!modelsResponse.ok) {
      return { success: false, message: await readError(modelsResponse) };
    }

    await postOpenAiChat(
      serverUrl,
      model,
      apiKey,
      [{ role: "user", content: "Say hi" }],
      10,
    );

    return { success: true, message: "Connected" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export function createOllamaProvider(serverUrl: string, model: string, apiKey?: string): AiProviderClient {
  return {
    async complete(req: AiCompletionRequest): Promise<string> {
      return postOpenAiChat(
        serverUrl,
        model,
        apiKey,
        req.messages ?? [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: req.userContent },
        ],
        req.maxTokens ?? 1024,
        req,
      );
    },

    async testConnection(): Promise<boolean> {
      const result = await testOllamaConnection(serverUrl, model, apiKey);
      return result.success;
    },
  };
}

export function clearOllamaProvider(): void {
  // Direct HTTP provider has no client cache.
}
