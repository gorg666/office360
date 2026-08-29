import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Task } from "@/services/tasks/domain";
import { TaskDetailView } from "./TaskDetailView";

const capabilities = vi.fn();
const resolveMailAssignee = vi.fn();
const updateTaskFields = vi.fn();

vi.mock("@/services/tasks/openTaskSourceMail", () => ({
  OPEN_SOURCE_MAIL_COPY: {
    missing: "Исходное письмо недоступно",
    "permission-denied": "Исходное письмо недоступно",
    "no-source": "Исходное письмо недоступно",
  },
  openTaskSourceMail: vi.fn().mockResolvedValue({ ok: false, reason: "missing" }),
}));

vi.mock("@/services/tasks/taskService", () => ({
  TaskService: class {
    capabilities = (...a: unknown[]) => capabilities(...a);
    resolveMailAssignee = (...a: unknown[]) => resolveMailAssignee(...a);
    updateTaskFields = (...a: unknown[]) => updateTaskFields(...a);
    listTransitions = vi.fn().mockResolvedValue([]);
    refreshTask = vi.fn();
    transitionTask = vi.fn();
  },
}));

vi.mock("@/services/tasks/mailCreateFlow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/tasks/mailCreateFlow")>();
  return {
    ...actual,
    createDefaultTrackerProvider: vi.fn(),
  };
});

vi.mock("./OrganizationPeoplePicker", () => ({
  OrganizationPeoplePicker: ({
    onChange,
    disabled,
  }: {
    onChange: (p: {
      id: string;
      email: string;
      displayName: string;
      source: string;
      providerId?: string;
    } | null) => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      data-testid="pick-assignee"
      disabled={disabled}
      onClick={() =>
        onChange({
          id: "p1",
          email: "new@example.com",
          displayName: "New Assignee",
          source: "organization-directory",
          providerId: "uid-new",
        })
      }
    >
      pick
    </button>
  ),
}));

function sampleTask(overrides: Partial<Task> = {}): Task {
  const now = 1_700_000_000;
  return {
    id: "task-1",
    provider: "yandex-tracker",
    providerTaskId: "1",
    externalKey: "TEST-42",
    organizationId: "org",
    title: "Detail title",
    description: "Body text",
    status: "open",
    providerStatus: { displayLabel: "Открыт" },
    priority: "high",
    providerPriority: null,
    assignee: { email: "assignee@example.com", displayName: "Assignee" },
    createdBy: { email: "creator@example.com", displayName: "Creator" },
    followers: [{ email: "f@example.com", displayName: "Follower" }],
    dueAt: now + 86400,
    createdAt: now,
    updatedAt: now,
    providerUpdatedAt: now,
    syncState: "fresh",
    source: [
      {
        id: "src",
        taskId: "task-1",
        type: "mail",
        accountId: "acc",
        messageId: "msg",
        threadId: "thr",
        rfcMessageId: "<x@y>",
        subjectSnapshot: "Mail subject",
        senderSnapshot: "sender@example.com",
        createdAt: now,
      },
    ],
    ...overrides,
  };
}

describe("TaskDetailView", () => {
  beforeEach(() => {
    capabilities.mockReset();
    resolveMailAssignee.mockReset();
    updateTaskFields.mockReset();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    capabilities.mockResolvedValue({
      read: true,
      create: true,
      update: true,
      transitions: true,
      assign: true,
      priority: true,
      dueDate: true,
    });
  });

  it("renders fields and mail source block", async () => {
    render(<TaskDetailView task={sampleTask()} />);
    expect(screen.getByText("TEST-42")).toBeTruthy();
    expect(screen.getByText("Body text")).toBeTruthy();
    expect(screen.getByText("Assignee")).toBeTruthy();
    expect(screen.getByText("Creator")).toBeTruthy();
    expect(screen.getByText("Создано из письма")).toBeTruthy();
    expect(screen.getByText("Mail subject")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Открыть письмо" }));
    await waitFor(() => {
      expect(screen.getByText("Исходное письмо недоступно")).toBeTruthy();
    });
  });

  it("shows custom unknown status/priority labels", () => {
    render(
      <TaskDetailView
        task={sampleTask({
          status: "unknown",
          providerStatus: { displayLabel: "Кастом" },
          priority: "unknown",
          providerPriority: "blocker",
        })}
      />,
    );
    expect(screen.getByText("Кастом")).toBeTruthy();
    expect(screen.getByText("blocker")).toBeTruthy();
  });

  it("edits assignee via org picker and updates projection", async () => {
    const onTaskUpdated = vi.fn();
    const updated = sampleTask({
      assignee: { email: "new@example.com", displayName: "New Assignee", providerUid: "uid-new" },
    });
    resolveMailAssignee.mockResolvedValue({
      email: "new@example.com",
      displayName: "New Assignee",
      organizationId: "org",
      providerUid: "uid-new",
    });
    updateTaskFields.mockResolvedValue(updated);

    render(
      <TaskDetailView task={sampleTask()} accountId="acc" onTaskUpdated={onTaskUpdated} />,
    );

    await waitFor(() => expect(capabilities).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Сменить исполнителя" }));
    fireEvent.click(screen.getByTestId("pick-assignee"));
    fireEvent.click(screen.getByRole("button", { name: "Назначить" }));

    await waitFor(() => expect(updateTaskFields).toHaveBeenCalled());
    expect(resolveMailAssignee).toHaveBeenCalled();
    expect(updateTaskFields.mock.calls[0][0].fields.assignee.providerUid).toBe("uid-new");
    expect(updateTaskFields.mock.calls[0][0].localTaskId).toBe("task-1");
    await waitFor(() => expect(onTaskUpdated).toHaveBeenCalledWith(updated));
    expect(screen.getByText("New Assignee")).toBeTruthy();
  });

  it("disables assignee edit when read-only", async () => {
    capabilities.mockResolvedValue({
      read: true,
      create: false,
      update: false,
      transitions: false,
      assign: false,
    });
    render(<TaskDetailView task={sampleTask()} accountId="acc" />);
    await waitFor(() => expect(capabilities).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Сменить исполнителя" })).toBeDisabled();
  });

  it("disables assignee edit when offline", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    render(<TaskDetailView task={sampleTask()} accountId="acc" />);
    await waitFor(() => expect(capabilities).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Сменить исполнителя" })).toBeDisabled();
  });

  it("shows unresolved assignee error", async () => {
    const { TaskError } = await import("@/services/tasks/yandexTracker/errors");
    resolveMailAssignee.mockRejectedValue(
      new TaskError("assignee-unresolved", "no uid"),
    );
    render(<TaskDetailView task={sampleTask()} accountId="acc" />);
    await waitFor(() => expect(capabilities).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Сменить исполнителя" }));
    fireEvent.click(screen.getByTestId("pick-assignee"));
    fireEvent.click(screen.getByRole("button", { name: "Назначить" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/исполнител/i),
    );
    expect(updateTaskFields).not.toHaveBeenCalled();
  });
});
