import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarSyncService } from "./calendarSyncService";

const calendar = {
  id: "cal-1", account_id: "acc-1", provider: "caldav", remote_id: "remote-cal",
  display_name: "Calendar", color: null, is_primary: 1, is_visible: 1,
  sync_token: null, ctag: null, created_at: 1, updated_at: 1,
};

function dependencies() {
  const provider = {
    accountId: "acc-1",
    type: "caldav" as const,
    capabilities: {} as never,
    lastReadDiagnostics: { unreadableComponentCount: 0, unreadableObjectCount: 0 },
    listCalendars: vi.fn().mockResolvedValue([]),
    fetchEvents: vi.fn().mockResolvedValue([]),
  };
  return {
    provider,
    deps: {
      hasCalendarSupport: vi.fn().mockResolvedValue(true),
      getCalendarProvider: vi.fn().mockResolvedValue(provider),
      getCalendarsForAccount: vi.fn().mockResolvedValue([calendar]),
      upsertCalendar: vi.fn().mockResolvedValue("cal-1"),
      getCalendarEventsInRangeMulti: vi.fn().mockResolvedValue([]),
      getCalendarRangeCoverage: vi.fn().mockResolvedValue({ state: "never-synced", lastSuccessfulSync: null }),
      reconcileCalendarEventsRange: vi.fn().mockResolvedValue(undefined),
    },
  };
}

const range = {
  accountId: "acc-1",
  rangeStart: new Date("2026-03-01T00:00:00Z"),
  rangeEnd: new Date("2026-04-01T00:00:00Z"),
};

describe("CalendarSyncService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks an authoritative empty response as synced-empty coverage", async () => {
    const { deps } = dependencies();
    deps.getCalendarRangeCoverage
      .mockResolvedValueOnce({ state: "never-synced", lastSuccessfulSync: null })
      .mockResolvedValueOnce({ state: "complete", lastSuccessfulSync: 300 });
    const result = await new CalendarSyncService(deps as never).loadRange(range);
    expect(result).toMatchObject({ status: "fresh", coverage: "complete", events: [] });
    expect(deps.reconcileCalendarEventsRange).toHaveBeenCalledWith(expect.objectContaining({ events: [] }));
  });

  it("keeps missing cached events on a partial parser response", async () => {
    const { deps, provider } = dependencies();
    provider.lastReadDiagnostics = { unreadableComponentCount: 1, unreadableObjectCount: 0 };
    deps.getCalendarRangeCoverage
      .mockResolvedValueOnce({ state: "complete", lastSuccessfulSync: 200 })
      .mockResolvedValueOnce({ state: "complete", lastSuccessfulSync: 200 });
    const result = await new CalendarSyncService(deps as never).loadRange(range);
    expect(result.status).toBe("fresh-with-warnings");
    expect(deps.reconcileCalendarEventsRange).toHaveBeenCalledWith(expect.objectContaining({
      diagnostics: { unreadableComponentCount: 1, unreadableObjectCount: 0 },
    }));
  });

  it("returns stale, including stale-empty, when complete cache coverage exists", async () => {
    const { deps, provider } = dependencies();
    deps.getCalendarRangeCoverage.mockResolvedValue({ state: "complete", lastSuccessfulSync: 200 });
    provider.listCalendars.mockRejectedValue(new Error("offline"));
    const result = await new CalendarSyncService(deps as never).loadRange(range);
    expect(result).toMatchObject({ status: "stale", coverage: "complete", events: [], hasUsableCache: true });
  });

  it("returns error when the range has never been synced and the provider fails", async () => {
    const { deps, provider } = dependencies();
    provider.listCalendars.mockRejectedValue(new Error("offline"));
    const result = await new CalendarSyncService(deps as never).loadRange(range);
    expect(result.status).toBe("error");
  });
});
