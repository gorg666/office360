import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Task } from "@/services/tasks/domain";
import { TaskDetailView } from "./TaskDetailView";

vi.mock("@/services/tasks/openTaskSourceMail", () => ({
  OPEN_SOURCE_MAIL_COPY: {
    missing: "Исходное письмо недоступно",
    "permission-denied": "Исходное письмо недоступно",
    "no-source": "Исходное письмо недоступно",
  },
  openTaskSourceMail: vi.fn().mockResolvedValue({ ok: false, reason: "missing" }),
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
});
