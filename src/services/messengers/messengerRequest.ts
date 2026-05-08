import { invoke } from "@tauri-apps/api/core";
import type { MessengerProviderId } from "./credentials";

export interface MessengerRequestOptions {
  providerId: MessengerProviderId;
  token: string;
  method?: "GET" | "POST";
  path: string;
  query?: Array<[string, string]>;
  body?: unknown;
}

export async function messengerRequest<T>(options: MessengerRequestOptions): Promise<T> {
  try {
    return await invoke<T>("messenger_request", {
      provider: options.providerId,
      token: options.token,
      method: options.method ?? "GET",
      path: options.path,
      query: options.query ?? [],
      body: options.body ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Messenger API request failed");
    throw new Error(message);
  }
}
