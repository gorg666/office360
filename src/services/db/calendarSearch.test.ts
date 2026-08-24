import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/test/mocks";

const connectionMocks = vi.hoisted(() => ({ getDb: vi.fn(), selectFirstBy: vi.fn() }));
vi.mock("./connection", () => connectionMocks);

import { getCalendarEventForSearch, searchCalendarEventRows } from "./calendarSearch";

const db = createMockDb();

describe("calendar search repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionMocks.getDb.mockResolvedValue(db);
  });

  it("runs one bounded account/calendar query without selecting raw ICS", async () => {
    db.select.mockResolvedValueOnce([]);
    await searchCalendarEventRows({
      accountId: "account-1",
      calendarIds: ["calendar-1", "calendar-2"],
      query: "Plan%_\\",
      rangeStart: 100,
      rangeEnd: 200,
      limit: 25,
      now: 150,
    });

    expect(db.select).toHaveBeenCalledTimes(1);
    const [sql, params] = db.select.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("json_tree");
    expect(sql).toContain("participant.key IN");
    expect(sql).toContain("e.account_id = $1");
    expect(sql).toContain("e.calendar_id IN ($10, $11)");
    expect(sql).toContain("provider_presence IS NOT 'removed'");
    expect(sql).toContain("<> 'cancelled'");
    expect(sql).toContain("ROW_NUMBER() OVER");
    expect(sql).toContain("LIMIT $9");
    expect(sql).not.toMatch(/SELECT\s+e\.\*/i);
    expect(sql).not.toContain("ical_data");
    expect(params).toEqual([
      "account-1",
      "%Plan\\%\\_\\\\%", "%plan\\%\\_\\\\%", "%PLAN\\%\\_\\\\%", "%Plan\\%\\_\\\\%",
      150, 100, 200, 25, "calendar-1", "calendar-2",
    ]);
  });

  it("returns immediately when no readable calendars exist", async () => {
    expect(await searchCalendarEventRows({ accountId: "a", calendarIds: [], query: "x", limit: 10, now: 1 })).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rechecks account, calendar presence and cancellation before detail resolution", async () => {
    connectionMocks.selectFirstBy.mockResolvedValueOnce(null);
    await expect(getCalendarEventForSearch("account-1", "event-1", ["calendar-1"])).resolves.toBeNull();
    const [sql, params] = connectionMocks.selectFirstBy.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("e.account_id = $1 AND e.id = $2");
    expect(sql).toContain("e.calendar_id IN ($3)");
    expect(sql).toContain("provider_presence IS NOT 'removed'");
    expect(sql).toContain("<> 'cancelled'");
    expect(params).toEqual(["account-1", "event-1", "calendar-1"]);
  });
});
