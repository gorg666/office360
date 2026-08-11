import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getYandexServiceContext, getStoredYandexOrgId, parseApiError, YandexApiError } from "./accountApi";

const API = "https://api.tracker.yandex.net/v3";

/** Fallback when Retry-After is absent (seconds). Not an aggressive retry loop. */
export const TRACKER_RATE_LIMIT_FALLBACK_SEC = 30;

/** Session access mode — not persisted; reset on account change / manual refresh. */
export type TrackerAccessMode = "UNKNOWN" | "READ_ONLY";

export const TRACKER_READ_ONLY_MESSAGE =
  "Яндекс Трекер доступен только для чтения. Для создания и изменения задач требуется полный доступ в вашей организации.";

export const TRACKER_WRITE_DISABLED_HINT =
  "Недоступно: организация Яндекс Трекера работает в режиме чтения.";

export const TRACKER_READ_ONLY_DOCS_URL = "https://yandex.ru/support/tracker/ru/access#readonly";

export const TRACKER_PERMISSION_DENIED_MESSAGE =
  "Недостаточно прав для этого действия в Яндекс Трекере.";

export const TRACKER_ORG_FORBIDDEN_MESSAGE =
  "Нет доступа к выбранной организации Яндекс Трекера.";

let trackerAccessMode: TrackerAccessMode = "UNKNOWN";

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
export interface TrackerMyself {
  uid?: number;
  login?: string;
  display?: string;
  email?: string;
  hasLicense?: boolean;
}

export interface TrackerSessionMetadata {
  myself: TrackerMyself;
  queues: TrackerQueue[];
  statuses: TrackerRef[];
  priorities: TrackerRef[];
}

let cooldownUntilMs = 0;
const sessionMetaByAccount = new Map<string, TrackerSessionMetadata>();
const metaInFlightByAccount = new Map<string, Promise<TrackerSessionMetadata>>();

/** Parse Retry-After (delta-seconds or HTTP-date) → absolute cooldown timestamp (ms). */
export function parseRetryAfter(header: string | null | undefined, nowMs = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const sec = Number(trimmed);
    if (!Number.isFinite(sec) || sec < 0) return null;
    return nowMs + sec * 1000;
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return null;
  return dateMs;
}

export function getTrackerCooldownRemainingMs(nowMs = Date.now()): number {
  return Math.max(0, cooldownUntilMs - nowMs);
}

export function getTrackerCooldownUntilMs(): number {
  return cooldownUntilMs;
}

/** Test / manual reset helper. */
export function resetTrackerRateLimitState(): void {
  cooldownUntilMs = 0;
}

export function getTrackerAccessMode(): TrackerAccessMode {
  return trackerAccessMode;
}

/** Clear session read-only flag (account change, restart path, manual refresh). */
export function resetTrackerAccessMode(): void {
  trackerAccessMode = "UNKNOWN";
}

export function markTrackerAccessReadOnly(): void {
  trackerAccessMode = "READ_ONLY";
}

export function invalidateTrackerSessionCache(accountId?: string | null): void {
  if (accountId) {
    sessionMetaByAccount.delete(accountId);
    metaInFlightByAccount.delete(accountId);
    return;
  }
  sessionMetaByAccount.clear();
  metaInFlightByAccount.clear();
}

/** Join Tracker API error payload into one searchable string. */
export function collectTrackerErrorText(payload: unknown): string {
  if (payload == null) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload !== "object") return String(payload);
  const obj = payload as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof obj.message === "string") parts.push(obj.message);
  if (Array.isArray(obj.errorMessages)) {
    for (const item of obj.errorMessages) {
      if (typeof item === "string") parts.push(item);
    }
  }
  if (typeof obj.errorCode === "string") parts.push(obj.errorCode);
  if (typeof obj.code === "string") parts.push(obj.code);
  if (obj.errors && typeof obj.errors === "object") {
    parts.push(JSON.stringify(obj.errors));
  }
  return parts.join("\n");
}

/** True when API body describes Tracker view / read-only license mode (not generic 403). */
export function isTrackerViewModePayload(payload: unknown): boolean {
  const text = collectTrackerErrorText(payload);
  if (!text.trim()) return false;
  return /режим[еа]?\s*просмотр|только\s+для\s+чтен|тариф\s+с\s+трекер|подключите\s+тариф|view\s*mode|read[\s-]?only/i.test(
    text,
  );
}

export function isTrackerOrgAccessPayload(payload: unknown): boolean {
  const text = collectTrackerErrorText(payload);
  if (!text.trim() || isTrackerViewModePayload(payload)) return false;
  return /организац|x-org-id|org[_-]?id|cloud_org/i.test(text);
}

export function isTrackerReadOnlyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  if (e.code === "tracker_read_only") return true;
  if (typeof e.message === "string") {
    if (e.message === TRACKER_READ_ONLY_MESSAGE) return true;
    if (isTrackerViewModePayload({ message: e.message })) return true;
  }
  return false;
}

function assertTrackerWritable(): void {
  if (trackerAccessMode === "READ_ONLY") {
    throw new YandexApiError(403, TRACKER_READ_ONLY_MESSAGE, "tracker_read_only");
  }
}

async function readTrackerErrorPayload(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { message: text };
    }
  } catch {
    return null;
  }
}

function assertNotInCooldown(): void {
  const remaining = getTrackerCooldownRemainingMs();
  if (remaining <= 0) return;
  const sec = Math.max(1, Math.ceil(remaining / 1000));
  throw rateLimitError(sec);
}

function rateLimitError(retryAfterSeconds: number): YandexApiError {
  const err = new YandexApiError(
    429,
    `Слишком много запросов к Яндекс Трекеру. Повторим через ${retryAfterSeconds} сек.`,
    "tracker_rate_limited",
  );
  (err as YandexApiError & { retryAfterSeconds?: number }).retryAfterSeconds = retryAfterSeconds;
  return err;
}

function applyRateLimitFromResponse(response: Response, nowMs = Date.now()): YandexApiError {
  const retryAfterRaw = response.headers?.get?.("Retry-After") ?? null;
  const until = parseRetryAfter(retryAfterRaw, nowMs) ?? nowMs + TRACKER_RATE_LIMIT_FALLBACK_SEC * 1000;
  cooldownUntilMs = Math.max(cooldownUntilMs, until);
  const sec = Math.max(1, Math.ceil((cooldownUntilMs - nowMs) / 1000));
  return rateLimitError(sec);
}

async function parseTrackerError(response: Response): Promise<YandexApiError> {
  if (response.status === 401) {
    return new YandexApiError(
      401,
      "Необходимо обновить доступ к Яндекс Трекеру.",
      "tracker_auth_expired",
    );
  }
  if (response.status === 403) {
    const payload = await readTrackerErrorPayload(response);
    if (isTrackerViewModePayload(payload)) {
      markTrackerAccessReadOnly();
      return new YandexApiError(403, TRACKER_READ_ONLY_MESSAGE, "tracker_read_only");
    }
    if (isTrackerOrgAccessPayload(payload)) {
      return new YandexApiError(403, TRACKER_ORG_FORBIDDEN_MESSAGE, "tracker_org_forbidden");
    }
    return new YandexApiError(403, TRACKER_PERMISSION_DENIED_MESSAGE, "tracker_permission_denied");
  }
  if (response.status === 404) {
    return new YandexApiError(
      404,
      "Не удалось найти организацию или ресурс Яндекс Трекера.",
      "tracker_not_found",
    );
  }
  if (response.status === 429) {
    return applyRateLimitFromResponse(response);
  }
  if (response.status >= 500) {
    return new YandexApiError(
      response.status,
      "Яндекс Трекер временно недоступен. Повторите позже.",
      "tracker_server_error",
    );
  }
  return parseApiError(response);
}

async function request<T>(accountId: string | null, path: string, init: RequestInit = {}): Promise<T> {
  assertNotInCooldown();
  const { account, token } = await getYandexServiceContext(accountId);
  assertNotInCooldown();
  const orgId = await getStoredYandexOrgId(account.id);
  if (!orgId) throw new Error("Укажите организацию Яндекс 360, чтобы открыть Трекер.");
  let response: Response;
  try {
    // Native Tauri HTTP — Tracker API has no usable CORS for webview fetch.
    response = await tauriFetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `OAuth ${token}`,
        "X-Org-ID": orgId,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  } catch (err) {
    if (err instanceof YandexApiError) throw err;
    throw new YandexApiError(0, "Не удалось связаться с Яндекс Трекером. Проверьте сеть и повторите.", "network");
  }
  if (!response.ok) throw await parseTrackerError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/** Smoke: confirms service OAuth + X-Org-ID before queues/issues. */
export const getTrackerMyself = (accountId: string | null) => request<TrackerMyself>(accountId, "/myself");

export const listTrackerQueues = (accountId: string | null) => request<TrackerQueue[]>(accountId, "/queues?perPage=100");
export const listTrackerStatuses = (accountId: string | null) => request<TrackerRef[]>(accountId, "/statuses?perPage=100");
export const listTrackerPriorities = (accountId: string | null) => request<TrackerRef[]>(accountId, "/priorities?perPage=100");
export const searchTrackerIssues = (accountId: string | null, filter: Record<string, unknown>) =>
  request<TrackerIssue[]>(accountId, "/issues/_search?perPage=100", { method: "POST", body: JSON.stringify({ filter }) });
export const getTrackerIssue = (accountId: string | null, key: string) =>
  request<TrackerIssue>(accountId, `/issues/${encodeURIComponent(key)}`);
export async function createTrackerIssue(accountId: string | null, body: Record<string, unknown>) {
  assertTrackerWritable();
  return request<TrackerIssue>(accountId, "/issues", { method: "POST", body: JSON.stringify(body) });
}
export async function updateTrackerIssue(accountId: string | null, key: string, body: Record<string, unknown>) {
  assertTrackerWritable();
  return request<TrackerIssue>(accountId, `/issues/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
export const listTrackerComments = (accountId: string | null, key: string) =>
  request<TrackerComment[]>(accountId, `/issues/${encodeURIComponent(key)}/comments`);
export async function addTrackerComment(accountId: string | null, key: string, text: string) {
  assertTrackerWritable();
  return request<TrackerComment>(accountId, `/issues/${encodeURIComponent(key)}/comments`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}
export const listTrackerTransitions = (accountId: string | null, key: string) =>
  request<TrackerTransition[]>(accountId, `/issues/${encodeURIComponent(key)}/transitions`);
export async function executeTrackerTransition(accountId: string | null, key: string, transitionId: string) {
  assertTrackerWritable();
  return request<TrackerIssue>(
    accountId,
    `/issues/${encodeURIComponent(key)}/transitions/${encodeURIComponent(transitionId)}/_execute`,
    { method: "POST", body: "{}" },
  );
}
export const listTrackerAttachments = (accountId: string | null, key: string) =>
  request<TrackerAttachment[]>(accountId, `/issues/${encodeURIComponent(key)}/attachments`);

/**
 * Account-scoped session metadata (myself + queues/statuses/priorities).
 * Dedupes in-flight loads (StrictMode / double init).
 */
export async function loadTrackerSessionMetadata(
  accountId: string,
  options?: { force?: boolean },
): Promise<TrackerSessionMetadata> {
  assertNotInCooldown();
  const force = options?.force === true;
  if (!force) {
    const cached = sessionMetaByAccount.get(accountId);
    if (cached) return cached;
    const inFlight = metaInFlightByAccount.get(accountId);
    if (inFlight) return inFlight;
  }

  const load = (async (): Promise<TrackerSessionMetadata> => {
    assertNotInCooldown();
    const myself = await getTrackerMyself(accountId);
    assertNotInCooldown();
    // Parallel metadata; if any 429, cooldown blocks further Tracker calls (incl. issues).
    const [queues, statuses, priorities] = await Promise.all([
      listTrackerQueues(accountId),
      listTrackerStatuses(accountId),
      listTrackerPriorities(accountId),
    ]);
    assertNotInCooldown();
    const bundle: TrackerSessionMetadata = { myself, queues, statuses, priorities };
    sessionMetaByAccount.set(accountId, bundle);
    return bundle;
  })().finally(() => {
    metaInFlightByAccount.delete(accountId);
  });

  metaInFlightByAccount.set(accountId, load);
  return load;
}

export async function uploadTrackerAttachment(
  accountId: string | null,
  key: string,
  name: string,
  data: Uint8Array,
): Promise<TrackerAttachment> {
  assertTrackerWritable();
  assertNotInCooldown();
  const { account, token } = await getYandexServiceContext(accountId);
  assertNotInCooldown();
  const orgId = await getStoredYandexOrgId(account.id);
  if (!orgId) throw new Error("Укажите организацию Яндекс 360, чтобы открыть Трекер.");
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(data)]), name);
  let response: Response;
  try {
    response = await tauriFetch(`${API}/issues/${encodeURIComponent(key)}/attachments`, {
      method: "POST",
      headers: { Authorization: `OAuth ${token}`, "X-Org-ID": orgId },
      body: form,
    });
  } catch (err) {
    if (err instanceof YandexApiError) throw err;
    throw new YandexApiError(0, "Не удалось связаться с Яндекс Трекером. Проверьте сеть и повторите.", "network");
  }
  if (!response.ok) throw await parseTrackerError(response);
  return response.json() as Promise<TrackerAttachment>;
}
