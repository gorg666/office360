import type { Task, TaskPrincipalRef } from "./domain";
import type { TaskProvider, TaskProviderCapabilities } from "./taskProvider";
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
import {
  getTaskSyncStatus,
  refreshOneRemoteTask,
  syncOrganizationTasks,
  type TaskSyncResult,
  type TaskSyncTrigger,
} from "./taskSyncCoordinator";
import type { TrackerTransition } from "@/services/yandex/trackerClient";
import { TaskError, isTaskError } from "./yandexTracker/errors";

const MAX_MUTATION_RETRIES = 1;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withLimitedRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (isTaskError(error) && error.code === "rate-limited" && attempt < MAX_MUTATION_RETRIES) {
        attempt += 1;
        await sleep(800);
        continue;
      }
      if (isTaskError(error) && error.code === "conflict") {
        throw error;
      }
      throw error;
    }
  }
}

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

  getSyncStatus(accountId: string, organizationId: string, providerId = "yandex-tracker") {
    return getTaskSyncStatus(accountId, organizationId, providerId);
  }

  /**
   * Remote list sync into projection via shared coordinator (single-flight).
   * Failures leave cache intact.
   */
  async refreshFromProvider(input: {
    accountId: string;
    organizationId: string;
    trigger?: TaskSyncTrigger;
  }): Promise<TaskSyncResult> {
    const provider = this.resolveProvider?.(input.accountId) ?? null;
    if (!provider) {
      return {
        ok: false,
        upserted: 0,
        scopes: [],
        lastSuccessAt: null,
        error: new TaskProviderUnavailableError("yandex-tracker", "list"),
        fromCache: true,
      };
    }
    return syncOrganizationTasks({
      accountId: input.accountId,
      organizationId: input.organizationId,
      provider,
      repository: this.repository,
      trigger: input.trigger ?? "manual",
    });
  }

  async refreshTask(input: {
    accountId: string;
    organizationId: string;
    providerTaskId: string;
    localTaskId?: string;
  }): Promise<
    | { ok: true; task: Task }
    | { ok: false; reason: string; task: Task | null }
  > {
    const provider = this.resolveProvider?.(input.accountId) ?? null;
    if (!provider) {
      return { ok: false, reason: "provider-unavailable", task: null };
    }
    return refreshOneRemoteTask({
      organizationId: input.organizationId,
      providerTaskId: input.providerTaskId,
      localTaskId: input.localTaskId,
      provider,
      repository: this.repository,
    });
  }

  async capabilities(accountId: string, organizationId: string): Promise<TaskProviderCapabilities | null> {
    const provider = this.resolveProvider?.(accountId) ?? null;
    if (!provider) return null;
    return provider.capabilities(organizationId);
  }

  async listTransitions(input: {
    accountId: string;
    organizationId: string;
    providerTaskId: string;
  }): Promise<TrackerTransition[]> {
    const provider = this.resolveProvider?.(input.accountId) ?? null;
    if (!provider) throw new TaskProviderUnavailableError("yandex-tracker", "transitions");
    if (!provider.listTransitions) return [];
    return provider.listTransitions(input.organizationId, input.providerTaskId) as Promise<TrackerTransition[]>;
  }

  async transitionTask(input: {
    accountId: string;
    organizationId: string;
    providerTaskId: string;
    transitionId: string;
    localTaskId?: string;
  }): Promise<Task> {
    const provider = this.requireProvider(input.accountId, "transition");
    const task = await withLimitedRetry(() =>
      provider.transitionTask({
        organizationId: input.organizationId,
        providerTaskId: input.providerTaskId,
        transitionId: input.transitionId,
      }),
    );
    // Ensure fresh projection after conflict recovery path
    if (input.localTaskId && task.id !== input.localTaskId) {
      const prior = await this.repository.get(input.localTaskId);
      if (prior?.source?.length) {
        task.source = prior.source;
        await this.repository.upsertProjection(task);
      }
    }
    return task;
  }

  async updateTaskFields(input: {
    accountId: string;
    organizationId: string;
    providerTaskId: string;
    fields: Partial<Pick<Task, "title" | "description" | "priority" | "dueAt" | "assignee">>;
  }): Promise<Task> {
    const provider = this.requireProvider(input.accountId, "update");
    return withLimitedRetry(() =>
      provider.updateTask({
        organizationId: input.organizationId,
        providerTaskId: input.providerTaskId,
        fields: input.fields,
      }),
    );
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
      throw new TaskError("assignee-unresolved", "Assignee could not be resolved to Tracker UID");
    }
    return resolved;
  }

  private requireProvider(accountId: string, operation: string): TaskProvider {
    const provider = this.resolveProvider?.(accountId) ?? null;
    if (!provider) {
      throw new TaskProviderUnavailableError("yandex-tracker", operation);
    }
    return provider;
  }
}
