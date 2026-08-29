import type { Task, TaskSource } from "./domain";
import type { TaskRepository } from "./taskRepository";
import { TaskProviderUnavailableError } from "./taskProvider";

export class TaskService {
  constructor(private readonly repository: TaskRepository) {}

  get(id: string): Promise<Task | null> {
    return this.repository.get(id);
  }

  list(organizationId?: string | null): Promise<Task[]> {
    return this.repository.list(organizationId);
  }

  getTasksForMail(accountId: string, messageId: string): Promise<Task[]> {
    return this.repository.listBySource({ type: "mail", accountId, messageId });
  }

  linkSource(source: Omit<TaskSource, "createdAt"> & { createdAt?: number }): Promise<void> {
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
}
