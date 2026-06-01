import OpenAI from "openai";
import type { AiProviderClient, AiCompletionRequest } from "../types";
import { createProviderFactory } from "../providerFactory";

const factory = createProviderFactory(
  (apiKey) => new OpenAI({ apiKey, dangerouslyAllowBrowser: true }),
);

export function createOpenAIProvider(apiKey: string, model: string): AiProviderClient {
  const client = factory.getClient(apiKey);

  return {
    async complete(req: AiCompletionRequest): Promise<string> {
      const response = await client.chat.completions.create({
        model,
        max_tokens: req.maxTokens ?? 1024,
        temperature: req.temperature,
        top_p: req.topP,
        presence_penalty: req.presencePenalty,
        frequency_penalty: req.frequencyPenalty,
        messages: (req.messages ?? [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: req.userContent },
        ]) as never,
      });

      return response.choices[0]?.message?.content ?? "";
    },

    async testConnection(): Promise<boolean> {
      try {
        await client.chat.completions.create({
          model,
          max_tokens: 10,
          messages: [{ role: "user", content: "Say hi" }],
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function clearOpenAIProvider(): void {
  factory.clear();
}
