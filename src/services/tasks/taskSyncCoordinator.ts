import type { Task, TaskSyncState } from "./domain";
import type { TaskListOptions, TaskProvider } from "./taskProvider";
import { TaskProviderUnavailableError } from "./taskProvider";
import type { TaskRepository } from "./taskRepository";
import { TaskError, isTaskError } from "./yandexTracker/errors";

export type TaskSyncTrigger = "initial" | "manual" | "startup" | "reconnect" | "after-mutation";

export interface TaskSyncInput {
  accountId: string;
  organizationId: string;
  provider: TaskProvider;
  repository: TaskRepository;
  trigger: TaskSyncTrigger;
  /** Max pages per list scope (default 3). */
  maxPages?: number;
  perPage?: number;
  nowSec?: () => number;
  isOnline?: () => boolean;
}

export interface TaskSyncResult {
  ok: boolean;
  upserted: number;
  scopes: string[];
  lastSuccessAt: number | null;
  error?: TaskError | Error;
  fromCache: boolean;
}

export interface TaskSyncStatusSnapshot {
  syncing: boolean;
  lastSuccessAt: number | null;
  lastError: string | null;
  lastTrigger: TaskSyncTrigger | null;
}

type FlightKey = string;

const inFlight = new Map<FlightKey, Promise<TaskSyncResult>>();
const statusByKey = new Map<FlightKey, TaskSyncStatusSnapshot>();

const DEFAULT_MAX_PAGES = 3;
const DEFAULT_PER_PAGE = 50;

function flightKey(accountId: string, organizationId: string, providerId: string): FlightKey {
  return `${providerId}::${accountId}::${organizationId}`;
}

function defaultOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function getTaskSyncStatus(
  accountId: string,
  organizationId: string,
  providerId = "yandex-tracker",
): TaskSyncStatusSnapshot {
  return (
    statusByKey.get(flightKey(accountId, organizationId, providerId)) ?? {
      syncing: false,
      lastSuccessAt: null,
      lastError: null,
      lastTrigger: null,
    }
  );
}

/** Test helper: clear single-flight maps. */
export function resetTaskSyncCoordinatorForTests(): void {
  inFlight.clear();
  statusByKey.clear();
}

async function listPaginated(
  provider: TaskProvider,
  organizationId: string,
  scope: NonNullable<TaskListOptions["scope"]>,
  perPage: number,
  maxPages: number,
): Promise<Task[]> {
  const collected: Task[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await provider.listTasks(organizationId, { scope, page, perPage });
    collected.push(...batch);
    if (batch.length < perPage) break;
  }
  return collected;
}

/**
 * Provider-neutral org-scoped remote → projection sync with single-flight.
 * listTasks/project already upsert; coordinator owns pagination, scopes, status.
 */
export async function syncOrganizationTasks(input: TaskSyncInput): Promise<TaskSyncResult> {
  const key = flightKey(input.accountId, input.organizationId, input.provider.id);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const now = input.nowSec ?? (() => Math.floor(Date.now() / 1000));
  const isOnline = input.isOnline ?? defaultOnline;

  const run = (async (): Promise<TaskSyncResult> => {
    statusByKey.set(key, {
      syncing: true,
      lastSuccessAt: statusByKey.get(key)?.lastSuccessAt ?? null,
      lastError: null,
      lastTrigger: input.trigger,
    });

    if (!isOnline()) {
      const error = new TaskError("offline", "Нет сети — показан локальный кэш", { retryable: true });
      statusByKey.set(key, {
        syncing: false,
        lastSuccessAt: statusByKey.get(key)?.lastSuccessAt ?? null,
        lastError: error.message,
        lastTrigger: input.trigger,
      });
      return {
        ok: false,
        upserted: 0,
        scopes: [],
        lastSuccessAt: statusByKey.get(key)?.lastSuccessAt ?? null,
        error,
        fromCache: true,
      };
    }

    const maxPages = Math.min(Math.max(input.maxPages ?? DEFAULT_MAX_PAGES, 1), 10);
    const perPage = Math.min(Math.max(input.perPage ?? DEFAULT_PER_PAGE, 1), 100);
    const scopes: Array<NonNullable<TaskListOptions["scope"]>> = [
      "assigned-to-me",
      "created-by-me",
      "completed-recent",
    ];

    try {
      const byId = new Map<string, Task>();
      const completedScopes: string[] = [];
      for (const scope of scopes) {
        const pagesForScope = scope === "completed-recent" ? Math.min(maxPages, 2) : maxPages;
        try {
          const tasks = await listPaginated(
            input.provider,
            input.organizationId,
            scope,
            perPage,
            pagesForScope,
          );
          for (const task of tasks) {
            byId.set(task.id, task);
          }
          completedScopes.push(scope);
        } catch (scopeError) {
          // completed-recent may fail on custom workflows without statusType — keep other scopes
          if (scope !== "completed-recent") throw scopeError;
        }
      }

      const successAt = now();
      statusByKey.set(key, {
        syncing: false,
        lastSuccessAt: successAt,
        lastError: null,
        lastTrigger: input.trigger,
      });
      return {
        ok: true,
        upserted: byId.size,
        scopes: completedScopes,
        lastSuccessAt: successAt,
        fromCache: false,
      };
    } catch (cause) {
      const error = isTaskError(cause)
        ? cause
        : cause instanceof TaskProviderUnavailableError
          ? new TaskError("provider-unavailable", cause.message, { cause })
          : new TaskError("unavailable", "Не удалось обновить задачи", {
            retryable: true,
            cause,
          });
      statusByKey.set(key, {
        syncing: false,
        lastSuccessAt: statusByKey.get(key)?.lastSuccessAt ?? null,
        lastError: error.message,
        lastTrigger: input.trigger,
      });
      return {
        ok: false,
        upserted: 0,
        scopes: [],
        lastSuccessAt: statusByKey.get(key)?.lastSuccessAt ?? null,
        error,
        fromCache: true,
      };
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, run);
  return run;
}

export type TaskAvailabilityState = Extract<
  TaskSyncState,
  "unavailable" | "removed" | "permission-denied" | "error" | "stale" | "fresh"
>;

/**
 * Mark a cached projection when remote get fails with typed reason.
 * Does not delete the row or wipe TaskSource.
 */
export async function markTaskRemoteAvailability(
  repository: TaskRepository,
  taskId: string,
  state: "unavailable" | "removed" | "permission-denied" | "stale" | "error",
): Promise<Task | null> {
  const existing = await repository.get(taskId);
  if (!existing) return null;
  const next: Task = {
    ...existing,
    syncState: state,
    updatedAt: Math.floor(Date.now() / 1000),
  };
  await repository.upsertProjection(next);
  // Preserve sources already on the row (upsertProjection may not re-write sources).
  return { ...next, source: existing.source };
}

/**
 * Refresh one remote task into projection. Typed availability on 404/403.
 */
export async function refreshOneRemoteTask(input: {
  organizationId: string;
  providerTaskId: string;
  localTaskId?: string;
  provider: TaskProvider;
  repository: TaskRepository;
}): Promise<
  | { ok: true; task: Task }
  | { ok: false; reason: "unavailable" | "removed" | "permission-denied" | "error"; task: Task | null }
> {
  try {
    const remote = await input.provider.getTask(input.organizationId, input.providerTaskId);
    if (!remote) {
      const localId = input.localTaskId;
      const marked = localId
        ? await markTaskRemoteAvailability(input.repository, localId, "unavailable")
        : null;
      return { ok: false, reason: "unavailable", task: marked };
    }
    return { ok: true, task: remote };
  } catch (error) {
    if (isTaskError(error)) {
      const reason =
        error.code === "permission-denied"
          ? "permission-denied"
          : error.code === "not-found"
            ? "removed"
            : "error";
      const marked = input.localTaskId
        ? await markTaskRemoteAvailability(input.repository, input.localTaskId, reason)
        : null;
      return { ok: false, reason, task: marked };
    }
    const marked = input.localTaskId
      ? await markTaskRemoteAvailability(input.repository, input.localTaskId, "error")
      : null;
    return { ok: false, reason: "error", task: marked };
  }
}

const LIFECYCLE_FLAG = "__office360_tasks_sync_lifecycle__";

/**
 * Hook Tasks sync into browser online/reconnect without a second listener stack.
 * Call once from app shell; OrganizationTasksView also refreshes on mount.
 */
export function attachTasksSyncLifecycle(
  resolveTargets: () => Array<{
    accountId: string;
    organizationId: string;
    provider: TaskProvider;
    repository: TaskRepository;
  }>,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const w = window as Window & { [LIFECYCLE_FLAG]?: boolean };
  if (w[LIFECYCLE_FLAG]) return () => undefined;
  w[LIFECYCLE_FLAG] = true;

  const run = (trigger: TaskSyncTrigger) => {
    for (const target of resolveTargets()) {
      void syncOrganizationTasks({ ...target, trigger });
    }
  };

  const onOnline = () => run("reconnect");
  window.addEventListener("online", onOnline);
  // Soft startup: after listeners are attached.
  queueMicrotask(() => run("startup"));

  return () => {
    window.removeEventListener("online", onOnline);
    delete w[LIFECYCLE_FLAG];
  };
}
