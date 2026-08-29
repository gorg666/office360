import type { Task, TaskPrincipalRef, TaskProviderId } from "./domain";

export type TaskCapability =
  | "read"
  | "create"
  | "assign"
  | "priority"
  | "dueDate"
  | "followers"
  | "transitions"
  | "comments"
  | "attachments"
  | "organizationDirectoryBinding";

export type TaskProviderCapabilities = Record<TaskCapability, boolean>;

export const NO_TASK_PROVIDER_CAPABILITIES: TaskProviderCapabilities = {
  read: false,
  create: false,
  assign: false,
  priority: false,
  dueDate: false,
  followers: false,
  transitions: false,
  comments: false,
  attachments: false,
  organizationDirectoryBinding: false,
};

export interface TaskProviderMutationInput {
  organizationId: string;
  taskId?: string;
  fields?: Partial<Task>;
  transitionId?: string;
}

export interface TaskProvider {
  readonly id: TaskProviderId;
  capabilities(): Promise<TaskProviderCapabilities>;
  getTask(organizationId: string, providerTaskId: string): Promise<Task | null>;
  listTasks(organizationId: string): Promise<Task[]>;
  createTask(input: TaskProviderMutationInput): Promise<Task>;
  updateTask(input: TaskProviderMutationInput): Promise<Task>;
  transitionTask(input: TaskProviderMutationInput): Promise<Task>;
  resolveAssignee(organizationId: string, principal: TaskPrincipalRef): Promise<TaskPrincipalRef | null>;
  listQueues(organizationId: string): Promise<Array<{ id: string; key: string; displayName: string }>>;
}

export class TaskProviderUnavailableError extends Error {
  constructor(provider: TaskProviderId, operation: string) {
    super(`Task provider "${provider}" is not configured for ${operation}`);
    this.name = "TaskProviderUnavailableError";
  }
}
