import type { Task, TaskPrincipalRef } from "./domain";
import type { TaskProvider } from "./taskProvider";
import { TaskProviderUnavailableError } from "./taskProvider";
import type { TaskRepository } from "./taskRepository";
import {
  createTrackerTaskFromMail,
  type CreateMailTaskInput,
} from "./mailCreateFlow";
import {
  filterTasksBySection,
  filterTasksByText,
  sortTasksForList,
  type CurrentTaskUser,
  type TaskListSection,
} from "./taskListView";

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

  listByAssignee(email: string): Promise<Task[]> {
    return this.repository.listByAssignee(email);
  }

  listCreatedBy(email: string): Promise<Task[]> {
    return this.repository.listCreatedBy(email);
  }

  /**
   * Cache-first section list. Does not wait on Tracker.
   */
  async listSection(input: {
    organizationId: string | null;
    section: TaskListSection;
    currentUser: CurrentTaskUser;
    textQuery?: string;
    nowSec?: number;
  }): Promise<Task[]> {
    const cached = await this.repository.list(input.organizationId);
    const filtered = filterTasksBySection(
      cached,
      input.section,
      input.currentUser,
      input.organizationId,
    );
    const searched = filterTasksByText(filtered, input.textQuery ?? "");
    return sortTasksForList(searched, input.nowSec);
  }

  /**
   * Best-effort remote refresh into projection cache. Failures leave cache intact.
   */
  async refreshFromProvider(input: {
    accountId: string;
    organizationId: string;
  }): Promise<{ ok: true; count: number } | { ok: false; error: unknown }> {
    const provider = this.resolveProvider?.(input.accountId) ?? null;
    if (!provider) {
      return { ok: false, error: new TaskProviderUnavailableError("yandex-tracker", "list") };
    }
    try {
      const [assigned, created] = await Promise.all([
        provider.listTasks(input.organizationId, { scope: "assigned-to-me", perPage: 50 }),
        provider.listTasks(input.organizationId, { scope: "created-by-me", perPage: 50 }),
      ]);
      const byId = new Map<string, Task>();
      for (const task of [...assigned, ...created]) {
        byId.set(task.id, task);
      }
      return { ok: true, count: byId.size };
    } catch (error) {
      return { ok: false, error };
    }
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
