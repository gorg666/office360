import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateTrackerTaskFromMailModal } from "./CreateTrackerTaskFromMailModal";

const evaluateCreateTaskGate = vi.fn();
const createTrackerTaskFromMail = vi.fn();
const createDefaultTrackerProvider = vi.fn();

vi.mock("@/services/tasks/mailCreateFlow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/tasks/mailCreateFlow")>();
  return {
    ...actual,
    evaluateCreateTaskGate: (...args: unknown[]) => evaluateCreateTaskGate(...args),
    createTrackerTaskFromMail: (...args: unknown[]) => createTrackerTaskFromMail(...args),
    createDefaultTrackerProvider: (...args: unknown[]) => createDefaultTrackerProvider(...args),
  };
});

vi.mock("./OrganizationPeoplePicker", () => ({
  OrganizationPeoplePicker: ({
    onChange,
  }: {
    onChange: (p: {
      id: string;
      email: string;
      displayName: string;
      source: string;
      jobTitle?: string;
    } | null) => void;
  }) => (
    <button
      type="button"
      data-testid="pick-assignee"
      onClick={() =>
        onChange({
          id: "dir:org:1",
          email: "bob@org.com",
          displayName: "Bob Builder",
          source: "organization-directory",
          jobTitle: "Engineer",
        })
      }
    >
      Pick
    </button>
  ),
  PeoplePicker: () => null,
}));

vi.mock("@/services/tasks/taskRepository", () => ({
  SqliteTaskRepository: class {
    get = vi.fn();
    addSource = vi.fn();
  },
}));

const source = {
  accountId: "acc-1",
  messageId: "msg-1",
  threadId: "thr-1",
  rfcMessageId: "<rfc@x>",
  subject: "Mail subject",
  sender: "Alice <alice@ex.com>",
};

describe("CreateTrackerTaskFromMailModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    evaluateCreateTaskGate.mockResolvedValue({
      ok: true,
      organizationId: "org-1",
      providerOrganizationId: "org-1",
      defaultQueue: "TEST",
      capabilities: { create: true, read: true },
    });
    createDefaultTrackerProvider.mockReturnValue({
      resolveAssignee: vi.fn().mockResolvedValue({
        email: "bob@org.com",
        displayName: "Bob Builder",
        providerUid: "99",
      }),
    });
    createTrackerTaskFromMail.mockResolvedValue({
      id: "task-1",
      title: "Mail subject",
      status: "open",
      priority: "normal",
      dueAt: null,
      assignee: null,
      externalKey: "TEST-1",
    });
  });

  it("prefills title and shows source preview", async () => {
    render(
      <CreateTrackerTaskFromMailModal
        isOpen
        onClose={vi.fn()}
        accountId="acc-1"
        source={source}
        onCreated={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("Название")).toHaveValue("Mail subject"));
    expect(screen.getByText(/Источник: письмо/)).toBeInTheDocument();
    expect(screen.getByText(/Alice <alice@ex.com>/)).toBeInTheDocument();
    expect((screen.getByLabelText("Описание") as HTMLTextAreaElement).value).toContain(
      "Задача создана из письма",
    );
  });

  it("shows gate error and disables submit when queue missing", async () => {
    evaluateCreateTaskGate.mockResolvedValue({
      ok: false,
      code: "queue-missing",
      messageRu: "Для задач не настроена очередь Tracker",
    });
    render(
      <CreateTrackerTaskFromMailModal
        isOpen
        onClose={vi.fn()}
        accountId="acc-1"
        source={source}
        onCreated={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("очередь Tracker"),
    );
    expect(screen.getByRole("button", { name: "Создать" })).toBeDisabled();
  });

  it("submits once with loading and success callback", async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    createTrackerTaskFromMail.mockResolvedValue({
      id: "task-1",
      title: "Mail subject",
      status: "open",
      priority: "normal",
      dueAt: null,
      assignee: null,
    });

    render(
      <CreateTrackerTaskFromMailModal
        isOpen
        onClose={onClose}
        accountId="acc-1"
        source={source}
        onCreated={onCreated}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("pick-assignee")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("pick-assignee"));
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(createTrackerTaskFromMail).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows typed assignee unresolved error", async () => {
    createDefaultTrackerProvider.mockReturnValue({
      resolveAssignee: vi.fn().mockResolvedValue(null),
    });
    render(
      <CreateTrackerTaskFromMailModal
        isOpen
        onClose={vi.fn()}
        accountId="acc-1"
        source={source}
        onCreated={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("pick-assignee")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("pick-assignee"));
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/исполнителя/),
    );
    expect(createTrackerTaskFromMail).not.toHaveBeenCalled();
  });
});
