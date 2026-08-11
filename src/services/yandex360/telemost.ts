import { getAccount, getAllAccounts, type DbAccount } from "@/services/db/accounts";
import { getYandexGrantAccessToken } from "@/services/oauth/yandexUnifiedAuth";

const TELEMOST_CREATE_URL = "https://cloud-api.yandex.net/v1/telemost-api/conferences";

export interface TelemostConference {
  id: string;
  joinUrl: string;
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
  if (status === 403) {
    return "Телемост API доступен только для Яндекс 360 для бизнеса и требует scope telemost-api:conferences.create. Переавторизуйте Яндекс аккаунт с этим разрешением.";
  }
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
    joinUrl: body.join_url,
    liveStreamWatchUrl: body.live_stream?.watch_url ?? null,
    waitingRoomLevel: body.waiting_room_level,
    liveStream: body.live_stream ? { accessLevel: body.live_stream.access_level, title: body.live_stream.title, description: body.live_stream.description, watchUrl: body.live_stream.watch_url } : undefined,
    sipUriMeeting: body.sip_uri_meeting,
  };
}

async function telemostRequest(accountId: string | null, url: string, init: RequestInit): Promise<TelemostCreateResponse> {
  const account = await resolveTelemostAccount(accountId);
  const token = await getYandexGrantAccessToken(account.id, "communications");
  if (!token) throw new Error("Яндекс OAuth token не найден. Переавторизуйте аккаунт.");
  const response = await fetch(url, { ...init, headers: { Authorization: `OAuth ${token}`, "Content-Type": "application/json", ...init.headers } });
  const body = await response.json().catch(() => ({})) as TelemostCreateResponse;
  if (!response.ok) throw new Error(formatTelemostError(response.status, body));
  return body;
}

export async function createTelemostConference(options: TelemostConferenceOptions): Promise<TelemostConference> {
  const account = await resolveTelemostAccount(options.accountId);
  const token = await getYandexGrantAccessToken(account.id, "communications");
  if (!token) {
    throw new Error("Яндекс OAuth token не найден. Переавторизуйте аккаунт.");
  }

  const response = await fetch(TELEMOST_CREATE_URL, {
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
  });

  const body = await response.json().catch(() => ({})) as TelemostCreateResponse;
  if (!response.ok) {
    throw new Error(formatTelemostError(response.status, body));
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
