import { getAccount, getAllAccounts, type DbAccount } from "@/services/db/accounts";
import { ensureFreshToken } from "@/services/oauth/oauthTokenManager";

const TELEMOST_CREATE_URL = "https://cloud-api.yandex.net/v1/telemost-api/conferences";

export interface TelemostConference {
  id: string;
  joinUrl: string;
  liveStreamWatchUrl: string | null;
}

interface TelemostCreateResponse {
  id?: string;
  join_url?: string;
  live_stream?: {
    watch_url?: string;
  };
  error?: string;
  message?: string;
  description?: string;
}

function isYandexOAuthAccount(account: DbAccount): boolean {
  return account.oauth_provider === "yandex" && account.auth_method === "oauth2";
}

async function resolveTelemostAccount(preferredAccountId: string | null): Promise<DbAccount> {
  if (preferredAccountId) {
    const preferred = await getAccount(preferredAccountId);
    if (preferred && isYandexOAuthAccount(preferred)) return preferred;
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

export async function createTelemostConference(options: {
  accountId: string | null;
  cohostEmails?: string[];
  waitingRoomLevel?: "PUBLIC" | "ORGANIZATION" | "ADMINS";
}): Promise<TelemostConference> {
  const account = await resolveTelemostAccount(options.accountId);
  const token = await ensureFreshToken(account);
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
    }),
  });

  const body = await response.json().catch(() => ({})) as TelemostCreateResponse;
  if (!response.ok) {
    throw new Error(formatTelemostError(response.status, body));
  }

  if (!body.id || !body.join_url) {
    throw new Error("Телемост API не вернул ссылку встречи.");
  }

  return {
    id: body.id,
    joinUrl: body.join_url,
    liveStreamWatchUrl: body.live_stream?.watch_url ?? null,
  };
}
