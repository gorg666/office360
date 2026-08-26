import { describe, expect, it, vi } from "vitest";
import { googleCalendarAccess, serializeCalendarAccess } from "./domain";
import { CalendarSearchService } from "./calendarSearchService";
import type { DbCalendar } from "@/services/db/calendars";

const calendar = (id: string, role = "reader", visible = 1): DbCalendar => ({
  id, account_id: "account-1", provider: "google_api", remote_id: id,
  display_name: id, color: null, is_primary: 0, is_visible: visible,
  sync_token: null, ctag: null, created_at: 1, updated_at: 1,
  access_json: serializeCalendarAccess(googleCalendarAccess(role)), access_observed_at: 1,
  provider_presence: "present", provider_seen_at: 1,
});

describe("CalendarSearchService", () => {
  it("searches hidden readable calendars but excludes free-busy-only calendars", async () => {
    const searchRows = vi.fn().mockResolvedValue([{
      event_id: "event-1", event_resource_key: "remote-1", series_uid: "series-1", occurrence_key: "occ-1",
      calendar_id: "hidden", calendar_name: "hidden", summary: "Planning", location: "Room",
      start_time: 1000, end_time: 2000, is_all_day: 0,
      matched_title: 1, matched_description: 0, matched_location: 1, matched_participant: 0,
    }]);
    const service = new CalendarSearchService({
      getCalendarsForAccount: vi.fn().mockResolvedValue([
        calendar("visible"), calendar("hidden", "reader", 0), calendar("private", "freeBusyReader"),
      ]),
      searchRows,
      getEvent: vi.fn(),
    });

    const result = await service.search({ accountId: "account-1", query: "Planning", now: 500, limit: 999 });
    expect(searchRows).toHaveBeenCalledWith(expect.objectContaining({ calendarIds: ["visible", "hidden"], limit: 100 }));
    expect(result[0]).toMatchObject({ title: "Planning", matchedFields: ["title", "location"] });
  });

  it("honors calendar and date filters and ignores short queries", async () => {
    const searchRows = vi.fn().mockResolvedValue([]);
    const service = new CalendarSearchService({
      getCalendarsForAccount: vi.fn().mockResolvedValue([calendar("one"), calendar("two")]),
      searchRows,
      getEvent: vi.fn(),
    });
    await expect(service.search({ accountId: "account-1", query: " x " })).resolves.toEqual([]);
    expect(searchRows).not.toHaveBeenCalled();
    await service.search({ accountId: "account-1", query: "sync", calendarIds: ["two"], range: { start: 10, end: 20 } });
    expect(searchRows).toHaveBeenCalledWith(expect.objectContaining({ calendarIds: ["two"], rangeStart: 10, rangeEnd: 20 }));
  });

  it("rechecks readable calendars when resolving a detail event", async () => {
    const getEvent = vi.fn().mockResolvedValue(null);
    const service = new CalendarSearchService({
      getCalendarsForAccount: vi.fn().mockResolvedValue([calendar("readable"), calendar("private", "freeBusyReader")]),
      searchRows: vi.fn(), getEvent,
    });
    await service.resolveEvent("account-1", "event-1");
    expect(getEvent).toHaveBeenCalledWith("account-1", "event-1", ["readable"]);
  });
});
