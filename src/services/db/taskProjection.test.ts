import {
  insertTaskSource,
  listProjectedTasksForMail,
  upsertOrganizationTaskSettings,
  upsertProjectedTask,
} from "./taskProjection";
import { getDb } from "./connection";
import type { DbTask } from "./tasks";

vi.mock("./connection", () => ({ getDb: vi.fn() }));

const mockDb = { select: vi.fn(), execute: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockResolvedValue(mockDb as never);
});

describe("task projection DB boundary", () => {
  it("rejects a remote projection without provider identity", async () => {
    await expect(upsertProjectedTask({ provider: "yandex-tracker" } as DbTask)).rejects.toThrow(
      "providerTaskId",
    );
  });

  it("upserts by provider task identity", async () => {
    const row = {
      id: "r1", account_id: null, title: "Remote", description: null, priority: "high",
      is_completed: 0, completed_at: null, due_date: null, provider: "yandex-tracker",
      provider_task_id: "Q-1", external_key: null, organization_id: "org", status: "open",
      provider_status: null, provider_priority: "major", assignee_json: null,
      creator_json: null, followers_json: "[]", provider_updated_at: 1, sync_state: "fresh",
      created_at: 1, updated_at: 1,
    } as DbTask;
    await upsertProjectedTask(row);
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT(provider, provider_task_id)"),
      expect.arrayContaining(["yandex-tracker", "Q-1"]),
    );
  });

  it("requires the canonical mail identity but stores fallback metadata", async () => {
    await expect(insertTaskSource({
      id: "s", task_id: "t", type: "mail", account_id: null, message_id: "m",
      thread_id: null, rfc_message_id: null, subject_snapshot: null, sender_snapshot: null,
    })).rejects.toThrow("accountId and messageId");
    await insertTaskSource({
      id: "s", task_id: "t", type: "mail", account_id: "a", message_id: "m",
      thread_id: "thread", rfc_message_id: "<rfc>", subject_snapshot: null, sender_snapshot: null,
    });
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO task_sources"),
      expect.arrayContaining(["a", "m", "thread", "<rfc>"]),
    );
  });

  it("looks up every task linked to the same mail", async () => {
    mockDb.select.mockResolvedValue([]);
    await listProjectedTasksForMail("a", "m");
    expect(mockDb.select).toHaveBeenCalledWith(
      expect.stringContaining("JOIN task_sources"),
      ["a", "m"],
    );
  });

  it("upserts one organization/provider settings row without secrets", async () => {
    await upsertOrganizationTaskSettings({
      organization_id: "org", provider: "yandex-tracker", enabled: 1,
      provider_organization_id: "remote-org", default_queue: "TEAM", updated_at: 1,
    });
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT(organization_id, provider)"),
      ["org", "yandex-tracker", 1, "remote-org", "TEAM", 1],
    );
  });
});
