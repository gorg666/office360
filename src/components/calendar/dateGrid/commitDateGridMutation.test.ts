import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbCalendar } from "@/services/db/calendars";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import { calendarMutationService } from "@/services/calendar/calendarMutationService";
import { calendarDateToUnixSeconds } from "@/services/calendar/domain";
import { commitDateGridMutation } from "./commitDateGridMutation";

vi.mock("@/services/calendar/calendarMutationService", () => ({
  calendarMutationService: { update: vi.fn() },
}));

const updateMock = calendarMutationService.update as unknown as ReturnType<typeof vi.fn>;

const calendar: DbCalendar = {
  id: "cal-1", account_id: "account-1", provider: "caldav", remote_id: "/cal/",
  display_name: "Рабочий", color: "#4285f4", is_primary: 1, is_visible: 1,
  sync_token: null, ctag: null, created_at: 1, updated_at: 1,
};

function event(overrides: Partial<DbCalendarEvent> = {}): DbCalendarEvent {
  return {
    id: "event-1", account_id: "account-1", google_event_id: "/cal/plain.ics",
    summary: "Standup", description: null, location: null,
    start_time: 1_800_000_000, end_time: 1_800_003_600, is_all_day: 0,
    status: "confirmed", organizer_email: null, attendees_json: null, html_link: null,
    updated_at: 1, calendar_id: "cal-1", remote_event_id: "/cal/plain.ics",
    etag: '"v1"', ical_data: null, uid: "plain-1", time_kind: "timed-zoned",
    tzid: "UTC", wall_start: "2027-01-15T14:30:00", wall_end: "2027-01-15T15:30:00",
    end_date_exclusive: null, series_uid: null, occurrence_key: null,
    is_recurrence_master: 0, transp: null, sequence: 3, origin: "remote",
    reminders_json: '{"version":1,"policy":{"kind":"custom","reminders":[{"method":"notification","trigger":{"kind":"before-start","duration":{"seconds":900}}}]}}',
    projection_key: null, projection_status: null, ...overrides,
  };
}

describe("commitDateGridMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateMock.mockResolvedValue({ status: "success", value: {} });
  });

  it("writes a timed date move once through CalendarMutationService", async () => {
    const result = await commitDateGridMutation({
      accountId: "account-1",
      event: event(),
      calendars: [calendar],
      draft: { type: "shift", deltaDays: 2 },
    });
    expect(result.status).toBe("success");
    expect(updateMock).toHaveBeenCalledTimes(1);
    const [, input] = updateMock.mock.calls[0]!;
    expect(input.isAllDay).toBe(false);
    expect(input.time.kind).toBe("timed-zoned");
    expect(input.reminders).toBeUndefined();
  });

  it("does not call the service when the draft is unchanged", async () => {
    await commitDateGridMutation({
      accountId: "account-1",
      event: event(),
      calendars: [calendar],
      draft: { type: "shift", deltaDays: 0 },
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("preserves occurrence identity for a single-scope conversion", async () => {
    const occurrence = event({
      uid: "series-1",
      series_uid: "series-1",
      occurrence_key: "series-1::20270115T143000Z",
    });
    await commitDateGridMutation({
      accountId: "account-1",
      event: occurrence,
      calendars: [calendar],
      draft: { type: "to-all-day", startDate: "2027-01-18" },
      scope: "single",
    });
    const [target, input] = updateMock.mock.calls[0]!;
    expect(target).toMatchObject({
      recurrenceScope: "single",
      occurrenceKey: "series-1::20270115T143000Z",
      seriesUid: "series-1",
      isRecurring: true,
    });
    expect(input.isAllDay).toBe(true);
    expect(input.reminders).toBeUndefined();
  });

  it("writes all-day → timed with default duration", async () => {
    await commitDateGridMutation({
      accountId: "account-1",
      event: event({
        is_all_day: 1,
        time_kind: "all-day",
        start_time: calendarDateToUnixSeconds("2027-01-15"),
        end_time: calendarDateToUnixSeconds("2027-01-16"),
        end_date_exclusive: "2027-01-16",
        wall_start: null,
        wall_end: null,
        tzid: "UTC",
      }),
      calendars: [calendar],
      draft: { type: "to-timed", startDate: "2027-01-15", startMinutesFromMidnight: 9 * 60 },
    });
    const [, input] = updateMock.mock.calls[0]!;
    expect(input.isAllDay).toBe(false);
    expect(input.time.kind).toBe("timed-zoned");
    expect(input.time.start.wall).toMatchObject({ hour: 9, minute: 0 });
    expect(input.time.end.wall).toMatchObject({ hour: 10, minute: 0 });
    expect(input.reminders).toBeUndefined();
  });
});
