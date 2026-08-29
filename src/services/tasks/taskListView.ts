import type { Task, TaskPrincipalRef, TaskPriority, TaskStatus } from "./domain";
import { normalizeEmail } from "@/utils/emailUtils";
import { personDisplayName } from "@/services/people/domain";

export type TaskListSection = "my" | "created-by-me" | "completed" | "all";

export interface CurrentTaskUser {
  email: string;
  providerUid?: string | null;
}

export const TASK_STATUS_LABEL_RU: Record<TaskStatus, string> = {
  open: "Открыта",
  in_progress: "В работе",
  done: "Выполнена",
  cancelled: "Отменена",
  unknown: "Статус",
};

export const TASK_PRIORITY_LABEL_RU: Record<TaskPriority, string> = {
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
  critical: "Критический",
  unknown: "—",
};

const PRIORITY_RANK: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  unknown: 4,
};

export function principalMatchesUser(
  principal: TaskPrincipalRef | null | undefined,
  current: CurrentTaskUser,
): boolean {
  if (!principal) return false;
  const uid = current.providerUid?.trim();
  if (uid && principal.providerUid?.trim() && uid === principal.providerUid.trim()) {
    return true;
  }
  const a = normalizeEmail(principal.email ?? "");
  const b = normalizeEmail(current.email ?? "");
  return Boolean(a && b && a === b);
}

export function isCompletedStatus(status: TaskStatus): boolean {
  return status === "done" || status === "cancelled";
}

export function isOverdue(task: Pick<Task, "status" | "dueAt">, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (isCompletedStatus(task.status)) return false;
  if (task.dueAt == null) return false;
  return task.dueAt < nowSec;
}

export function scopeTasksToOrganization(tasks: Task[], organizationId: string | null | undefined): Task[] {
  const org = organizationId?.trim() ?? "";
  if (!org) return [];
  return tasks.filter((task) => (task.organizationId ?? "").trim() === org);
}

export function filterTasksBySection(
  tasks: Task[],
  section: TaskListSection,
  current: CurrentTaskUser,
  organizationId: string | null | undefined,
): Task[] {
  const scoped = scopeTasksToOrganization(tasks, organizationId);
  switch (section) {
    case "my":
      return scoped.filter(
        (task) => principalMatchesUser(task.assignee, current) && !isCompletedStatus(task.status),
      );
    case "created-by-me":
      return scoped.filter(
        (task) => principalMatchesUser(task.createdBy, current) && !isCompletedStatus(task.status),
      );
    case "completed":
      return scoped.filter(
        (task) =>
          isCompletedStatus(task.status)
          && (
            principalMatchesUser(task.assignee, current)
            || principalMatchesUser(task.createdBy, current)
          ),
      );
    case "all":
      return scoped;
    default:
      return scoped;
  }
}

export function sortTasksForList(tasks: Task[], nowSec = Math.floor(Date.now() / 1000)): Task[] {
  return [...tasks].sort((a, b) => {
    const aOverdue = isOverdue(a, nowSec) ? 0 : 1;
    const bOverdue = isOverdue(b, nowSec) ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;

    const aHasDue = a.dueAt != null ? 0 : 1;
    const bHasDue = b.dueAt != null ? 0 : 1;
    if (aHasDue !== bHasDue) return aHasDue - bHasDue;

    if (a.dueAt != null && b.dueAt != null && a.dueAt !== b.dueAt) {
      return a.dueAt - b.dueAt;
    }

    const priorityDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (priorityDiff !== 0) return priorityDiff;

    return b.updatedAt - a.updatedAt;
  });
}

export function filterTasksByText(tasks: Task[], query: string): Task[] {
  const q = query.trim().toLowerCase();
  if (!q) return tasks;
  return tasks.filter((task) => {
    if (task.title.toLowerCase().includes(q)) return true;
    if (task.externalKey?.toLowerCase().includes(q)) return true;
    const assigneeName = principalSearchBlob(task.assignee);
    const creatorName = principalSearchBlob(task.createdBy);
    return assigneeName.includes(q) || creatorName.includes(q);
  });
}

function principalSearchBlob(principal: TaskPrincipalRef | null | undefined): string {
  if (!principal) return "";
  const name = principal.person
    ? personDisplayName(principal.person)
    : (principal.displayName ?? "");
  return `${name} ${principal.email ?? ""}`.toLowerCase();
}

export function statusDisplayLabel(task: Pick<Task, "status" | "providerStatus">): string {
  if (task.status === "unknown") {
    return task.providerStatus?.displayLabel?.trim() || TASK_STATUS_LABEL_RU.unknown;
  }
  return TASK_STATUS_LABEL_RU[task.status];
}

export function priorityDisplayLabel(task: Pick<Task, "priority" | "providerPriority">): string {
  if (task.priority === "unknown") {
    return task.providerPriority?.trim() || TASK_PRIORITY_LABEL_RU.unknown;
  }
  return TASK_PRIORITY_LABEL_RU[task.priority];
}

export function mailSourceOf(task: Pick<Task, "source">) {
  return task.source.find((source) => source.type === "mail") ?? null;
}

export function emptyStateCopyRu(section: TaskListSection): string {
  switch (section) {
    case "my":
      return "У вас пока нет задач";
    case "created-by-me":
      return "Вы пока никому не ставили задачи";
    case "completed":
      return "Нет завершённых задач";
    default:
      return "У вас пока нет задач";
  }
}

/** Format due date without accidental host-local day shift for date-only unix noon values. */
export function formatTaskDueDate(dueAt: number | null, locale = "ru-RU"): string {
  if (dueAt == null) return "без срока";
  const date = new Date(dueAt * 1000);
  return date.toLocaleDateString(locale);
}
