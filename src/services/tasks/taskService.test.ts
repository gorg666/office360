import type { TaskRepository } from "./taskRepository";
import { TaskService } from "./taskService";
import { resetTaskSyncCoordinatorForTests } from "./taskSyncCoordinator";
import type { Task } from "./domain";
import type { TaskProvider } from "./taskProvider";

function repository(): TaskRepository {
  return {
    get: vi.fn(), list: vi.fn(), upsertProjection: vi.fn(), updateLocalProjection: vi.fn(),
    removeProjection: vi.fn(), listByAssignee: vi.fn(), listCreatedBy: vi.fn(),
    listBySource: vi.fn().mockResolvedValue([]), addSource: vi.fn(),
  };
}

describe("TaskService offline boundary", () => {
  it("reads mail-linked tasks from the local cache", async () => {
    const repo = repository();
    const service = new TaskService(repo);
    await service.getTasksForMail("a1", "m1");
    expect(repo.listBySource).toHaveBeenCalledWith({ type: "mail", accountId: "a1", messageId: "m1" });
  });

  it("lists sections from cache without provider", async () => {
    const repo = repository();
    vi.mocked(repo.list).mockResolvedValue([]);
    const service = new TaskService(repo);
    await service.listSection({
      organizationId: "org",
      section: "my",
      currentUser: { email: "a@b.c" },
    });
    expect(repo.list).toHaveBeenCalledWith("org");
  });

  it("does not pretend an unconfigured remote create succeeded", async () => {
    const service = new TaskService(repository());
    await expect(service.createRemoteTask("yandex-tracker")).rejects.toMatchObject({
      name: "TaskProviderUnavailableError",
    });
  });
});

describe("TaskService sync + transitions", () => {
  beforeEach(() => {
    resetTaskSyncCoordinatorForTests();
  });

  it("refreshFromProvider uses coordinator and leaves cache on failure", async () => {
    const repo = repository();
    const provider: TaskProvider = {
      id: "yandex-tracker",
      capabilities: vi.fn(),
      getTask: vi.fn(),
      listTasks: vi.fn().mockRejectedValue(new Error("net")),
      createTask: vi.fn(),
      updateTask: vi.fn(),
      transitionTask: vi.fn(),
      resolveAssignee: vi.fn(),
      listQueues: vi.fn(),
    };
    const service = new TaskService(repo, () => provider);
    const result = await service.refreshFromProvider({
      accountId: "a",
      organizationId: "org",
      trigger: "manual",
    });
    expect(result.ok).toBe(false);
    expect(repo.removeProjection).not.toHaveBeenCalled();
  });

  it("transitionTask delegates to provider", async () => {
    const repo = repository();
    const next = {
      id: "t1",
      provider: "yandex-tracker",
      status: "done",
    } as Task;
    const provider: TaskProvider = {
      id: "yandex-tracker",
      capabilities: vi.fn(),
      getTask: vi.fn(),
      listTasks: vi.fn(),
      createTask: vi.fn(),
      updateTask: vi.fn(),
      transitionTask: vi.fn().mockResolvedValue(next),
      listTransitions: vi.fn().mockResolvedValue([{ id: "close", display: "Закрыть" }]),
      resolveAssignee: vi.fn(),
      listQueues: vi.fn(),
    };
    const service = new TaskService(repo, () => provider);
    const transitions = await service.listTransitions({
      accountId: "a",
      organizationId: "org",
      providerTaskId: "KEY",
    });
    expect(transitions[0]?.id).toBe("close");
    const updated = await service.transitionTask({
      accountId: "a",
      organizationId: "org",
      providerTaskId: "KEY",
      transitionId: "close",
    });
    expect(updated.status).toBe("done");
    expect(provider.transitionTask).toHaveBeenCalled();
  });

  it("updateTaskFields preserves TaskSource when provider returns empty source", async () => {
    const prior = {
      id: "t1",
      provider: "yandex-tracker" as const,
      providerTaskId: "1",
      organizationId: "org",
      title: "T",
      description: null,
      status: "open" as const,
      providerStatus: null,
      priority: "normal" as const,
      providerPriority: null,
      assignee: { email: "a@x.com", displayName: "A" },
      createdBy: null,
      followers: [],
      dueAt: null,
      createdAt: 1,
      updatedAt: 1,
      providerUpdatedAt: null,
      syncState: "fresh" as const,
      source: [
        {
          id: "src",
          taskId: "t1",
          type: "mail" as const,
          accountId: "acc",
          messageId: "m1",
          threadId: null,
          rfcMessageId: null,
          subjectSnapshot: "S",
          senderSnapshot: null,
          createdAt: 1,
        },
      ],
      externalKey: "KEY-1",
    };
    const repo = {
      ...repository(),
      get: vi.fn().mockResolvedValue(prior),
      upsertProjection: vi.fn().mockResolvedValue(undefined),
    };
    const remote = {
      ...prior,
      assignee: { email: "b@x.com", displayName: "B", providerUid: "uid-b" },
      source: [],
    };
    const provider: TaskProvider = {
      id: "yandex-tracker",
      capabilities: vi.fn(),
      getTask: vi.fn(),
      listTasks: vi.fn(),
      createTask: vi.fn(),
      updateTask: vi.fn().mockResolvedValue(remote),
      transitionTask: vi.fn(),
      resolveAssignee: vi.fn(),
      listQueues: vi.fn(),
    };
    const service = new TaskService(repo as never, () => provider);
    const out = await service.updateTaskFields({
      accountId: "a",
      organizationId: "org",
      providerTaskId: "1",
      localTaskId: "t1",
      fields: {
        assignee: { email: "b@x.com", displayName: "B", providerUid: "uid-b", organizationId: "org" },
      },
    });
    expect(out.source).toHaveLength(1);
    expect(out.source[0]?.messageId).toBe("m1");
    expect(repo.upsertProjection).toHaveBeenCalled();
  });

  it("resolveMailAssignee rejects unresolved UID", async () => {
    const provider: TaskProvider = {
      id: "yandex-tracker",
      capabilities: vi.fn(),
      getTask: vi.fn(),
      listTasks: vi.fn(),
      createTask: vi.fn(),
      updateTask: vi.fn(),
      transitionTask: vi.fn(),
      resolveAssignee: vi.fn().mockResolvedValue({ email: "x@y.com", displayName: "X" }),
      listQueues: vi.fn(),
    };
    const service = new TaskService(repository(), () => provider);
    await expect(
      service.resolveMailAssignee("a", "org", { email: "x@y.com", displayName: "X" }),
    ).rejects.toMatchObject({ code: "assignee-unresolved" });
  });
});
