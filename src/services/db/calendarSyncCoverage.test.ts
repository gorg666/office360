import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/db/connection", () => ({ getDb: vi.fn() }));

import { getDb } from "@/services/db/connection";
import { createMockDb } from "@/test/mocks";
import { getCalendarRangeCoverage, recordCalendarRangeCoverage } from "./calendarSyncCoverage";

const mockDb = createMockDb();

describe("calendarSyncCoverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue(mockDb as never);
  });

  it("distinguishes a never-synced range from a synced-empty complete range", async () => {
    mockDb.select.mockResolvedValueOnce([]);
    await expect(getCalendarRangeCoverage("acc-1", ["cal-1"], 100, 200)).resolves.toEqual({
      state: "never-synced",
      lastSuccessfulSync: null,
    });

    mockDb.select.mockResolvedValueOnce([{ calendar_id: "cal-1", coverage_state: "complete", last_successful_sync: 300 }]);
    await expect(getCalendarRangeCoverage("acc-1", ["cal-1"], 100, 200)).resolves.toEqual({
      state: "complete",
      lastSuccessfulSync: 300,
    });
  });

  it("requires complete coverage for every visible calendar", async () => {
    mockDb.select.mockResolvedValueOnce([
      { calendar_id: "cal-1", coverage_state: "complete", last_successful_sync: 300 },
      { calendar_id: "cal-2", coverage_state: "partial", last_successful_sync: null },
    ]);
    const result = await getCalendarRangeCoverage("acc-1", ["cal-1", "cal-2"], 100, 200);
    expect(result.state).toBe("partial");
  });

  it("records partial diagnostics without erasing a prior successful timestamp", async () => {
    await recordCalendarRangeCoverage({
      accountId: "acc-1",
      calendarId: "cal-1",
      rangeStart: 100,
      rangeEnd: 200,
      state: "partial",
      unreadableComponentCount: 1,
      unreadableObjectCount: 0,
    });
    const [sql, params] = mockDb.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("calendar_sync_coverage");
    expect(sql).toContain("calendar_sync_coverage.last_successful_sync");
    expect(params.slice(1)).toEqual(["acc-1", "cal-1", 100, 200, "partial", 1, 0]);
  });
});
