import type { DbTask } from "@/services/db/tasks";
import type {
  Task,
  TaskPrincipalRef,
  TaskPriority,
  TaskProviderStatus,
  TaskSource,
  TaskStatus,
  TaskSyncState,
} from "./domain";

const TASK_STATUSES = new Set<TaskStatus>(["open", "in_progress", "done", "cancelled", "unknown"]);
const SYNC_STATES = new Set<TaskSyncState>(["fresh", "stale", "syncing", "error"]);

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseProviderStatus(value: string | null | undefined): TaskProviderStatus | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object") return parsed as TaskProviderStatus;
  } catch {
    // Older/future adapters may persist a raw key instead of structured JSON.
  }
  return { key: value, displayLabel: value };
}

function normalizeStatus(row: DbTask): TaskStatus {
  if (row.status && TASK_STATUSES.has(row.status as TaskStatus)) return row.status as TaskStatus;
  if (row.provider && row.provider !== "local") return "unknown";
  return row.is_completed ? "done" : "open";
}

function normalizePriority(row: DbTask): TaskPriority {
  switch (row.priority as string) {
    case "low": return "low";
    case "high": return "high";
    case "urgent":
    case "critical": return "critical";
    case "normal":
    case "medium": return "normal";
    case "unknown": return "unknown";
    case "none": return row.provider && row.provider !== "local" ? "unknown" : "normal";
    default: return "unknown";
  }
}

function storagePriority(priority: TaskPriority): DbTask["priority"] {
  switch (priority) {
    case "low": return "low";
    case "high": return "high";
    case "critical": return "urgent";
    case "normal": return "medium";
    case "unknown": return "none";
  }
}

export function dbTaskToTask(row: DbTask, source: TaskSource[] = []): Task {
  const provider = row.provider ?? "local";
  return {
    id: row.id,
    provider,
    providerTaskId: row.provider_task_id ?? null,
    externalKey: row.external_key ?? null,
    organizationId: row.organization_id ?? null,
    title: row.title,
    description: row.description,
    status: normalizeStatus(row),
    providerStatus: parseProviderStatus(row.provider_status),
    priority: normalizePriority(row),
    providerPriority: row.provider_priority ?? (provider === "local" ? row.priority : null),
    assignee: parseJson<TaskPrincipalRef | null>(row.assignee_json, null),
    createdBy: parseJson<TaskPrincipalRef | null>(row.creator_json, null),
    followers: parseJson<TaskPrincipalRef[]>(row.followers_json, []),
    dueAt: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    providerUpdatedAt: row.provider_updated_at ?? null,
    syncState: row.sync_state && SYNC_STATES.has(row.sync_state as TaskSyncState)
      ? row.sync_state as TaskSyncState
      : "fresh",
    source,
  };
}

export function taskToProjectionRow(task: Task): DbTask {
  return {
    id: task.id,
    account_id: null,
    title: task.title,
    description: task.description,
    priority: storagePriority(task.priority),
    is_completed: task.status === "done" ? 1 : 0,
    completed_at: task.status === "done" ? task.updatedAt : null,
    due_date: task.dueAt,
    parent_id: null,
    thread_id: null,
    thread_account_id: null,
    sort_order: 0,
    recurrence_rule: null,
    next_recurrence_at: null,
    tags_json: "[]",
    start_at: null,
    end_at: null,
    timezone: null,
    all_day: 0,
    location: null,
    participants_json: "[]",
    optional_participants_json: "[]",
    attachments_json: "[]",
    reminder_minutes: null,
    reminder_channel: null,
    color_label: null,
    telemost_url: null,
    telemost_conference_id: null,
    telemost_live_url: null,
    provider: task.provider,
    provider_task_id: task.providerTaskId,
    external_key: task.externalKey,
    organization_id: task.organizationId,
    status: task.status,
    provider_status: task.providerStatus ? JSON.stringify(task.providerStatus) : null,
    provider_priority: task.providerPriority,
    assignee_json: task.assignee ? JSON.stringify(task.assignee) : null,
    creator_json: task.createdBy ? JSON.stringify(task.createdBy) : null,
    followers_json: JSON.stringify(task.followers),
    provider_updated_at: task.providerUpdatedAt,
    sync_state: task.syncState,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}
