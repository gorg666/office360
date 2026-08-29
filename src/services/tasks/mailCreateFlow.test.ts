import { describe, expect, it, vi } from "vitest";
import type { Task } from "./domain";
import {
  createTrackerTaskFromMail,
  evaluateCreateTaskGate,
  newClientTaskId,
  snapshotMailSource,
} from "./mailCreateFlow";
import { TaskError } from "./yandexTracker/errors";
import type { TaskProvider } from "./taskProvider";
import type { TaskRepository } from "./taskRepository";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    provider: "yandex-tracker",
    providerTaskId: "1",
    externalKey: "TEST-1",
    organizationId: "org-1",
    title: "From mail",
    description: null,
    status: "open",
    priority: "normal",
    assignee: null,
    createdBy: null,
    followers: [],
    dueAt: null,
    createdAt: 100,
    updatedAt: 100,
    providerUpdatedAt: null,
    syncState: "fresh",
    providerStatus: null,
    providerPriority: null,
    source: [],
    ...overrides,
  };
}

function makeRepo(overrides: Partial<TaskRepository> = {}): TaskRepository {
  return {
    get: vi.fn().mockResolvedValue(makeTask()),
    list: vi.fn().mockResolvedValue([]),
    upsertProjection: vi.fn(),
    updateLocalProjection: vi.fn(),
    removeProjection: vi.fn(),
    listByAssignee: vi.fn().mockResolvedValue([]),
    listCreatedBy: vi.fn().mockResolvedValue([]),
    listBySource: vi.fn().mockResolvedValue([]),
    addSource: vi.fn(),
    ...overrides,
  } as TaskRepository;
}

function makeProvider(overrides: Partial<TaskProvider> = {}): TaskProvider {
  return {
    id: "yandex-tracker",
    capabilities: vi.fn().mockResolvedValue({
      read: true,
      create: true,
      assign: true,
      dueDate: true,
      priority: true,
      followers: false,
      transitions: true,
      comments: false,
      attachments: false,
      organizationDirectoryBinding: true,
    }),
    listTasks: vi.fn(),
    getTask: vi.fn(),
    createTask: vi.fn().mockResolvedValue(makeTask()),
    updateTask: vi.fn(),
    transitionTask: vi.fn(),
    resolveAssignee: vi.fn(),
    listQueues: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as TaskProvider;
}

describe("mailCreateFlow gate", () => {
  it("blocks offline", async () => {
    const gate = await evaluateCreateTaskGate({
      accountId: "acc",
      online: () => false,
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.code).toBe("offline");
  });

  it("blocks missing org", async () => {
    const gate = await evaluateCreateTaskGate({
      accountId: "acc",
      online: () => true,
      getOrgId: async () => null,
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.code).toBe("org-missing");
  });

  it("blocks missing default queue", async () => {
    const gate = await evaluateCreateTaskGate({
      accountId: "acc",
      online: () => true,
      getOrgId: async () => "org-1",
      getSettings: async () => ({
        organizationId: "org-1",
        provider: "yandex-tracker",
        providerOrganizationId: "org-1",
        enabled: true,
        defaultQueue: "",
        updatedAt: 1,
      }),
      provider: makeProvider(),
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.code).toBe("queue-missing");
      expect(gate.messageRu).toContain("очередь");
    }
  });

  it("blocks read-only tracker", async () => {
    const gate = await evaluateCreateTaskGate({
      accountId: "acc",
      online: () => true,
      getOrgId: async () => "org-1",
      getSettings: async () => ({
        organizationId: "org-1",
        provider: "yandex-tracker",
        providerOrganizationId: "org-1",
        enabled: true,
        defaultQueue: "TEST",
        updatedAt: 1,
      }),
      provider: makeProvider({
        capabilities: vi.fn().mockResolvedValue({
          read: true,
          create: false,
          assign: false,
          dueDate: true,
          priority: true,
          followers: false,
          transitions: false,
          comments: false,
          attachments: false,
          organizationDirectoryBinding: true,
        }),
      }),
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.code).toBe("read-only");
  });

  it("allows create when configured", async () => {
    const gate = await evaluateCreateTaskGate({
      accountId: "acc",
      online: () => true,
      getOrgId: async () => "org-1",
      getSettings: async () => ({
        organizationId: "org-1",
        provider: "yandex-tracker",
        providerOrganizationId: "org-1",
        enabled: true,
        defaultQueue: "TEST",
        updatedAt: 1,
      }),
      provider: makeProvider(),
    });
    expect(gate.ok).toBe(true);
  });
});

describe("mailCreateFlow create + source", () => {
  const source = {
    accountId: "acc-1",
    messageId: "msg-1",
    threadId: "thr-1",
    rfcMessageId: "<rfc@example.com>",
    subject: "Subject line",
    sender: "Alice <a@example.com>",
  };

  it("creates TaskSource with mail snapshots", async () => {
    const addSource = vi.fn();
    const createTask = vi.fn().mockResolvedValue(makeTask({ id: "created-1" }));
    const repo = makeRepo({
      addSource,
      get: vi.fn().mockResolvedValue(makeTask({ id: "created-1" })),
    });
    const provider = makeProvider({ createTask });

    await createTrackerTaskFromMail({
      repository: repo,
      provider,
      payload: {
        accountId: "acc-1",
        organizationId: "org-1",
        clientTaskId: "client-aaa",
        source,
        title: "Subject line",
        description: "Задача создана из письма",
        assignee: {
          email: "bob@example.com",
          displayName: "Bob",
          providerUid: "42",
        },
        priority: "high",
        dueAt: 1_700_000_000,
      },
      now: () => 1234,
    });

    expect(createTask).toHaveBeenCalledTimes(1);
    const unique = (createTask.mock.calls[0]![0] as { unique: string }).unique;
    expect(unique).toBe("office360:v1:org-1:mail:acc-1:msg-1:client-aaa");
    expect(addSource).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "created-1",
        type: "mail",
        accountId: "acc-1",
        messageId: "msg-1",
        threadId: "thr-1",
        rfcMessageId: "<rfc@example.com>",
        subjectSnapshot: "Subject line",
        senderSnapshot: "Alice <a@example.com>",
        createdAt: 1234,
      }),
    );
  });

  it("keeps same unique key on retry (idempotency)", async () => {
    const createTask = vi.fn()
      .mockRejectedValueOnce(new TaskError("unavailable", "temp"))
      .mockResolvedValueOnce(makeTask({ id: "created-2" }));
    const repo = makeRepo({
      get: vi.fn().mockResolvedValue(makeTask({ id: "created-2" })),
    });
    const provider = makeProvider({ createTask });
    const payload = {
      accountId: "acc-1",
      organizationId: "org-1",
      clientTaskId: "same-client",
      source,
      title: "T",
      assignee: {
        email: "bob@example.com",
        displayName: "Bob",
        providerUid: "42",
      },
    };

    await expect(createTrackerTaskFromMail({ repository: repo, provider, payload })).rejects.toBeInstanceOf(TaskError);
    await createTrackerTaskFromMail({ repository: repo, provider, payload });

    expect(createTask).toHaveBeenCalledTimes(2);
    const u1 = (createTask.mock.calls[0]![0] as { unique: string }).unique;
    const u2 = (createTask.mock.calls[1]![0] as { unique: string }).unique;
    expect(u1).toBe(u2);
    expect(u1).toContain(":same-client");
  });

  it("new clientTaskId yields second unique key (multiple tasks/mail)", async () => {
    const createTask = vi.fn().mockResolvedValue(makeTask());
    const repo = makeRepo();
    const provider = makeProvider({ createTask });
    const base = {
      accountId: "acc-1",
      organizationId: "org-1",
      source,
      title: "T",
      assignee: {
        email: "bob@example.com",
        displayName: "Bob",
        providerUid: "42",
      },
    };
    await createTrackerTaskFromMail({
      repository: repo,
      provider,
      payload: { ...base, clientTaskId: "c1" },
    });
    await createTrackerTaskFromMail({
      repository: repo,
      provider,
      payload: { ...base, clientTaskId: "c2" },
    });
    const keys = createTask.mock.calls.map((c) => (c[0] as { unique: string }).unique);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("rejects unresolved assignee before provider create", async () => {
    const createTask = vi.fn();
    await expect(
      createTrackerTaskFromMail({
        repository: makeRepo(),
        provider: makeProvider({ createTask }),
        payload: {
          accountId: "acc-1",
          organizationId: "org-1",
          clientTaskId: "x",
          source,
          title: "T",
          assignee: { email: "", displayName: undefined, providerUid: undefined },
        },
      }),
    ).rejects.toMatchObject({ code: "assignee-unresolved" });
    expect(createTask).not.toHaveBeenCalled();
  });
});

describe("snapshotMailSource / clientTaskId", () => {
  it("snapshots subject and sender without body", () => {
    const snap = snapshotMailSource({
      id: "m1",
      account_id: "a1",
      thread_id: "t1",
      message_id_header: "<id@x>",
      subject: "Hello",
      from_name: "Ann",
      from_address: "ann@ex.com",
      body_text: "SECRET BODY",
      body_html: "<p>SECRET</p>",
    } as never);
    expect(snap.subject).toBe("Hello");
    expect(snap.sender).toBe("Ann <ann@ex.com>");
    expect(JSON.stringify(snap)).not.toContain("SECRET");
  });

  it("generates unique client task ids", () => {
    expect(newClientTaskId()).not.toBe(newClientTaskId());
  });
});
