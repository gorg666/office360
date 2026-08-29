import type { DbTask } from "@/services/db/tasks";
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
} from "@/services/db/taskProjection";
import { SqliteTaskRepository } from "./taskRepository";
import type { Task } from "./domain";

vi.mock("@/services/db/taskProjection", () => ({
  getProjectedTask: vi.fn(),
  insertTaskSource: vi.fn(),
  listProjectedTasks: vi.fn(),
  listProjectedTasksByPrincipal: vi.fn(),
  listProjectedTasksForMail: vi.fn(),
  listTaskSources: vi.fn(),
  removeProjectedTask: vi.fn(),
  updateLocalProjectedTask: vi.fn(),
  upsertProjectedTask: vi.fn(),
}));

const row: DbTask = {
  id: "t1", account_id: null, title: "Task", description: null, priority: "medium",
  is_completed: 0, completed_at: null, due_date: null, parent_id: null, thread_id: null,
  thread_account_id: null, sort_order: 0, recurrence_rule: null, next_recurrence_at: null,
  tags_json: "[]", start_at: null, end_at: null, timezone: null, all_day: 0,
  location: null, participants_json: "[]", optional_participants_json: "[]",
  attachments_json: "[]", reminder_minutes: null, reminder_channel: null,
  color_label: null, telemost_url: null, telemost_conference_id: null,
  telemost_live_url: null, provider: "local", status: "open", followers_json: "[]",
  sync_state: "fresh", created_at: 1, updated_at: 2,
};

const remoteTask: Task = {
  id: "remote", provider: "yandex-tracker", providerTaskId: "Q-1", externalKey: "key",
  organizationId: "org", title: "Remote", description: null, status: "in_progress",
  providerStatus: { key: "inProgress", displayLabel: "In progress" }, priority: "high",
  providerPriority: "major", assignee: null, createdBy: null, followers: [], dueAt: null,
  createdAt: 1, updatedAt: 2, providerUpdatedAt: 2, syncState: "fresh", source: [],
};

describe("SqliteTaskRepository", () => {
  const repository = new SqliteTaskRepository();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listTaskSources).mockResolvedValue([]);
  });

  it("gets and lists hydrated tasks", async () => {
    vi.mocked(getProjectedTask).mockResolvedValue(row);
    vi.mocked(listProjectedTasks).mockResolvedValue([row]);
    expect((await repository.get("t1"))?.provider).toBe("local");
    expect(await repository.list()).toHaveLength(1);
  });

  it("upserts a remote projection without exposing provider JSON", async () => {
    await repository.upsertProjection(remoteTask);
    expect(upsertProjectedTask).toHaveBeenCalledWith(expect.objectContaining({
      provider: "yandex-tracker",
      provider_task_id: "Q-1",
      status: "in_progress",
    }));
  });

  it("updates only local projections with compatible legacy priority", async () => {
    await repository.updateLocalProjection("t1", { status: "done", priority: "critical" });
    expect(updateLocalProjectedTask).toHaveBeenCalledWith("t1", expect.objectContaining({
      status: "done",
      priority: "urgent",
    }));
  });

  it("lists assignee and creator projections", async () => {
    vi.mocked(listProjectedTasksByPrincipal).mockResolvedValue([row]);
    await repository.listByAssignee("person@example.com");
    await repository.listCreatedBy("person@example.com");
    expect(listProjectedTasksByPrincipal).toHaveBeenNthCalledWith(1, "assignee_json", "person@example.com");
    expect(listProjectedTasksByPrincipal).toHaveBeenNthCalledWith(2, "creator_json", "person@example.com");
  });

  it("uses accountId plus messageId as the canonical mail lookup", async () => {
    vi.mocked(listProjectedTasksForMail).mockResolvedValue([row]);
    const tasks = await repository.listBySource({ type: "mail", accountId: "a1", messageId: "m1" });
    expect(tasks).toHaveLength(1);
    expect(listProjectedTasksForMail).toHaveBeenCalledWith("a1", "m1");
  });

  it("preserves mail fallback metadata when adding a source", async () => {
    await repository.addSource({
      id: "s1", taskId: "t1", type: "mail", accountId: "a1", messageId: "m1",
      threadId: "thread", rfcMessageId: "<rfc@example.com>", subjectSnapshot: "Subject",
      senderSnapshot: "Sender <sender@example.com>",
    });
    expect(insertTaskSource).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: "thread",
      rfc_message_id: "<rfc@example.com>",
    }));
  });

  it("removes a projection through the shared tasks table", async () => {
    await repository.removeProjection("t1");
    expect(removeProjectedTask).toHaveBeenCalledWith("t1");
  });
});
