import { fetch } from "@tauri-apps/plugin-http";
import type { AiProviderClient, AiCompletionRequest } from "../types";

function normalizeServerRoot(serverUrl: string): string {
  const trimmed = serverUrl.trim().replace(/\/+$/, "");
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

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

async function postOpenAiChat(
  serverUrl: string,
  model: string,
  apiKey: string | undefined,
  messages: Array<{ role: "system" | "user"; content: string }>,
  maxTokens: number,
): Promise<string> {
  const root = normalizeServerRoot(serverUrl);
  const response = await fetch(`${root}/v1/chat/completions`, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const data = await response.json() as ChatCompletionResponse;
  return data.choices?.[0]?.message?.content ?? "";
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
        [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: req.userContent },
        ],
        req.maxTokens ?? 1024,
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
