import { getYandexContext, parseApiError } from "./accountApi";

const API = "https://cloud-api.yandex.net/v1/disk";
export type DiskResourceType = "file" | "dir";
export interface DiskResource {
  name: string; path: string; type: DiskResourceType; size?: number;
  modified?: string; mime_type?: string; public_url?: string; preview?: string;
}
export interface DiskListing {
  path: string; name: string; total: number; items: DiskResource[];
}
export interface DiskQuota { total_space: number; used_space: number; trash_size: number; }

async function request<T>(path: string, accountId: string | null, init: RequestInit = {}): Promise<T> {
  const { token } = await getYandexContext(accountId);
  const response = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `OAuth ${token}`, ...init.headers } });
  if (!response.ok) throw await parseApiError(response);
  if (response.status === 204 || response.status === 201 && response.headers.get("content-length") === "0") return undefined as T;
  return response.json() as Promise<T>;
}
const q = (value: string) => encodeURIComponent(value);

export async function listDiskResources(accountId: string | null, path = "disk:/", offset = 0, limit = 100, sort = "name"): Promise<DiskListing> {
  const data = await request<DiskResource & { _embedded?: { total?: number; items?: DiskResource[] } }>(
    `/resources?path=${q(path)}&offset=${offset}&limit=${limit}&sort=${q(sort)}&preview_size=120x120`, accountId,
  );
  return { path: data.path, name: data.name, total: data._embedded?.total ?? 0, items: data._embedded?.items ?? [] };
}
export const getDiskQuota = (accountId: string | null) => request<DiskQuota>("/", accountId);
export const getDiskResource = (accountId: string | null, path: string) => request<DiskResource>(`/resources?path=${q(path)}`, accountId);
export async function searchDisk(accountId: string | null, query: string, offset = 0): Promise<DiskListing> {
  const data = await request<{ total?: number; items?: DiskResource[] }>(`/resources/files?media_type=&name=${q(query)}&offset=${offset}&limit=100`, accountId);
  return { path: "search", name: query, total: data.total ?? 0, items: data.items ?? [] };
}
export const createDiskFolder = (accountId: string | null, path: string) => request<void>(`/resources?path=${q(path)}`, accountId, { method: "PUT" });
export const deleteDiskResource = (accountId: string | null, path: string, permanently = false) => request<void>(`/resources?path=${q(path)}&permanently=${permanently}`, accountId, { method: "DELETE" });
export const publishDiskResource = (accountId: string | null, path: string) => request<void>(`/resources/publish?path=${q(path)}`, accountId, { method: "PUT" });
export const unpublishDiskResource = (accountId: string | null, path: string) => request<void>(`/resources/unpublish?path=${q(path)}`, accountId, { method: "PUT" });
export const moveDiskResource = (accountId: string | null, from: string, path: string, overwrite = false) => request<void>(`/resources/move?from=${q(from)}&path=${q(path)}&overwrite=${overwrite}`, accountId, { method: "POST" });

export async function getDiskDownloadUrl(accountId: string | null, path: string): Promise<string> {
  return (await request<{ href: string }>(`/resources/download?path=${q(path)}`, accountId)).href;
}
export async function uploadDiskFile(accountId: string | null, path: string, data: Uint8Array, overwrite = false): Promise<void> {
  const link = await request<{ href: string }>(`/resources/upload?path=${q(path)}&overwrite=${overwrite}`, accountId);
  const response = await fetch(link.href, { method: "PUT", body: new Blob([new Uint8Array(data)]) });
  if (!response.ok) throw await parseApiError(response);
}
