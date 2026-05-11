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

export interface MessengerDownloadedFile {
  fileId: string;
  fileName?: string;
  mimeType: string;
  size: number;
  dataUrl: string;
}

export async function messengerDownloadFile(options: {
  providerId: MessengerProviderId;
  token: string;
  fileId: string;
  fileName?: string;
}): Promise<MessengerDownloadedFile> {
  try {
    return await invoke<MessengerDownloadedFile>("messenger_download_file", {
      provider: options.providerId,
      token: options.token,
      fileId: options.fileId,
      fileName: options.fileName ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Messenger file download failed");
    throw new Error(message);
  }
}

export interface MessengerSendFileResponse {
  ok: boolean;
  message_id?: number;
  file_id?: string;
  description?: string;
}

export async function messengerSendFileBase64(options: {
  providerId: MessengerProviderId;
  token: string;
  targetKind: string;
  targetId: string;
  fileName: string;
  mimeType?: string | null;
  dataBase64: string;
}): Promise<MessengerSendFileResponse> {
  try {
    return await invoke<MessengerSendFileResponse>("messenger_send_file_base64", {
      provider: options.providerId,
      token: options.token,
      targetKind: options.targetKind,
      targetId: options.targetId,
      fileName: options.fileName,
      mimeType: options.mimeType ?? null,
      dataBase64: options.dataBase64,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Messenger file send failed");
    throw new Error(message);
  }
}
