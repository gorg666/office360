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
});
