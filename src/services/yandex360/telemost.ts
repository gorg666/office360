import { getAccount, getAllAccounts, type DbAccount } from "@/services/db/accounts";
import { getYandexGrantAccessToken } from "@/services/oauth/yandexUnifiedAuth";

const TELEMOST_CREATE_URL = "https://cloud-api.yandex.net/v1/telemost-api/conferences";

export interface TelemostConference {
  id: string;
  title: string | null;
  joinUrl: string;
  organizer: string | null;
  createdAt: number | null;
  scheduledAt: number | null;
  status: string | null;
  liveStreamWatchUrl: string | null;
  waitingRoomLevel?: "PUBLIC" | "ORGANIZATION" | "ADMINS" | "UNKNOWN";
  liveStream?: { accessLevel?: string; title?: string; description?: string; watchUrl?: string };
  sipUriMeeting?: string;
}

interface TelemostCreateResponse {
  id?: string;
  join_url?: string;
  live_stream?: {
    watch_url?: string;
    access_level?: string;
    title?: string;
    description?: string;
  };
  waiting_room_level?: TelemostConference["waitingRoomLevel"];
  sip_uri_meeting?: string;
  error?: string;
  message?: string;
  description?: string;
  organizer?: { email?: string };
  created_at?: string;
  status?: string;
}

export type TelemostErrorCode = "auth" | "missing_scope" | "organization_restricted" | "conference_forbidden" | "rate_limit" | "network" | "api";
export class TelemostApiError extends Error {
  constructor(public readonly code: TelemostErrorCode, message: string, public readonly status?: number) {
    super(message);
    this.name = "TelemostApiError";
  }
}

export interface TelemostConferenceOptions {
  accountId: string | null;
  cohostEmails?: string[];
  waitingRoomLevel?: "PUBLIC" | "ORGANIZATION" | "ADMINS";
  autoSummarization?: boolean;
  liveStream?: { accessLevel: "PUBLIC" | "ORGANIZATION"; title?: string; description?: string };
}

function isYandexOAuthAccount(account: DbAccount): boolean {
  return account.oauth_provider === "yandex" && account.auth_method === "oauth2";
}

async function resolveTelemostAccount(preferredAccountId: string | null): Promise<DbAccount> {
  if (preferredAccountId) {
    const preferred = await getAccount(preferredAccountId);
    if (preferred && isYandexOAuthAccount(preferred)) return preferred;
    throw new Error("Активный аккаунт не подключён через Яндекс ID.");
  }

  const accounts = await getAllAccounts();
  const yandexAccount = accounts.find(isYandexOAuthAccount);
  if (!yandexAccount) {
    throw new Error("Для создания ссылки Телемоста подключите Яндекс аккаунт через OAuth.");
  }
  return yandexAccount;
}

function parseEmails(value: string[]): { email: string }[] {
  return value
    .map((email) => email.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((email) => ({ email }));
}

function formatTelemostError(status: number, body: TelemostCreateResponse): string {
  if (status === 401) return "Срок действия доступа к Телемосту истёк. Разрешите доступ повторно.";
  if (status === 403) return body.message || body.description || body.error || "Для аккаунта недоступна эта операция Телемоста.";
  if (status === 429) return "Слишком много запросов к Телемосту. Повторите попытку позже.";
  if (status === 404 && body.error === "NoSuchUserPrincipalsFound") {
    return "Некоторые соорганизаторы не найдены в Яндексе. Проверьте e-mail участников.";
  }
  if (status === 402) {
    return "Текущий тариф Яндекс 360 не позволяет создать трансляцию/встречу через Телемост API.";
  }
  return body.message || body.description || body.error || `Телемост API вернул ошибку ${status}.`;
}

function mapConference(body: TelemostCreateResponse): TelemostConference {
  if (!body.id || !body.join_url) throw new Error("Телемост API не вернул ссылку встречи.");
  return {
    id: body.id,
    title: null,
    joinUrl: body.join_url,
    organizer: body.organizer?.email ?? null,
    createdAt: body.created_at ? Math.floor(new Date(body.created_at).getTime() / 1000) : null,
    scheduledAt: null,
    status: body.status ?? null,
    liveStreamWatchUrl: body.live_stream?.watch_url ?? null,
    waitingRoomLevel: body.waiting_room_level,
    liveStream: body.live_stream ? { accessLevel: body.live_stream.access_level, title: body.live_stream.title, description: body.live_stream.description, watchUrl: body.live_stream.watch_url } : undefined,
    sipUriMeeting: body.sip_uri_meeting,
  };
}

async function resolveTelemostAccessToken(account: DbAccount): Promise<string> {
  try {
    return await getYandexGrantAccessToken(account.id, "communications");
  } catch (reason) {
    throw new TelemostApiError("missing_scope", reason instanceof Error ? reason.message : "Разрешите доступ к Телемосту.");
  }
}

function apiError(status: number, body: TelemostCreateResponse): TelemostApiError {
  const raw = `${body.error ?? ""} ${body.message ?? ""} ${body.description ?? ""}`;
  const organizationRestricted = /ApiRestrictedToOrganizations|доступен пользователям Яндекс 360 для бизнеса/i.test(raw);
  const code: TelemostErrorCode = status === 401 ? "auth"
    : status === 429 ? "rate_limit"
      : status === 403 && /insufficient[_ -]?scope|missing[_ -]?scope|scope.*(?:required|missing|not granted)/i.test(raw) ? "missing_scope"
        : organizationRestricted ? "organization_restricted"
          : status === 403 ? "conference_forbidden" : "api";
  return new TelemostApiError(code, formatTelemostError(status, body), status);
}

async function telemostRequest(accountId: string | null, url: string, init: RequestInit): Promise<TelemostCreateResponse> {
  const account = await resolveTelemostAccount(accountId);
  const token = await resolveTelemostAccessToken(account);
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { Authorization: `OAuth ${token}`, "Content-Type": "application/json", ...init.headers } });
  } catch {
    throw new TelemostApiError("network", "Не удалось связаться с Телемостом. Проверьте подключение к интернету.");
  }
  const body = await response.json().catch(() => ({})) as TelemostCreateResponse;
  if (!response.ok) throw apiError(response.status, body);
  return body;
}

export async function createTelemostConference(options: TelemostConferenceOptions): Promise<TelemostConference> {
  const account = await resolveTelemostAccount(options.accountId);
  const token = await resolveTelemostAccessToken(account);

  let response: Response;
  try { response = await fetch(TELEMOST_CREATE_URL, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      waiting_room_level: options.waitingRoomLevel ?? "PUBLIC",
      cohosts: parseEmails(options.cohostEmails ?? []),
      is_auto_summarization_enabled: options.autoSummarization ?? false,
      live_stream: options.liveStream ? {
        access_level: options.liveStream.accessLevel,
        title: options.liveStream.title,
        description: options.liveStream.description,
      } : undefined,
    }),
  }); } catch { throw new TelemostApiError("network", "Не удалось связаться с Телемостом. Проверьте подключение к интернету."); }

  const body = await response.json().catch(() => ({})) as TelemostCreateResponse;
  if (!response.ok) {
    throw apiError(response.status, body);
  }

  if (!body.id || !body.join_url) {
    throw new Error("Телемост API не вернул ссылку встречи.");
  }

  return mapConference(body);
}

export async function getTelemostConference(accountId: string | null, id: string): Promise<TelemostConference> {
  return mapConference(await telemostRequest(accountId, `${TELEMOST_CREATE_URL}/${encodeURIComponent(id)}`, { method: "GET" }));
}

export async function updateTelemostConference(options: TelemostConferenceOptions & { id: string }): Promise<TelemostConference> {
  const body = await telemostRequest(options.accountId, `${TELEMOST_CREATE_URL}/${encodeURIComponent(options.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      waiting_room_level: options.waitingRoomLevel,
      cohosts: options.cohostEmails ? parseEmails(options.cohostEmails) : undefined,
      is_auto_summarization_enabled: options.autoSummarization,
      live_stream: options.liveStream ? { access_level: options.liveStream.accessLevel, title: options.liveStream.title, description: options.liveStream.description } : undefined,
    }),
  });
  return mapConference(body);
}

export async function deleteTelemostConference(accountId: string | null, id: string): Promise<void> {
  const account = await resolveTelemostAccount(accountId);
  const token = await resolveTelemostAccessToken(account);
  let response: Response;
  try {
    response = await fetch(`${TELEMOST_CREATE_URL}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `OAuth ${token}` },
    });
  } catch {
    throw new TelemostApiError("network", "Не удалось связаться с Телемостом. Проверьте подключение к интернету.");
  }
  if (response.status === 404 || response.ok) return;
  const body = await response.json().catch(() => ({})) as TelemostCreateResponse;
  throw apiError(response.status, body);
}
