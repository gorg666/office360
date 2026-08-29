/**
 * Low-level Tracker API v3 client with explicit organization binding.
 * Reuses Yandex service OAuth from accountApi — no second auth stack.
 */
import {
  getYandexServiceContext,
  parseApiError,
  YandexApiError,
} from "./accountApi";

export const TRACKER_API_V3 = "https://api.tracker.yandex.net/v3";

export interface TrackerRef {
  id?: string;
  key?: string;
  display?: string;
}

export interface TrackerUser {
  uid?: number | string;
  trackerUid?: number | string;
  passportUid?: number | string;
  login?: string;
  display?: string;
  email?: string;
  dismissed?: boolean;
  hasLicense?: boolean;
}

export interface TrackerIssue {
  id: string;
  key: string;
  summary: string;
  description?: string;
  status?: TrackerRef;
  priority?: TrackerRef;
  assignee?: TrackerUser | TrackerRef;
  createdBy?: TrackerUser | TrackerRef;
  followers?: Array<TrackerUser | TrackerRef>;
  queue?: TrackerRef;
  deadline?: string;
  unique?: string;
  updatedAt?: string;
  createdAt?: string;
}

export interface TrackerQueue extends TrackerRef {
  name?: string;
  defaultPriority?: TrackerRef;
}

export interface TrackerTransition {
  id: string;
  display: string;
  to?: TrackerRef;
}

export interface TrackerRequestContext {
  accountId: string | null;
  orgId: string;
}

export type TrackerHttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface TrackerRequestInit {
  method?: TrackerHttpMethod;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Safe retries for transient read failures. Mutations should leave false. */
  retry?: boolean;
  maxRetries?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(path: string, query?: TrackerRequestInit["query"]): string {
  const url = new URL(path.startsWith("http") ? path : `${TRACKER_API_V3}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function trackerV3Request<T>(
  ctx: TrackerRequestContext,
  path: string,
  init: TrackerRequestInit = {},
): Promise<T> {
  if (!ctx.orgId?.trim()) {
    throw new YandexApiError(400, "Tracker organization id is required", "organization-required");
  }

  const { token } = await getYandexServiceContext(ctx.accountId);
  const method = init.method ?? "GET";
  const retry = init.retry === true && method === "GET";
  const maxRetries = init.maxRetries ?? (retry ? 2 : 0);
  let attempt = 0;

  while (true) {
    const response = await fetch(buildUrl(path, init.query), {
      method,
      headers: {
        Authorization: `OAuth ${token}`,
        "X-Org-ID": ctx.orgId.trim(),
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    if (response.ok) {
      if (response.status === 204) return undefined as T;
      return response.json() as Promise<T>;
    }

    const retryAfter = Number(response.headers.get("Retry-After") || 0);
    const transient = response.status === 429 || response.status >= 500;
    if (retry && transient && attempt < maxRetries) {
      attempt += 1;
      await sleep(Math.max(250, retryAfter > 0 ? retryAfter * 1000 : 300 * attempt));
      continue;
    }

    throw await parseApiError(response);
  }
}

export const getTrackerMyself = (ctx: TrackerRequestContext) =>
  trackerV3Request<TrackerUser>(ctx, "/myself", { retry: true });

export const listTrackerQueuesV3 = (ctx: TrackerRequestContext, perPage = 50, page = 1) =>
  trackerV3Request<TrackerQueue[]>(ctx, "/queues", {
    retry: true,
    query: { perPage, page },
  });

export const getTrackerQueueV3 = (ctx: TrackerRequestContext, queueKey: string) =>
  trackerV3Request<TrackerQueue>(ctx, `/queues/${encodeURIComponent(queueKey)}`, { retry: true });

export const listTrackerPrioritiesV3 = (ctx: TrackerRequestContext, perPage = 50) =>
  trackerV3Request<TrackerRef[]>(ctx, "/priorities", {
    retry: true,
    query: { perPage },
  });

export const getTrackerUserV3 = (ctx: TrackerRequestContext, loginOrId: string) =>
  trackerV3Request<TrackerUser>(ctx, `/users/${encodeURIComponent(loginOrId)}`, { retry: true });

export const listTrackerUsersV3 = (ctx: TrackerRequestContext, perPage = 50, page = 1) =>
  trackerV3Request<TrackerUser[]>(ctx, "/users", {
    retry: true,
    query: { perPage, page },
  });

export const searchTrackerIssuesV3 = (
  ctx: TrackerRequestContext,
  body: Record<string, unknown>,
  perPage = 50,
  page = 1,
) =>
  trackerV3Request<TrackerIssue[]>(ctx, "/issues/_search", {
    method: "POST",
    body,
    query: { perPage, page },
    retry: true,
  });

export const getTrackerIssueV3 = (ctx: TrackerRequestContext, keyOrId: string) =>
  trackerV3Request<TrackerIssue>(ctx, `/issues/${encodeURIComponent(keyOrId)}`, { retry: true });

export const createTrackerIssueV3 = (ctx: TrackerRequestContext, body: Record<string, unknown>) =>
  trackerV3Request<TrackerIssue>(ctx, "/issues", { method: "POST", body });

export const updateTrackerIssueV3 = (
  ctx: TrackerRequestContext,
  keyOrId: string,
  body: Record<string, unknown>,
) =>
  trackerV3Request<TrackerIssue>(ctx, `/issues/${encodeURIComponent(keyOrId)}`, {
    method: "PATCH",
    body,
  });

export const listTrackerTransitionsV3 = (ctx: TrackerRequestContext, keyOrId: string) =>
  trackerV3Request<TrackerTransition[]>(
    ctx,
    `/issues/${encodeURIComponent(keyOrId)}/transitions`,
    { retry: true },
  );

export const executeTrackerTransitionV3 = (
  ctx: TrackerRequestContext,
  keyOrId: string,
  transitionId: string,
) =>
  trackerV3Request<TrackerIssue>(
    ctx,
    `/issues/${encodeURIComponent(keyOrId)}/transitions/${encodeURIComponent(transitionId)}/_execute`,
    { method: "POST", body: {} },
  );

export { YandexApiError };
