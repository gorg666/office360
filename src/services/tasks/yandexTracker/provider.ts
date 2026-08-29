import type { Task, TaskPrincipalRef } from "../domain";
import type {
  TaskProvider,
  TaskProviderCapabilities,
  TaskProviderMutationInput,
  TaskListOptions,
} from "../taskProvider";
import type { TaskRepository } from "../taskRepository";
import { getOrganizationTaskSettings } from "../organizationTaskSettings";
import { TaskError } from "./errors";
import { resolveAssigneeStrict, type DirectoryMembershipPort, type TrackerUserPort } from "./assigneeResolution";
import { createDirectoryMembershipPort } from "./directoryMembership";
import { mapTrackerIssueToTask } from "./issueMapping";
import { toTrackerPriorityKey, unixToDeadline } from "./mapping";
import { resolveTrackerOrganizationContext } from "./organizationContext";
import {
  createTrackerIssueV3,
  executeTrackerTransitionV3,
  getTrackerIssueV3,
  getTrackerQueueV3,
  getTrackerUserV3,
  listTrackerPrioritiesV3,
  listTrackerQueuesV3,
  listTrackerTransitionsV3,
  listTrackerUsersV3,
  searchTrackerIssuesV3,
  updateTrackerIssueV3,
  YandexApiError,
  type TrackerIssue,
  type TrackerRequestContext,
  type TrackerTransition,
} from "@/services/yandex/trackerClient";
import { getYandexServiceScopes } from "@/services/yandex/accountApi";

export interface YandexTrackerTaskProviderOptions {
  accountId: string;
  repository: TaskRepository;
  directory?: DirectoryMembershipPort;
  trackerUsers?: TrackerUserPort;
  isOnline?: () => boolean;
  getServiceScopes?: (accountId: string) => Promise<Set<string>>;
  getSettings?: typeof getOrganizationTaskSettings;
  now?: () => number;
}

function defaultIsOnline(): boolean {
  if (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean") {
    return navigator.onLine;
  }
  return true;
}

function mapYandexError(error: unknown): never {
  if (error instanceof TaskError) throw error;
  if (error instanceof YandexApiError) {
    switch (error.status) {
      case 401:
        throw new TaskError("unauthorized", "Tracker authorization failed", { cause: error });
      case 403:
        throw new TaskError("permission-denied", "Tracker permission denied", { cause: error });
      case 404:
        throw new TaskError("not-found", "Tracker resource not found", { cause: error });
      case 409:
        throw new TaskError("conflict", "Tracker conflict", { cause: error });
      case 429:
        throw new TaskError("rate-limited", "Tracker rate limit exceeded", {
          retryable: true,
          cause: error,
        });
      default:
        throw new TaskError("unavailable", "Tracker request failed", {
          retryable: error.status >= 500,
          cause: error,
        });
    }
  }
  if (error instanceof TypeError) {
    throw new TaskError("unavailable", "Tracker network error", { retryable: true, cause: error });
  }
  throw new TaskError("unavailable", "Tracker request failed", { cause: error });
}

export class YandexTrackerTaskProvider implements TaskProvider {
  readonly id = "yandex-tracker" as const;

  private readonly accountId: string;
  private readonly repository: TaskRepository;
  private readonly directory: DirectoryMembershipPort;
  private readonly trackerUsers: TrackerUserPort;
  private readonly isOnline: () => boolean;
  private readonly getServiceScopes: (accountId: string) => Promise<Set<string>>;
  private readonly getSettings: typeof getOrganizationTaskSettings;
  private readonly now: () => number;

  constructor(options: YandexTrackerTaskProviderOptions) {
    this.accountId = options.accountId;
    this.repository = options.repository;
    this.directory = options.directory ?? createDirectoryMembershipPort(options.accountId);
    this.trackerUsers = options.trackerUsers ?? {
      getUser: (ctx, loginOrId) => getTrackerUserV3(ctx, loginOrId),
      listUsers: (ctx, page, perPage) => listTrackerUsersV3(ctx, perPage, page),
    };
    this.isOnline = options.isOnline ?? defaultIsOnline;
    this.getServiceScopes = options.getServiceScopes ?? getYandexServiceScopes;
    this.getSettings = options.getSettings ?? getOrganizationTaskSettings;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  private assertOnline(): void {
    if (!this.isOnline()) {
      throw new TaskError("offline", "Remote Tracker mutations and live reads require network");
    }
  }

  private async loadSettings(organizationId: string) {
    return this.getSettings(organizationId, "yandex-tracker");
  }

  private async resolveOrg(organizationId: string) {
    this.assertOnline();
    return resolveTrackerOrganizationContext({
      settings: await this.loadSettings(organizationId),
      accountId: this.accountId,
    });
  }

  async capabilities(organizationId?: string): Promise<TaskProviderCapabilities> {
    const empty: TaskProviderCapabilities = {
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

    if (!this.isOnline()) {
      return empty;
    }

    try {
      const scopes = await this.getServiceScopes(this.accountId);
      const canRead = scopes.has("tracker:read") || scopes.has("tracker:write");
      const canWrite = scopes.has("tracker:write");
      if (!canRead) return empty;

      let orgOk = false;
      let queueOk = false;
      if (organizationId) {
        const settings = await this.loadSettings(organizationId);
        if (settings?.enabled && settings.providerOrganizationId) {
          const org = await resolveTrackerOrganizationContext({
            settings,
            accountId: this.accountId,
          });
          orgOk = Boolean(org.myself);
          queueOk = Boolean(settings.defaultQueue?.trim());
        }
      }

      return {
        read: canRead && (organizationId ? orgOk : true),
        create: canWrite && orgOk && queueOk,
        assign: canWrite && orgOk,
        priority: canWrite && orgOk,
        dueDate: canWrite && orgOk,
        followers: canWrite && orgOk, // PARTIAL — create/update when API accepts
        transitions: canWrite && orgOk,
        comments: false,
        attachments: false,
        organizationDirectoryBinding: orgOk,
      };
    } catch {
      return empty;
    }
  }

  async listQueues(organizationId: string): Promise<Array<{ id: string; key: string; displayName: string }>> {
    const org = await this.resolveOrg(organizationId);
    try {
      const queues = await listTrackerQueuesV3(org.ctx, 100, 1);
      return queues.map((queue) => ({
        id: String(queue.id ?? queue.key ?? ""),
        key: String(queue.key ?? queue.id ?? ""),
        displayName: queue.name ?? queue.display ?? String(queue.key ?? queue.id ?? ""),
      })).filter((queue) => queue.key);
    } catch (error) {
      mapYandexError(error);
    }
  }

  async resolveDefaultQueue(organizationId: string): Promise<{ id: string; key: string; displayName: string }> {
    const org = await this.resolveOrg(organizationId);
    const key = org.defaultQueue?.trim();
    if (!key) {
      throw new TaskError("configuration-required", "defaultQueue is not configured");
    }
    try {
      const queue = await getTrackerQueueV3(org.ctx, key);
      return {
        id: String(queue.id ?? queue.key ?? key),
        key: String(queue.key ?? key),
        displayName: queue.name ?? queue.display ?? key,
      };
    } catch (error) {
      if (error instanceof YandexApiError && (error.status === 403 || error.status === 404)) {
        throw new TaskError("queue-unavailable", "Configured default queue is unavailable", { cause: error });
      }
      mapYandexError(error);
    }
  }

  async listPriorities(organizationId: string): Promise<Array<{ id?: string; key?: string; display?: string }>> {
    const org = await this.resolveOrg(organizationId);
    try {
      return await listTrackerPrioritiesV3(org.ctx);
    } catch (error) {
      mapYandexError(error);
    }
  }

  async resolveAssignee(organizationId: string, principal: TaskPrincipalRef): Promise<TaskPrincipalRef | null> {
    const org = await this.resolveOrg(organizationId);
    try {
      return await resolveAssigneeStrict({
        organizationId: org.organizationId,
        providerOrganizationId: org.providerOrganizationId,
        principal,
        ctx: org.ctx,
        directory: this.directory,
        trackerUsers: this.trackerUsers,
      });
    } catch (error) {
      if (error instanceof TaskError && error.code === "assignee-unresolved") return null;
      mapYandexError(error);
    }
  }

  private async project(issue: TrackerIssue, organizationId: string): Promise<Task> {
    const localId = `yandex-tracker:${organizationId}:${issue.id}`;
    const prior = await this.repository.get(localId);
    const task = mapTrackerIssueToTask({
      issue,
      organizationId,
      localId,
      now: this.now(),
    });
    if (prior?.source?.length) task.source = prior.source;
    await this.repository.upsertProjection(task);
    return task;
  }

  async getTask(organizationId: string, providerTaskId: string): Promise<Task | null> {
    const org = await this.resolveOrg(organizationId);
    try {
      const issue = await getTrackerIssueV3(org.ctx, providerTaskId);
      return this.project(issue, org.organizationId);
    } catch (error) {
      if (error instanceof YandexApiError && error.status === 404) return null;
      mapYandexError(error);
    }
  }

  async listTasks(organizationId: string, options: TaskListOptions = {}): Promise<Task[]> {
    const org = await this.resolveOrg(organizationId);
    const perPage = Math.min(Math.max(options.perPage ?? 50, 1), 100);
    const page = Math.max(options.page ?? 1, 1);
    const scope = options.scope ?? "assigned-to-me";

    const filter: Record<string, unknown> = {};
    if (scope === "assigned-to-me") filter.assignee = "me()";
    if (scope === "created-by-me") filter.createdBy = "me()";

    try {
      const issues = await searchTrackerIssuesV3(org.ctx, { filter }, perPage, page);
      const tasks: Task[] = [];
      for (const issue of issues) {
        tasks.push(await this.project(issue, org.organizationId));
      }
      return tasks;
    } catch (error) {
      mapYandexError(error);
    }
  }

  private async requireWrite(organizationId: string) {
    const scopes = await this.getServiceScopes(this.accountId);
    if (!scopes.has("tracker:write")) {
      throw new TaskError("permission-denied", "tracker:write scope is required for mutations");
    }
    return this.resolveOrg(organizationId);
  }

  async createTask(input: TaskProviderMutationInput): Promise<Task> {
    const org = await this.requireWrite(input.organizationId);

    const queueKey = (input.queue ?? org.defaultQueue)?.trim();
    if (!queueKey) {
      throw new TaskError("configuration-required", "defaultQueue is required to create a task");
    }
    await this.resolveDefaultQueue(input.organizationId);

    const title = input.fields?.title?.trim();
    if (!title) throw new TaskError("configuration-required", "Task title is required");

    const caps = await this.capabilities(input.organizationId);
    if (!caps.create) {
      throw new TaskError("permission-denied", "Create is disabled for current Tracker capabilities");
    }

    const body: Record<string, unknown> = {
      summary: title,
      queue: queueKey,
    };
    if (input.fields?.description) body.description = input.fields.description;
    if (input.unique) body.unique = input.unique;

    if (input.fields?.assignee) {
      const resolved = await resolveAssigneeStrict({
        organizationId: org.organizationId,
        providerOrganizationId: org.providerOrganizationId,
        principal: input.fields.assignee,
        ctx: org.ctx,
        directory: this.directory,
        trackerUsers: this.trackerUsers,
      });
      body.assignee = resolved.providerUid;
    }

    if (input.fields?.priority && input.fields.priority !== "unknown") {
      const priority = toTrackerPriorityKey(input.fields.priority);
      if (priority) body.priority = priority;
    }

    if (input.fields?.dueAt != null) {
      body.deadline = unixToDeadline(input.fields.dueAt);
    }

    if (input.fields?.followers?.length) {
      if (!caps.followers) {
        throw new TaskError("permission-denied", "Followers are not available");
      }
      const followerUids: string[] = [];
      for (const follower of input.fields.followers) {
        const resolved = await resolveAssigneeStrict({
          organizationId: org.organizationId,
          providerOrganizationId: org.providerOrganizationId,
          principal: follower,
          ctx: org.ctx,
          directory: this.directory,
          trackerUsers: this.trackerUsers,
        });
        if (resolved.providerUid) followerUids.push(resolved.providerUid);
      }
      if (followerUids.length) body.followers = followerUids;
    }

    try {
      const created = await createTrackerIssueV3(org.ctx, body);
      const canonical = await getTrackerIssueV3(org.ctx, created.key || created.id);
      return this.project(canonical, org.organizationId);
    } catch (error) {
      if (error instanceof YandexApiError && error.status === 409 && input.unique) {
        return this.reconcileUnique(org.ctx, org.organizationId, input.unique);
      }
      mapYandexError(error);
    }
  }

  private async reconcileUnique(
    ctx: TrackerRequestContext,
    organizationId: string,
    unique: string,
  ): Promise<Task> {
    const matches = await searchTrackerIssuesV3(ctx, { filter: { unique } }, 10, 1);
    const strict = matches.filter((issue) => issue.unique === unique);
    const pool = strict.length ? strict : matches.length === 1 ? matches : [];
    if (pool.length === 1) {
      return this.project(pool[0]!, organizationId);
    }
    throw new TaskError("conflict", "Ambiguous Tracker unique conflict during create replay");
  }

  async updateTask(input: TaskProviderMutationInput): Promise<Task> {
    const org = await this.requireWrite(input.organizationId);
    const caps = await this.capabilities(input.organizationId);
    if (!caps.assign && !caps.priority && !caps.dueDate && !caps.create) {
      throw new TaskError("permission-denied", "Update is disabled for current Tracker capabilities");
    }
    const key = input.providerTaskId ?? input.taskId;
    if (!key) throw new TaskError("configuration-required", "providerTaskId is required for update");

    const body: Record<string, unknown> = {};
    if (input.fields?.title !== undefined) body.summary = input.fields.title;
    if (input.fields?.description !== undefined) body.description = input.fields.description ?? "";
    if (input.fields?.priority && input.fields.priority !== "unknown") {
      const priority = toTrackerPriorityKey(input.fields.priority);
      if (priority) body.priority = priority;
    }
    if (input.fields?.dueAt !== undefined) {
      body.deadline = input.fields.dueAt == null ? null : unixToDeadline(input.fields.dueAt);
    }
    if (input.fields?.assignee) {
      const resolved = await resolveAssigneeStrict({
        organizationId: org.organizationId,
        providerOrganizationId: org.providerOrganizationId,
        principal: input.fields.assignee,
        ctx: org.ctx,
        directory: this.directory,
        trackerUsers: this.trackerUsers,
      });
      body.assignee = resolved.providerUid;
    }
    if (input.fields?.followers) {
      const followerUids: string[] = [];
      for (const follower of input.fields.followers) {
        const resolved = await resolveAssigneeStrict({
          organizationId: org.organizationId,
          providerOrganizationId: org.providerOrganizationId,
          principal: follower,
          ctx: org.ctx,
          directory: this.directory,
          trackerUsers: this.trackerUsers,
        });
        if (resolved.providerUid) followerUids.push(resolved.providerUid);
      }
      body.followers = followerUids;
    }

    try {
      await updateTrackerIssueV3(org.ctx, key, body);
      const refreshed = await getTrackerIssueV3(org.ctx, key);
      return this.project(refreshed, org.organizationId);
    } catch (error) {
      mapYandexError(error);
    }
  }

  async listTransitions(organizationId: string, providerTaskId: string): Promise<TrackerTransition[]> {
    const org = await this.resolveOrg(organizationId);
    try {
      return await listTrackerTransitionsV3(org.ctx, providerTaskId);
    } catch (error) {
      mapYandexError(error);
    }
  }

  async transitionTask(input: TaskProviderMutationInput): Promise<Task> {
    const org = await this.requireWrite(input.organizationId);
    const caps = await this.capabilities(input.organizationId);
    if (!caps.transitions) {
      throw new TaskError("permission-denied", "Transitions are disabled for current Tracker capabilities");
    }
    const key = input.providerTaskId ?? input.taskId;
    if (!key || !input.transitionId) {
      throw new TaskError("configuration-required", "providerTaskId and transitionId are required");
    }
    try {
      const available = await listTrackerTransitionsV3(org.ctx, key);
      const match = available.find(
        (item) => item.id === input.transitionId || item.display === input.transitionId,
      );
      if (!match) {
        throw new TaskError("not-found", "Requested transition is not available for this issue");
      }
      await executeTrackerTransitionV3(org.ctx, key, match.id);
      const refreshed = await getTrackerIssueV3(org.ctx, key);
      return this.project(refreshed, org.organizationId);
    } catch (error) {
      mapYandexError(error);
    }
  }
}
