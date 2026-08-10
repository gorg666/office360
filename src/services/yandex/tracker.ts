import { getYandexServiceContext, getStoredYandexOrgId, parseApiError } from "./accountApi";

const API = "https://api.tracker.yandex.net/v3";
export interface TrackerRef { id?: string; key?: string; display?: string; }
export interface TrackerIssue {
  id: string; key: string; summary: string; description?: string;
  status?: TrackerRef; priority?: TrackerRef; assignee?: TrackerRef; queue?: TrackerRef;
  deadline?: string; updatedAt?: string; createdAt?: string;
}
export interface TrackerQueue extends TrackerRef { name?: string; defaultPriority?: TrackerRef; }
export interface TrackerComment { id: string; text: string; createdAt?: string; createdBy?: TrackerRef; }
export interface TrackerTransition { id: string; display: string; to?: TrackerRef; }
export interface TrackerAttachment { id: string; name: string; content?: string; size?: number; createdAt?: string; }

async function request<T>(accountId: string | null, path: string, init: RequestInit = {}): Promise<T> {
  const { account, token } = await getYandexServiceContext(accountId);
  const orgId = await getStoredYandexOrgId(account.id);
  if (!orgId) throw new Error("Укажите организацию Яндекс 360 в настройках интеграции.");
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `OAuth ${token}`, "X-Org-ID": orgId, "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) throw await parseApiError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const listTrackerQueues = (accountId: string | null) => request<TrackerQueue[]>(accountId, "/queues?perPage=100");
export const listTrackerStatuses = (accountId: string | null) => request<TrackerRef[]>(accountId, "/statuses?perPage=100");
export const listTrackerPriorities = (accountId: string | null) => request<TrackerRef[]>(accountId, "/priorities?perPage=100");
export const searchTrackerIssues = (accountId: string | null, filter: Record<string, unknown>) => request<TrackerIssue[]>(accountId, "/issues/_search?perPage=100", { method: "POST", body: JSON.stringify({ filter }) });
export const getTrackerIssue = (accountId: string | null, key: string) => request<TrackerIssue>(accountId, `/issues/${encodeURIComponent(key)}`);
export const createTrackerIssue = (accountId: string | null, body: Record<string, unknown>) => request<TrackerIssue>(accountId, "/issues", { method: "POST", body: JSON.stringify(body) });
export const updateTrackerIssue = (accountId: string | null, key: string, body: Record<string, unknown>) => request<TrackerIssue>(accountId, `/issues/${encodeURIComponent(key)}`, { method: "PATCH", body: JSON.stringify(body) });
export const listTrackerComments = (accountId: string | null, key: string) => request<TrackerComment[]>(accountId, `/issues/${encodeURIComponent(key)}/comments`);
export const addTrackerComment = (accountId: string | null, key: string, text: string) => request<TrackerComment>(accountId, `/issues/${encodeURIComponent(key)}/comments`, { method: "POST", body: JSON.stringify({ text }) });
export const listTrackerTransitions = (accountId: string | null, key: string) => request<TrackerTransition[]>(accountId, `/issues/${encodeURIComponent(key)}/transitions`);
export const executeTrackerTransition = (accountId: string | null, key: string, transitionId: string) => request<TrackerIssue>(accountId, `/issues/${encodeURIComponent(key)}/transitions/${encodeURIComponent(transitionId)}/_execute`, { method: "POST", body: "{}" });
export const listTrackerAttachments = (accountId: string | null, key: string) => request<TrackerAttachment[]>(accountId, `/issues/${encodeURIComponent(key)}/attachments`);
export async function uploadTrackerAttachment(accountId: string | null, key: string, name: string, data: Uint8Array): Promise<TrackerAttachment> {
  const { account, token } = await getYandexServiceContext(accountId); const orgId = await getStoredYandexOrgId(account.id);
  if (!orgId) throw new Error("Укажите организацию Яндекс 360 в настройках интеграции.");
  const form = new FormData(); form.append("file", new Blob([new Uint8Array(data)]), name);
  const response = await fetch(`${API}/issues/${encodeURIComponent(key)}/attachments`, { method: "POST", headers: { Authorization: `OAuth ${token}`, "X-Org-ID": orgId }, body: form });
  if (!response.ok) throw await parseApiError(response); return response.json() as Promise<TrackerAttachment>;
}
