import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskRepository } from "../taskRepository";
import type { OrganizationTaskSettings, Task } from "../domain";
import { TaskError } from "./errors";
import { YandexTrackerTaskProvider } from "./provider";
import { buildMailTaskUniqueKey, buildTaskUniqueKey } from "./unique";
import { mapTrackerIssueToTask } from "./issueMapping";
import { mapTrackerPriority, mapTrackerStatus } from "./mapping";
import { resolveAssigneeStrict } from "./assigneeResolution";
import type { DirectoryMembershipPort, TrackerUserPort } from "./assigneeResolution";
import { YandexApiError, type TrackerIssue, type TrackerUser } from "@/services/yandex/trackerClient";

vi.mock("@/services/yandex/trackerClient", async () => {
  const actual = await vi.importActual<typeof import("@/services/yandex/trackerClient")>(
    "@/services/yandex/trackerClient",
  );
  return {
    ...actual,
    getTrackerMyself: vi.fn(),
    listTrackerQueuesV3: vi.fn(),
    getTrackerQueueV3: vi.fn(),
    listTrackerPrioritiesV3: vi.fn(),
    searchTrackerIssuesV3: vi.fn(),
    getTrackerIssueV3: vi.fn(),
    createTrackerIssueV3: vi.fn(),
    updateTrackerIssueV3: vi.fn(),
    listTrackerTransitionsV3: vi.fn(),
    executeTrackerTransitionV3: vi.fn(),
  };
});

import {
  createTrackerIssueV3,
  executeTrackerTransitionV3,
  getTrackerIssueV3,
  getTrackerMyself,
  getTrackerQueueV3,
  listTrackerPrioritiesV3,
  listTrackerQueuesV3,
  listTrackerTransitionsV3,
  searchTrackerIssuesV3,
  updateTrackerIssueV3,
} from "@/services/yandex/trackerClient";

const ORG = "org-1";
const SETTINGS: OrganizationTaskSettings = {
  organizationId: ORG,
  provider: "yandex-tracker",
  enabled: true,
  providerOrganizationId: "12345",
  defaultQueue: "TEST",
  updatedAt: 1,
};

function repo(store: Map<string, Task> = new Map()): TaskRepository {
  return {
    get: vi.fn(async (id) => store.get(id) ?? null),
    list: vi.fn(async () => [...store.values()]),
    upsertProjection: vi.fn(async (task) => { store.set(task.id, task); }),
    updateLocalProjection: vi.fn(),
    removeProjection: vi.fn(),
    listByAssignee: vi.fn(),
    listCreatedBy: vi.fn(),
    listBySource: vi.fn(),
    addSource: vi.fn(),
  };
}

function directory(): DirectoryMembershipPort {
  return {
    getMember: vi.fn(async (_org, userId) => {
      if (userId === "u-1") {
        return { id: "u-1", email: "alice@example.com", nickname: "alice", isEnabled: true };
      }
      return null;
    }),
    findMemberByEmail: vi.fn(async (_org, email) => {
      if (email.toLowerCase() === "alice@example.com") {
        return [{ id: "u-1", email: "alice@example.com", nickname: "alice", isEnabled: true }];
      }
      return [];
    }),
  };
}

function trackerUsers(users: TrackerUser[] = [{
  uid: 777,
  passportUid: "u-1",
  login: "alice",
  email: "alice@example.com",
  display: "Alice",
  dismissed: false,
}]): TrackerUserPort {
  return {
    getUser: vi.fn(async (_ctx, key) => {
      const found = users.find(
        (user) => String(user.uid) === key
          || user.login === key
          || user.email === key
          || String(user.passportUid) === key,
      );
      if (!found) throw new YandexApiError(404, "not found");
      return found;
    }),
    listUsers: vi.fn(async () => users),
  };
}

function provider(overrides: {
  scopes?: Set<string>;
  online?: boolean;
  settings?: OrganizationTaskSettings | null;
  directory?: DirectoryMembershipPort;
  trackerUsers?: TrackerUserPort;
  repository?: TaskRepository;
} = {}) {
  return new YandexTrackerTaskProvider({
    accountId: "acc-1",
    repository: overrides.repository ?? repo(),
    directory: overrides.directory ?? directory(),
    trackerUsers: overrides.trackerUsers ?? trackerUsers(),
    isOnline: () => overrides.online ?? true,
    getServiceScopes: async () => overrides.scopes ?? new Set(["tracker:read", "tracker:write"]),
    getSettings: async () => overrides.settings === undefined ? SETTINGS : overrides.settings,
  });
}

const issue = (partial: Partial<TrackerIssue> = {}): TrackerIssue => ({
  id: "issue-1",
  key: "TEST-1",
  summary: "Hello",
  description: "Body",
  status: { key: "open", display: "Open" },
  priority: { key: "normal", display: "Normal" },
  assignee: { uid: 777, email: "alice@example.com", display: "Alice", login: "alice" },
  createdBy: { uid: 1, email: "bob@example.com", display: "Bob", login: "bob" },
  followers: [],
  queue: { key: "TEST" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  ...partial,
});

beforeEach(() => {
  vi.mocked(getTrackerMyself).mockResolvedValue({ uid: 1, login: "me", email: "me@example.com", hasLicense: true });
  vi.mocked(listTrackerQueuesV3).mockResolvedValue([{ id: "1", key: "TEST", name: "Test" }]);
  vi.mocked(getTrackerQueueV3).mockResolvedValue({ id: "1", key: "TEST", name: "Test" });
  vi.mocked(listTrackerPrioritiesV3).mockResolvedValue([{ key: "normal", display: "Normal" }]);
  vi.mocked(searchTrackerIssuesV3).mockResolvedValue([issue()]);
  vi.mocked(getTrackerIssueV3).mockResolvedValue(issue());
  vi.mocked(createTrackerIssueV3).mockResolvedValue(issue());
  vi.mocked(updateTrackerIssueV3).mockResolvedValue(issue({ summary: "Updated" }));
  vi.mocked(listTrackerTransitionsV3).mockResolvedValue([{ id: "close", display: "Close", to: { key: "closed" } }]);
  vi.mocked(executeTrackerTransitionV3).mockResolvedValue(issue({ status: { key: "closed" } }));
});

describe("unique keys", () => {
  it("builds office360 unique format including mail identity", () => {
    expect(buildTaskUniqueKey({ organizationId: ORG, sourceIdentity: "manual:x" }))
      .toBe("office360:v1:org-1:manual:x");
    expect(buildMailTaskUniqueKey({
      organizationId: ORG,
      accountId: "a",
      messageId: "m",
      clientTaskId: "c",
    })).toBe("office360:v1:org-1:mail:a:m:c");
  });
});

describe("mapping", () => {
  it("maps known priorities and keeps custom as unknown+raw", () => {
    expect(mapTrackerPriority({ key: "critical" }).priority).toBe("critical");
    expect(mapTrackerPriority({ key: "custom-p0" })).toEqual({
      priority: "unknown",
      providerPriority: "custom-p0",
    });
  });

  it("keeps raw status and normalizes only reliable keys", () => {
    expect(mapTrackerStatus({ key: "closed", display: "Closed" })).toMatchObject({
      status: "done",
      providerStatus: { key: "closed", displayLabel: "Closed" },
    });
    expect(mapTrackerStatus({ key: "weird-custom" }).status).toBe("unknown");
  });

  it("maps issue into provider-neutral Task", () => {
    const task = mapTrackerIssueToTask({ issue: issue(), organizationId: ORG });
    expect(task.provider).toBe("yandex-tracker");
    expect(task.externalKey).toBe("TEST-1");
    expect(task.assignee?.providerUid).toBe("777");
    expect(task.providerStatus?.key).toBe("open");
  });
});

describe("organization / config", () => {
  it("sends configured org via resolve and rejects missing org", async () => {
    const p = provider();
    await p.listQueues(ORG);
    expect(getTrackerMyself).toHaveBeenCalledWith({ accountId: "acc-1", orgId: "12345" });

    const missing = provider({ settings: { ...SETTINGS, providerOrganizationId: null } });
    await expect(missing.listQueues(ORG)).rejects.toMatchObject({ code: "configuration-required" });
  });

  it("requires default queue for create", async () => {
    const p = provider({ settings: { ...SETTINGS, defaultQueue: null } });
    await expect(p.createTask({ organizationId: ORG, fields: { title: "X" } as Task }))
      .rejects.toMatchObject({ code: "configuration-required" });
  });

  it("read-only scopes disable mutations but allow read capability", async () => {
    const p = provider({ scopes: new Set(["tracker:read"]) });
    const caps = await p.capabilities(ORG);
    expect(caps.read).toBe(true);
    expect(caps.create).toBe(false);
    await expect(p.createTask({ organizationId: ORG, fields: { title: "X" } as Task }))
      .rejects.toMatchObject({ code: "permission-denied" });
  });
});

describe("assignee resolution", () => {
  it("resolves verified org member to Tracker UID", async () => {
    const resolved = await resolveAssigneeStrict({
      organizationId: ORG,
      providerOrganizationId: "12345",
      principal: {
        email: "alice@example.com",
        organizationId: ORG,
        person: {
          id: "p1",
          email: "alice@example.com",
          normalizedEmail: "alice@example.com",
          providerId: "u-1",
          source: "organization-directory",
          sources: ["organization-directory"],
        },
      },
      ctx: { accountId: "acc-1", orgId: "12345" },
      directory: directory(),
      trackerUsers: trackerUsers(),
    });
    expect(resolved.providerUid).toBe("777");
  });

  it("rejects email-only unresolved principal", async () => {
    await expect(resolveAssigneeStrict({
      organizationId: ORG,
      providerOrganizationId: "12345",
      principal: { email: "stranger@elsewhere.com" },
      ctx: { accountId: "acc-1", orgId: "12345" },
      directory: directory(),
      trackerUsers: trackerUsers(),
    })).rejects.toMatchObject({ code: "assignee-unresolved" });
  });

  it("rejects wrong organization on principal", async () => {
    await expect(resolveAssigneeStrict({
      organizationId: ORG,
      providerOrganizationId: "12345",
      principal: { email: "alice@example.com", organizationId: "other" },
      ctx: { accountId: "acc-1", orgId: "12345" },
      directory: directory(),
      trackerUsers: trackerUsers(),
    })).rejects.toMatchObject({ code: "organization-mismatch" });
  });

  it("rejects ambiguous Tracker matches", async () => {
    await expect(resolveAssigneeStrict({
      organizationId: ORG,
      providerOrganizationId: "12345",
      principal: {
        email: "alice@example.com",
        person: {
          id: "p1",
          email: "alice@example.com",
          normalizedEmail: "alice@example.com",
          providerId: "u-1",
          source: "organization-directory",
          sources: ["organization-directory"],
        },
      },
      ctx: { accountId: "acc-1", orgId: "12345" },
      directory: directory(),
      trackerUsers: {
        getUser: vi.fn(async () => { throw new YandexApiError(404, "x"); }),
        listUsers: vi.fn(async () => [
          { uid: 1, email: "alice@example.com", login: "alice", passportUid: "u-1" },
          { uid: 2, email: "alice@example.com", login: "alice2", passportUid: "u-1" },
        ]),
      },
    })).rejects.toMatchObject({ code: "assignee-unresolved" });
  });
});

describe("create / idempotency / projection", () => {
  it("creates with assignee and upserts projection from canonical response", async () => {
    const store = new Map<string, Task>();
    const p = provider({ repository: repo(store) });
    const task = await p.createTask({
      organizationId: ORG,
      unique: buildTaskUniqueKey({ organizationId: ORG, sourceIdentity: "manual:1" }),
      fields: {
        title: "Hello",
        description: "Body",
        assignee: {
          email: "alice@example.com",
          person: {
            id: "p1",
            email: "alice@example.com",
            normalizedEmail: "alice@example.com",
            providerId: "u-1",
            source: "organization-directory",
            sources: ["organization-directory"],
          },
        },
        priority: "high",
        dueAt: 1_800_000_000,
      } as Task,
    });
    expect(createTrackerIssueV3).toHaveBeenCalledWith(
      { accountId: "acc-1", orgId: "12345" },
      expect.objectContaining({
        summary: "Hello",
        queue: "TEST",
        assignee: "777",
        priority: "high",
        unique: "office360:v1:org-1:manual:1",
      }),
    );
    expect(task.providerTaskId).toBe("issue-1");
    expect(store.get(task.id)?.externalKey).toBe("TEST-1");
  });

  it("reconciles 409 unique into successful replay", async () => {
    vi.mocked(createTrackerIssueV3).mockRejectedValueOnce(new YandexApiError(409, "conflict"));
    vi.mocked(searchTrackerIssuesV3).mockResolvedValueOnce([issue({ unique: "office360:v1:org-1:manual:1" })]);
    const p = provider();
    const task = await p.createTask({
      organizationId: ORG,
      unique: "office360:v1:org-1:manual:1",
      fields: { title: "Hello" } as Task,
    });
    expect(task.externalKey).toBe("TEST-1");
  });

  it("raises typed conflict on ambiguous 409", async () => {
    vi.mocked(createTrackerIssueV3).mockRejectedValueOnce(new YandexApiError(409, "conflict"));
    vi.mocked(searchTrackerIssuesV3).mockResolvedValueOnce([
      issue({ id: "1", key: "T-1", unique: "office360:v1:org-1:manual:1" }),
      issue({ id: "2", key: "T-2", unique: "office360:v1:org-1:manual:1" }),
    ]);
    const p = provider();
    await expect(p.createTask({
      organizationId: ORG,
      unique: "office360:v1:org-1:manual:1",
      fields: { title: "Hello" } as Task,
    })).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("read / update / transitions", () => {
  it("gets and lists with pagination args", async () => {
    const p = provider();
    await p.getTask(ORG, "TEST-1");
    await p.listTasks(ORG, { scope: "created-by-me", page: 2, perPage: 25 });
    expect(searchTrackerIssuesV3).toHaveBeenCalledWith(
      expect.anything(),
      { filter: { createdBy: "me()" } },
      25,
      2,
    );
  });

  it("updates title/assignee/priority/deadline", async () => {
    const p = provider();
    await p.updateTask({
      organizationId: ORG,
      providerTaskId: "TEST-1",
      fields: {
        title: "Updated",
        priority: "low",
        dueAt: 1_800_000_000,
        assignee: {
          email: "alice@example.com",
          person: {
            id: "p1",
            email: "alice@example.com",
            normalizedEmail: "alice@example.com",
            providerId: "u-1",
            source: "organization-directory",
            sources: ["organization-directory"],
          },
        },
      } as Task,
    });
    expect(updateTrackerIssueV3).toHaveBeenCalledWith(
      expect.anything(),
      "TEST-1",
      expect.objectContaining({ summary: "Updated", assignee: "777", priority: "low" }),
    );
  });

  it("lists and executes transitions then refreshes", async () => {
    const p = provider();
    const transitions = await p.listTransitions(ORG, "TEST-1");
    expect(transitions[0]?.id).toBe("close");
    await p.transitionTask({ organizationId: ORG, providerTaskId: "TEST-1", transitionId: "close" });
    expect(executeTrackerTransitionV3).toHaveBeenCalled();
    expect(getTrackerIssueV3).toHaveBeenCalled();
  });

  it("rejects unavailable transition", async () => {
    const p = provider();
    await expect(p.transitionTask({
      organizationId: ORG,
      providerTaskId: "TEST-1",
      transitionId: "missing",
    })).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("offline / errors", () => {
  it("returns typed offline for remote ops", async () => {
    const p = provider({ online: false });
    await expect(p.listQueues(ORG)).rejects.toMatchObject({ code: "offline" });
  });

  it("maps rate-limited errors", async () => {
    vi.mocked(listTrackerQueuesV3).mockRejectedValueOnce(new YandexApiError(429, "slow down"));
    const p = provider();
    await expect(p.listQueues(ORG)).rejects.toMatchObject({ code: "rate-limited" });
  });
});
