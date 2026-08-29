import {
  getProjectedTask,
  insertTaskSource,
  listProjectedTasks,
  listProjectedTasksByPrincipal,
  listProjectedTasksForMail,
  listTaskSources,
  removeProjectedTask,
  updateLocalProjectedTask,
  upsertProjectedTask,
  type DbTaskSource,
} from "@/services/db/taskProjection";
import type { DbTask } from "@/services/db/tasks";
import type { Task, TaskSource, TaskSourceType, TaskStatus } from "./domain";
import { dbTaskToTask, taskToProjectionRow } from "./localTaskAdapter";

export interface TaskSourceLookup {
  type: TaskSourceType;
  accountId?: string;
  messageId?: string;
}

export interface TaskRepository {
  get(id: string): Promise<Task | null>;
  list(organizationId?: string | null): Promise<Task[]>;
  upsertProjection(task: Task): Promise<void>;
  updateLocalProjection(id: string, fields: {
    title?: string;
    description?: string | null;
    status?: TaskStatus;
    priority?: Task["priority"];
    dueAt?: number | null;
  }): Promise<void>;
  removeProjection(id: string): Promise<void>;
  listByAssignee(email: string): Promise<Task[]>;
  listCreatedBy(email: string): Promise<Task[]>;
  listBySource(source: TaskSourceLookup): Promise<Task[]>;
  addSource(source: Omit<TaskSource, "createdAt"> & { createdAt?: number }): Promise<void>;
}

function toSource(row: DbTaskSource): TaskSource {
  return {
    id: row.id,
    taskId: row.task_id,
    type: row.type,
    accountId: row.account_id,
    messageId: row.message_id,
    threadId: row.thread_id,
    rfcMessageId: row.rfc_message_id,
    subjectSnapshot: row.subject_snapshot,
    senderSnapshot: row.sender_snapshot,
    createdAt: row.created_at,
  };
}

async function hydrate(row: DbTask): Promise<Task> {
  const sources = await listTaskSources(row.id);
  return dbTaskToTask(row, sources.map(toSource));
}

export class SqliteTaskRepository implements TaskRepository {
  async get(id: string): Promise<Task | null> {
    const row = await getProjectedTask(id);
    return row ? hydrate(row) : null;
  }

  async list(organizationId?: string | null): Promise<Task[]> {
    return Promise.all((await listProjectedTasks(organizationId)).map(hydrate));
  }

  async upsertProjection(task: Task): Promise<void> {
    await upsertProjectedTask(taskToProjectionRow(task));
  }

  async updateLocalProjection(id: string, fields: Parameters<TaskRepository["updateLocalProjection"]>[1]): Promise<void> {
    const priority = fields.priority === undefined ? undefined : ({
      low: "low", normal: "medium", high: "high", critical: "urgent", unknown: "none",
    } as const)[fields.priority];
    await updateLocalProjectedTask(id, {
      title: fields.title,
      description: fields.description,
      status: fields.status,
      priority,
      dueDate: fields.dueAt,
    });
  }

  async removeProjection(id: string): Promise<void> {
    await removeProjectedTask(id);
  }

  async listByAssignee(email: string): Promise<Task[]> {
    return Promise.all((await listProjectedTasksByPrincipal("assignee_json", email)).map(hydrate));
  }

  async listCreatedBy(email: string): Promise<Task[]> {
    return Promise.all((await listProjectedTasksByPrincipal("creator_json", email)).map(hydrate));
  }

  async listBySource(source: TaskSourceLookup): Promise<Task[]> {
    if (source.type !== "mail" || !source.accountId || !source.messageId) {
      throw new Error("Only canonical mail source lookup is supported in TASKS-002");
    }
    return Promise.all((await listProjectedTasksForMail(source.accountId, source.messageId)).map(hydrate));
  }

  async addSource(source: Omit<TaskSource, "createdAt"> & { createdAt?: number }): Promise<void> {
    await insertTaskSource({
      id: source.id,
      task_id: source.taskId,
      type: source.type,
      account_id: source.accountId,
      message_id: source.messageId,
      thread_id: source.threadId,
      rfc_message_id: source.rfcMessageId,
      subject_snapshot: source.subjectSnapshot,
      sender_snapshot: source.senderSnapshot,
      created_at: source.createdAt,
    });
  }
}
