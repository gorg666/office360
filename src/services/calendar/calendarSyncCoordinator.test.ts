import { describe, expect, it, vi } from "vitest";
import { CalendarOfflineError } from "./calendarOfflinePolicy";
import { CalendarSyncCoordinator } from "./calendarSyncCoordinator";
import { googleCalendarAccess, serializeCalendarAccess } from "./domain";

const calendar = {
  id: "cal-1",
  account_id: "acc-1",
  provider: "google_api",
  remote_id: "remote-cal",
  display_name: "Calendar",
  color: null,
  is_primary: 1,
  is_visible: 1,
  sync_token: "cursor-1",
  ctag: null,
  access_json: serializeCalendarAccess(googleCalendarAccess("writer")),
  access_observed_at: 1,
  provider_presence: "present" as const,
  provider_seen_at: 1,
  created_at: 1,
  updated_at: 1,
};

function setup() {
  const provider = {
    accountId: "acc-1",
    type: "google_api" as const,
    capabilities: {} as never,
    listCalendars: vi.fn().mockResolvedValue([]),
    syncEvents: vi.fn().mockResolvedValue({
      created: [], updated: [], deletedRemoteIds: [],
      newSyncToken: "cursor-2", newCtag: null, complete: true,
      authoritativeSnapshot: false, strategy: "sync-token",
    }),
    fetchEvents: vi.fn().mockResolvedValue([]),
    lastReadDiagnostics: { unreadableComponentCount: 0, unreadableObjectCount: 0 },
  };
  const deps = {
    hasCalendarSupport: vi.fn().mockResolvedValue(true),
    getCalendarProvider: vi.fn().mockResolvedValue(provider),
    getVisibleCalendars: vi.fn().mockResolvedValue([calendar]),
    upsertCalendar: vi.fn(),
    markMissingProviderCalendarsRemoved: vi.fn(),
    updateCalendarSyncToken: vi.fn(),
    applyCalendarSyncBatch: vi.fn(),
    reconcileCalendarEventsRange: vi.fn(),
    online: vi.fn(() => true),
  };
  return { provider, deps, coordinator: new CalendarSyncCoordinator(deps as never) };
}

describe("CalendarSyncCoordinator", () => {
  it("single-flights concurrent background, manual, startup and foreground delta consumers", async () => {
    const { provider, coordinator } = setup();
    let release!: () => void;
    provider.syncEvents.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({
        created: [], updated: [], deletedRemoteIds: [], newSyncToken: "cursor-2", newCtag: null,
        complete: true,
      });
    }));

    const calls = [
      coordinator.syncAccount("acc-1", "background"),
      coordinator.syncAccount("acc-1", "manual"),
      coordinator.syncAccount("acc-1", "startup"),
      coordinator.syncAccount("acc-1", "reconnect"),
      coordinator.syncAccount("acc-1", "foreground"),
    ];
    await vi.waitFor(() => expect(provider.syncEvents).toHaveBeenCalledTimes(1));
    release();
    await Promise.all(calls);
    expect(provider.syncEvents).toHaveBeenCalledTimes(1);
  });

  it("clears an invalid cursor, performs one controlled initial recovery, then commits the batch", async () => {
    const { provider, deps, coordinator } = setup();
    provider.syncEvents
      .mockResolvedValueOnce({
        created: [], updated: [], deletedRemoteIds: [], newSyncToken: null, newCtag: null,
        cursorInvalidated: true, complete: false,
      })
      .mockResolvedValueOnce({
        created: [], updated: [], deletedRemoteIds: [], newSyncToken: "recovered", newCtag: null,
        complete: true, authoritativeSnapshot: true,
      });

    await coordinator.syncAccount("acc-1", "manual");

    expect(provider.syncEvents).toHaveBeenNthCalledWith(1, "remote-cal", "cursor-1");
    expect(provider.syncEvents).toHaveBeenNthCalledWith(2, "remote-cal");
    expect(deps.updateCalendarSyncToken).toHaveBeenCalledWith("cal-1", null, null);
    expect(deps.applyCalendarSyncBatch).toHaveBeenCalledTimes(1);
  });

  it("does not poison single-flight after failure", async () => {
    const { provider, coordinator } = setup();
    provider.syncEvents.mockRejectedValueOnce(new Error("network"));
    await expect(coordinator.syncAccount("acc-1")).rejects.toThrow("network");
    provider.syncEvents.mockResolvedValueOnce({
      created: [], updated: [], deletedRemoteIds: [], newSyncToken: "cursor-2", newCtag: null,
      complete: true,
    });
    await coordinator.syncAccount("acc-1");
    expect(provider.syncEvents).toHaveBeenCalledTimes(2);
  });

  it("keeps cached reads independent and rejects provider refresh explicitly while offline", async () => {
    const { deps } = setup();
    deps.online.mockReturnValue(false);
    const coordinator = new CalendarSyncCoordinator(deps as never);
    await expect(coordinator.syncAccount("acc-1")).rejects.toBeInstanceOf(CalendarOfflineError);
    expect(deps.getCalendarProvider).not.toHaveBeenCalled();
  });

  it("runs range reconciliation after the shared delta flight", async () => {
    const { provider, deps, coordinator } = setup();
    const refresh = coordinator.refreshRange({
      accountId: "acc-1",
      rangeStart: new Date("2026-03-01T00:00:00Z"),
      rangeEnd: new Date("2026-04-01T00:00:00Z"),
    });
    const background = coordinator.syncAccount("acc-1", "background");
    await Promise.all([refresh, background]);
    expect(provider.syncEvents).toHaveBeenCalledTimes(1);
    expect(provider.fetchEvents).toHaveBeenCalledTimes(1);
    expect(deps.reconcileCalendarEventsRange).toHaveBeenCalledTimes(1);
  });

  it("reconciles a provider fallback snapshot within its authoritative range", async () => {
    const { provider, deps, coordinator } = setup();
    provider.syncEvents.mockResolvedValueOnce({
      created: [], updated: [], deletedRemoteIds: [], newSyncToken: null, newCtag: null,
      complete: true,
      authoritativeSnapshot: false,
      strategy: "range-refresh",
      coverageRange: { start: 10, end: 20 },
      diagnostics: { unreadableComponentCount: 0, unreadableObjectCount: 0 },
    });

    await coordinator.syncAccount("acc-1", "startup");

    expect(deps.reconcileCalendarEventsRange).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "acc-1",
      calendarId: "cal-1",
      rangeStart: 10,
      rangeEnd: 20,
    }));
    expect(deps.applyCalendarSyncBatch).not.toHaveBeenCalled();
  });
});
