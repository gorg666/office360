import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Task } from "./domain";
import type { TaskProvider } from "./taskProvider";
import type { TaskRepository } from "./taskRepository";
import {
  markTaskRemoteAvailability,
  refreshOneRemoteTask,
  resetTaskSyncCoordinatorForTests,
  syncOrganizationTasks,
} from "./taskSyncCoordinator";

function task(partial: Partial<Task> = {}): Task {
  const now = 1_700_000_000;
  return {
    id: partial.id ?? "t1",
    provider: "yandex-tracker",
    providerTaskId: "1",
    externalKey: "T-1",
    organizationId: "org",
    title: "A",
    description: null,
    status: "open",
    providerStatus: null,
    priority: "normal",
    providerPriority: null,
    assignee: null,
    createdBy: null,
    followers: [],
    dueAt: null,
    createdAt: now,
    updatedAt: now,
    providerUpdatedAt: now,
    syncState: "fresh",
    source: [],
    ...partial,
  };
}

function repo(seed: Task[] = []): TaskRepository {
  const map = new Map(seed.map((t) => [t.id, t]));
  return {
    get: vi.fn(async (id) => map.get(id) ?? null),
    list: vi.fn(async () => [...map.values()]),
    upsertProjection: vi.fn(async (t) => {
      map.set(t.id, t);
    }),
    updateLocalProjection: vi.fn(),
    removeProjection: vi.fn(),
    listByAssignee: vi.fn(),
    listCreatedBy: vi.fn(),
    listBySource: vi.fn(),
    addSource: vi.fn(),
  };
}

function provider(listImpl?: TaskProvider["listTasks"]): TaskProvider {
  return {
    id: "yandex-tracker",
    capabilities: vi.fn(),
    getTask: vi.fn(),
    listTasks: listImpl ?? vi.fn().mockResolvedValue([task()]),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    transitionTask: vi.fn(),
    resolveAssignee: vi.fn(),
    listQueues: vi.fn(),
  };
}

describe("taskSyncCoordinator", () => {
  beforeEach(() => {
    resetTaskSyncCoordinatorForTests();
  });

  it("paginates scopes and dedupes by id", async () => {
    const listTasks = vi.fn(async (_org: string, options?: { scope?: string; page?: number }) => {
      if (options?.scope === "completed-recent") return [];
      if (options?.page === 1) return [task({ id: "a" }), task({ id: "b" })];
      if (options?.page === 2) return [task({ id: "b" })]; // shorter than perPage → stop
      return [];
    });
    const result = await syncOrganizationTasks({
      accountId: "acc",
      organizationId: "org",
      provider: provider(listTasks),
      repository: repo(),
      trigger: "manual",
      perPage: 2,
      maxPages: 3,
      isOnline: () => true,
      nowSec: () => 100,
    });
    expect(result.ok).toBe(true);
    expect(result.upserted).toBe(2);
    expect(listTasks).toHaveBeenCalled();
  });

  it("single-flight shares one in-flight promise", async () => {
    let resolveFirst!: (v: Task[]) => void;
    let calls = 0;
    const listTasks = vi.fn(() => {
      calls += 1;
      if (calls === 1) {
        return new Promise<Task[]>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve([] as Task[]);
    });
    const p = provider(listTasks);
    const r = repo();
    const a = syncOrganizationTasks({
      accountId: "acc",
      organizationId: "org",
      provider: p,
      repository: r,
      trigger: "manual",
      isOnline: () => true,
    });
    await Promise.resolve();
    const b = syncOrganizationTasks({
      accountId: "acc",
      organizationId: "org",
      provider: p,
      repository: r,
      trigger: "reconnect",
      isOnline: () => true,
    });
    expect(listTasks).toHaveBeenCalledTimes(1);
    resolveFirst([task()]);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe(rb);
    expect(ra.ok).toBe(true);
  });

  it("offline leaves cache and returns typed error", async () => {
    const result = await syncOrganizationTasks({
      accountId: "acc",
      organizationId: "org",
      provider: provider(),
      repository: repo([task()]),
      trigger: "manual",
      isOnline: () => false,
    });
    expect(result.ok).toBe(false);
    expect(result.fromCache).toBe(true);
    expect(result.error).toMatchObject({ code: "offline" });
  });

  it("remote error does not erase cache (ok false)", async () => {
    const listTasks = vi.fn().mockRejectedValue(new Error("boom"));
    const result = await syncOrganizationTasks({
      accountId: "acc",
      organizationId: "org",
      provider: provider(listTasks),
      repository: repo([task()]),
      trigger: "manual",
      isOnline: () => true,
    });
    expect(result.ok).toBe(false);
    expect(result.fromCache).toBe(true);
  });

  it("marks unavailable without deleting", async () => {
    const r = repo([task({ id: "keep", source: [{
      id: "s", taskId: "keep", type: "mail", accountId: "a", messageId: "m",
      threadId: "t", rfcMessageId: null, subjectSnapshot: "S", senderSnapshot: "x", createdAt: 1,
    }] })]);
    const marked = await markTaskRemoteAvailability(r, "keep", "unavailable");
    expect(marked?.syncState).toBe("unavailable");
    expect(marked?.source.length).toBe(1);
    expect(r.removeProjection).not.toHaveBeenCalled();
  });

  it("refreshOneRemoteTask maps missing to unavailable", async () => {
    const p = provider();
    vi.mocked(p.getTask).mockResolvedValue(null);
    const r = repo([task({ id: "local" })]);
    const result = await refreshOneRemoteTask({
      organizationId: "org",
      providerTaskId: "KEY",
      localTaskId: "local",
      provider: p,
      repository: r,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unavailable");
  });
});
