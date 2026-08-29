import type { Task, TaskPrincipalRef } from "./domain";
import type { TaskProvider } from "./taskProvider";
import { TaskProviderUnavailableError } from "./taskProvider";
import type { TaskRepository } from "./taskRepository";
import {
  createTrackerTaskFromMail,
  type CreateMailTaskInput,
} from "./mailCreateFlow";

export class TaskService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly resolveProvider?: (accountId: string) => TaskProvider | null,
  ) {}

  get(id: string): Promise<Task | null> {
    return this.repository.get(id);
  }

  list(organizationId?: string | null): Promise<Task[]> {
    return this.repository.list(organizationId);
  }

  getTasksForMail(accountId: string, messageId: string): Promise<Task[]> {
    return this.repository.listBySource({ type: "mail", accountId, messageId });
  }

  linkSource(source: Parameters<TaskRepository["addSource"]>[0]): Promise<void> {
    return this.repository.addSource(source);
  }

  async createRemoteTask(provider: Task["provider"]): Promise<never> {
    throw new TaskProviderUnavailableError(provider, "create");
  }

  async updateRemoteTask(provider: Task["provider"]): Promise<never> {
    throw new TaskProviderUnavailableError(provider, "update");
  }

  async transitionRemoteTask(provider: Task["provider"]): Promise<never> {
    throw new TaskProviderUnavailableError(provider, "transition");
  }

  async createFromMail(input: CreateMailTaskInput & { accountId: string }): Promise<Task> {
    const provider = this.resolveProvider?.(input.accountId) ?? null;
    if (!provider) {
      throw new TaskProviderUnavailableError("yandex-tracker", "create");
    }
    return createTrackerTaskFromMail({
      payload: input,
      provider,
      repository: this.repository,
    });
  }

  async resolveMailAssignee(
    accountId: string,
    organizationId: string,
    principal: TaskPrincipalRef,
  ): Promise<TaskPrincipalRef> {
    const provider = this.resolveProvider?.(accountId) ?? null;
    if (!provider) {
      throw new TaskProviderUnavailableError("yandex-tracker", "resolveAssignee");
    }
    const resolved = await provider.resolveAssignee(organizationId, principal);
    if (!resolved?.providerUid) {
      const { TaskError } = await import("./yandexTracker/errors");
      throw new TaskError("assignee-unresolved", "Assignee could not be resolved to Tracker UID");
    }
    return resolved;
  }
}
