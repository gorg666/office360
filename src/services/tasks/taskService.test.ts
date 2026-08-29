import type { TaskRepository } from "./taskRepository";
import { TaskService } from "./taskService";

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

  it("does not pretend an unconfigured remote create succeeded", async () => {
    const service = new TaskService(repository());
    await expect(service.createRemoteTask("yandex-tracker")).rejects.toMatchObject({
      name: "TaskProviderUnavailableError",
    });
  });
});
