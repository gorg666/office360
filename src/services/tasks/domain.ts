import type { PersonIdentity } from "@/services/people/domain";

export type TaskProviderId = "local" | "yandex-tracker" | (string & Record<never, never>);
export type TaskStatus = "open" | "in_progress" | "done" | "cancelled" | "unknown";
export type TaskPriority = "low" | "normal" | "high" | "critical" | "unknown";
export type TaskSyncState =
  | "fresh"
  | "stale"
  | "syncing"
  | "error"
  | "unavailable"
  | "removed"
  | "permission-denied";
export type TaskSourceType = "mail" | "calendar" | "manual" | "chat" | "document" | (string & Record<never, never>);

export interface TaskProviderStatus {
  id?: string;
  key?: string;
  displayLabel?: string;
}

export interface TaskPrincipalRef {
  person?: PersonIdentity;
  email: string;
  displayName?: string;
  providerUid?: string;
  organizationId?: string;
}

export interface TaskSource {
  id: string;
  taskId: string;
  type: TaskSourceType;
  accountId: string | null;
  messageId: string | null;
  threadId: string | null;
  rfcMessageId: string | null;
  subjectSnapshot: string | null;
  senderSnapshot: string | null;
  createdAt: number;
}

export interface OrganizationTaskSettings {
  organizationId: string;
  provider: TaskProviderId;
  enabled: boolean;
  providerOrganizationId: string | null;
  defaultQueue: string | null;
  updatedAt: number;
}

export interface Task {
  id: string;
  provider: TaskProviderId;
  providerTaskId: string | null;
  externalKey: string | null;
  organizationId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  providerStatus: TaskProviderStatus | null;
  priority: TaskPriority;
  providerPriority: string | null;
  assignee: TaskPrincipalRef | null;
  createdBy: TaskPrincipalRef | null;
  followers: TaskPrincipalRef[];
  dueAt: number | null;
  createdAt: number;
  updatedAt: number;
  providerUpdatedAt: number | null;
  syncState: TaskSyncState;
  source: TaskSource[];
}

export function isRemoteTask(task: Pick<Task, "provider">): boolean {
  return task.provider !== "local";
}
