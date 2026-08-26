import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTrackerAccessMode,
  resetTrackerAccessMode,
  TRACKER_READ_ONLY_MESSAGE,
  TRACKER_WRITE_DISABLED_HINT,
} from "@/services/yandex/tracker";
import { TrackerPage } from "./TrackerPage";

const accountState = { activeAccountId: "acc-1" as string | null };

vi.mock("@/stores/accountStore", () => ({
  useAccountStore: (selector: (s: typeof accountState) => unknown) => selector(accountState),
}));

vi.mock("@/services/yandex/accountApi", () => ({
  authorizeYandexServices: vi.fn(),
  resolveYandexAccount: vi.fn(async () => ({ id: "acc-1" })),
  resolveYandexOrgForTracker: vi.fn(async () => ({ status: "ready", orgId: "8493916" })),
  setStoredYandexOrgId: vi.fn(),
}));

const loadTrackerSessionMetadata = vi.fn();
const searchTrackerIssues = vi.fn();
const getTrackerCooldownRemainingMs = vi.fn(() => 0);
const createTrackerIssue = vi.fn();
const updateTrackerIssue = vi.fn();
const addTrackerComment = vi.fn();
const uploadTrackerAttachment = vi.fn();
const getTrackerIssue = vi.fn();
const listTrackerComments = vi.fn(async () => []);
const listTrackerTransitions = vi.fn(async () => []);
const listTrackerAttachments = vi.fn(async () => []);

vi.mock("@/services/yandex/tracker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/yandex/tracker")>();
  return {
    ...actual,
    loadTrackerSessionMetadata: (...args: unknown[]) => loadTrackerSessionMetadata(...args),
    searchTrackerIssues: (...args: unknown[]) => searchTrackerIssues(...args),
    getTrackerCooldownRemainingMs: () => getTrackerCooldownRemainingMs(),
    createTrackerIssue: (...args: unknown[]) => createTrackerIssue(...args),
    updateTrackerIssue: (...args: unknown[]) => updateTrackerIssue(...args),
    addTrackerComment: (...args: unknown[]) => addTrackerComment(...args),
    uploadTrackerAttachment: (...args: unknown[]) => uploadTrackerAttachment(...args),
    getTrackerIssue: (...args: unknown[]) => getTrackerIssue(...args),
    listTrackerComments: (...args: unknown[]) => listTrackerComments(...args),
    listTrackerTransitions: (...args: unknown[]) => listTrackerTransitions(...args),
    listTrackerAttachments: (...args: unknown[]) => listTrackerAttachments(...args),
    executeTrackerTransition: vi.fn(),
  };
});

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: vi.fn() }));

function apiError(message: string, code: string, status = 403) {
  const err = new Error(message) as Error & { code: string; status: number };
  err.name = "YandexApiError";
  err.code = code;
  err.status = status;
  return err;
}

async function enterReadOnlyViaCreate(promptValue = "New task") {
  createTrackerIssue.mockRejectedValue(apiError(TRACKER_READ_ONLY_MESSAGE, "tracker_read_only"));
  vi.spyOn(window, "prompt").mockReturnValue(promptValue);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Создать задачу/i }));
  });
  await waitFor(() => {
    expect(screen.getByTestId("tracker-read-only-banner")).toBeInTheDocument();
  });
}

describe("TrackerPage read-only UX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTrackerAccessMode();
    accountState.activeAccountId = "acc-1";
    getTrackerCooldownRemainingMs.mockReturnValue(0);
    loadTrackerSessionMetadata.mockResolvedValue({
      myself: { login: "user" },
      queues: [{ key: "DEV", name: "Dev" }],
      statuses: [{ key: "open", display: "Open" }],
      priorities: [{ key: "normal", display: "Normal" }],
    });
    searchTrackerIssues.mockResolvedValue([
      { id: "1", key: "DEV-1", summary: "Task one", status: { display: "Open" } },
    ]);
    getTrackerIssue.mockResolvedValue({
      id: "1",
      key: "DEV-1",
      summary: "Task one",
      description: "Body",
      status: { display: "Open" },
      priority: { key: "normal", display: "Normal" },
    });
  });

  it("403 view-mode → banner, writes disabled, no Обновить доступ", async () => {
    render(<TrackerPage />);
    await waitFor(() => expect(searchTrackerIssues).toHaveBeenCalled());
    await enterReadOnlyViaCreate();

    expect(screen.getByTestId("tracker-read-only-banner")).toHaveTextContent(TRACKER_READ_ONLY_MESSAGE);
    expect(screen.getByRole("link", { name: "Подробнее" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Обновить доступ" })).not.toBeInTheDocument();

    const createBtn = screen.getByRole("button", { name: /Создать задачу/i });
    expect(createBtn).toBeDisabled();
    expect(createBtn).toHaveAttribute("title", TRACKER_WRITE_DISABLED_HINT);

    await act(async () => {
      fireEvent.click(screen.getByText("Task one"));
    });
    await waitFor(() => expect(getTrackerIssue).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: /Редактировать/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Добавить$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Добавить файл/i })).toBeDisabled();
    expect(updateTrackerIssue).not.toHaveBeenCalled();
    expect(addTrackerComment).not.toHaveBeenCalled();
    expect(uploadTrackerAttachment).not.toHaveBeenCalled();
  });

  it("keeps list/open reads enabled in read-only", async () => {
    render(<TrackerPage />);
    await waitFor(() => expect(searchTrackerIssues).toHaveBeenCalledTimes(1));
    await enterReadOnlyViaCreate();

    await act(async () => {
      fireEvent.click(screen.getByText("Task one"));
    });
    await waitFor(() => {
      expect(getTrackerIssue).toHaveBeenCalledWith("acc-1", "DEV-1");
      expect(listTrackerComments).toHaveBeenCalled();
      expect(listTrackerAttachments).toHaveBeenCalled();
    });
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("generic permission error is not read-only mode", async () => {
    createTrackerIssue.mockRejectedValue(
      apiError("Недостаточно прав для этого действия в Яндекс Трекере.", "tracker_permission_denied"),
    );
    vi.spyOn(window, "prompt").mockReturnValue("x");
    render(<TrackerPage />);
    await waitFor(() => expect(searchTrackerIssues).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Создать задачу/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Недостаточно прав для этого действия/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("tracker-read-only-banner")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Обновить доступ" })).not.toBeInTheDocument();
    expect(getTrackerAccessMode()).toBe("UNKNOWN");
  });

  it("manual refresh resets access mode for re-evaluation", async () => {
    render(<TrackerPage />);
    await waitFor(() => expect(searchTrackerIssues).toHaveBeenCalled());
    await enterReadOnlyViaCreate();
    expect(screen.getByTestId("tracker-read-only-banner")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Обновить Трекер"));
    });

    await waitFor(() => {
      expect(loadTrackerSessionMetadata).toHaveBeenCalledWith("acc-1", { force: true });
    });
    expect(getTrackerAccessMode()).toBe("UNKNOWN");
    expect(screen.queryByTestId("tracker-read-only-banner")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Создать задачу/i })).not.toBeDisabled();
  });
});
