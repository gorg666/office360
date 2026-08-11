import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrackerPage, buildTrackerIssueFilter } from "./TrackerPage";

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
const invalidateTrackerSessionCache = vi.fn();

vi.mock("@/services/yandex/tracker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/yandex/tracker")>();
  return {
    ...actual,
    loadTrackerSessionMetadata: (...args: unknown[]) => loadTrackerSessionMetadata(...args),
    searchTrackerIssues: (...args: unknown[]) => searchTrackerIssues(...args),
    getTrackerCooldownRemainingMs: () => getTrackerCooldownRemainingMs(),
    invalidateTrackerSessionCache: (...args: unknown[]) => invalidateTrackerSessionCache(...args),
    getTrackerIssue: vi.fn(),
    listTrackerComments: vi.fn(async () => []),
    listTrackerTransitions: vi.fn(async () => []),
    listTrackerAttachments: vi.fn(async () => []),
    createTrackerIssue: vi.fn(),
    addTrackerComment: vi.fn(),
    executeTrackerTransition: vi.fn(),
    updateTrackerIssue: vi.fn(),
    uploadTrackerAttachment: vi.fn(),
  };
});

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: vi.fn() }));

describe("buildTrackerIssueFilter", () => {
  it("defaults to assignee me() without queue", () => {
    expect(buildTrackerIssueFilter({ queue: "", status: "", priority: "", assignee: "" })).toEqual({
      assignee: "me()",
    });
  });
});

describe("TrackerPage rate-limit / init regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it("StrictMode mount => one effective initialize metadata + one issues search", async () => {
    render(
      <StrictMode>
        <TrackerPage />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(loadTrackerSessionMetadata).toHaveBeenCalled();
      expect(searchTrackerIssues).toHaveBeenCalled();
    });

    // Session cache / single load path: one metadata load + one issues search (not doubled by StrictMode).
    expect(loadTrackerSessionMetadata).toHaveBeenCalledTimes(1);
    expect(searchTrackerIssues).toHaveBeenCalledTimes(1);
    expect(loadTrackerSessionMetadata.mock.calls[0]?.[0]).toBe("acc-1");
  });

  it("filter change => only issues search (no metadata reload)", async () => {
    render(<TrackerPage />);
    await waitFor(() => expect(searchTrackerIssues).toHaveBeenCalledTimes(1));

    const statusSelect = screen.getByDisplayValue("Все статусы");
    await act(async () => {
      fireEvent.change(statusSelect, { target: { value: "open" } });
      await new Promise((r) => setTimeout(r, 350));
    });

    await waitFor(() => expect(searchTrackerIssues).toHaveBeenCalledTimes(2));
    expect(loadTrackerSessionMetadata).toHaveBeenCalledTimes(1);
  });

  it("account change => new initialize", async () => {
    const { rerender } = render(<TrackerPage />);
    await waitFor(() => expect(loadTrackerSessionMetadata).toHaveBeenCalledTimes(1));

    accountState.activeAccountId = "acc-2";
    rerender(<TrackerPage />);

    await waitFor(() => expect(loadTrackerSessionMetadata).toHaveBeenCalledTimes(2));
    expect(loadTrackerSessionMetadata.mock.calls[1]?.[0]).toBe("acc-2");
  });

  it("manual refresh during cooldown is no-op for network", async () => {
    const { rerender } = render(<TrackerPage />);
    await waitFor(() => expect(searchTrackerIssues).toHaveBeenCalledTimes(1));

    getTrackerCooldownRemainingMs.mockReturnValue(15_000);
    rerender(<TrackerPage />);
    const refresh = screen.getByLabelText("Обновить Трекер");
    expect(refresh).toBeDisabled();

    fireEvent.click(refresh);
    expect(loadTrackerSessionMetadata).toHaveBeenCalledTimes(1);
    expect(invalidateTrackerSessionCache).not.toHaveBeenCalled();
  });

  it("manual refresh after cooldown force-reloads metadata", async () => {
    render(<TrackerPage />);
    await waitFor(() => expect(searchTrackerIssues).toHaveBeenCalledTimes(1));

    getTrackerCooldownRemainingMs.mockReturnValue(0);
    const refresh = screen.getByLabelText("Обновить Трекер");
    await act(async () => {
      fireEvent.click(refresh);
    });

    await waitFor(() => {
      expect(invalidateTrackerSessionCache).toHaveBeenCalledWith("acc-1");
      expect(loadTrackerSessionMetadata).toHaveBeenCalledTimes(2);
      expect(loadTrackerSessionMetadata.mock.calls[1]?.[1]).toEqual({ force: true });
    });
  });
});
