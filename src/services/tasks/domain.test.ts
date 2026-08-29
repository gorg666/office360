import { personIdentityFromEmail } from "@/services/people/domain";
import type { DbTask } from "@/services/db/tasks";
import { dbTaskToTask, taskToProjectionRow } from "./localTaskAdapter";
import type { Task } from "./domain";

function legacyTask(overrides: Partial<DbTask> = {}): DbTask {
  return {
    id: "local-1", account_id: "a1", title: "Legacy", description: null,
    priority: "urgent", is_completed: 0, completed_at: null, due_date: null,
    parent_id: null, thread_id: null, thread_account_id: null, sort_order: 0,
    recurrence_rule: null, next_recurrence_at: null, tags_json: "[]",
    start_at: null, end_at: null, timezone: null, all_day: 0, location: null,
    participants_json: "[]", optional_participants_json: "[]", attachments_json: "[]",
    reminder_minutes: null, reminder_channel: null, color_label: null, telemost_url: null,
    telemost_conference_id: null, telemost_live_url: null, created_at: 10, updated_at: 20,
    ...overrides,
  };
}

describe("provider-neutral task domain", () => {
  it("maps legacy local tasks with safe defaults", () => {
    const task = dbTaskToTask(legacyTask());
    expect(task).toEqual(expect.objectContaining({
      provider: "local",
      providerTaskId: null,
      status: "open",
      priority: "critical",
      syncState: "fresh",
      followers: [],
      dueAt: null,
    }));
  });

  it("preserves unknown provider status, priority, principals, followers, and organization", () => {
    const person = personIdentityFromEmail("owner@example.com", {
      id: "directory:42",
      providerId: "42",
      displayName: "Owner",
      organization: "Org",
      source: "organization-directory",
    });
    const principal = {
      person,
      email: person.email,
      displayName: person.displayName,
      providerUid: "tracker-42",
      organizationId: "org-1",
    };
    const task: Task = {
      id: "remote-1", provider: "yandex-tracker", providerTaskId: "QUEUE-1",
      externalKey: "client-key", organizationId: "org-1", title: "Remote",
      description: "Description", status: "unknown",
      providerStatus: { id: "17", key: "custom", displayLabel: "Custom" },
      priority: "unknown", providerPriority: "moonshot", assignee: principal,
      createdBy: principal, followers: [principal], dueAt: null, createdAt: 10,
      updatedAt: 20, providerUpdatedAt: 19, syncState: "stale", source: [],
    };

    const roundTrip = dbTaskToTask(taskToProjectionRow(task));
    expect(roundTrip).toEqual(task);
  });

  it("falls back safely when cached provider metadata is malformed", () => {
    const task = dbTaskToTask(legacyTask({
      provider: "yandex-tracker",
      status: "brand-new-status",
      priority: "none",
      provider_status: "not-json",
      followers_json: "not-json",
      sync_state: "surprise",
    }));
    expect(task.status).toBe("unknown");
    expect(task.priority).toBe("unknown");
    expect(task.providerStatus).toEqual({ key: "not-json", displayLabel: "not-json" });
    expect(task.followers).toEqual([]);
    expect(task.syncState).toBe("fresh");
  });
});
