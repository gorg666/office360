import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbCalendar } from "@/services/db/calendars";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import { calendarMutationService } from "@/services/calendar/calendarMutationService";
import { commitTimedGridMutation } from "./commitTimedGridMutation";
import { moveDraft } from "./timedEventMutation";

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
    tzid: "UTC", wall_start: "2027-01-15T10:00:00", wall_end: "2027-01-15T11:00:00",
    end_date_exclusive: null, series_uid: null, occurrence_key: null,
    is_recurrence_master: 0, transp: null, sequence: 3, origin: "remote",
    projection_key: null, projection_status: null, ...overrides,
  };
}

describe("commitTimedGridMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateMock.mockResolvedValue({ status: "success", value: {} });
  });

  it("writes a non-recurring move once through CalendarMutationService", async () => {
    const result = await commitTimedGridMutation({
      accountId: "account-1",
      event: event(),
      calendars: [calendar],
      draft: moveDraft(90),
    });
    expect(result.status).toBe("success");
    expect(updateMock).toHaveBeenCalledTimes(1);
    const [target, input] = updateMock.mock.calls[0]!;
    expect(target).toMatchObject({
      accountId: "account-1",
      calendarRemoteId: "/cal/",
      remoteEventId: "/cal/plain.ics",
      isRecurring: false,
    });
    expect(input.time?.kind).toBe("timed-zoned");
  });

  it("passes occurrence identity for a single-occurrence drag", async () => {
    await commitTimedGridMutation({
      accountId: "account-1",
      event: event({
        uid: "series-1",
        series_uid: "series-1",
        occurrence_key: "series-1::20270115T100000Z",
        remote_event_id: "/cal/series.ics",
        google_event_id: "/cal/series.ics",
      }),
      calendars: [calendar],
      draft: moveDraft(90),
      scope: "single",
    });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0]![0]).toMatchObject({
      isRecurring: true,
      recurrenceScope: "single",
      seriesUid: "series-1",
      occurrenceKey: "series-1::20270115T100000Z",
    });
  });

  it("moves a series without per-occurrence writes", async () => {
    await commitTimedGridMutation({
      accountId: "account-1",
      event: event({
        uid: "series-1",
        series_uid: "series-1",
        occurrence_key: "series-1::20270115T100000Z",
        remote_event_id: "/cal/series.ics",
        google_event_id: "/cal/series.ics",
      }),
      calendars: [calendar],
      draft: moveDraft(90),
      scope: "series",
    });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0]![0]).toMatchObject({
      isRecurring: true,
      recurrenceScope: "series",
      seriesUid: "series-1",
    });
    expect(updateMock.mock.calls[0]![0].occurrenceKey).toBeUndefined();
  });

  it("does not call the service when the snapped draft is unchanged", async () => {
    const result = await commitTimedGridMutation({
      accountId: "account-1",
      event: event(),
      calendars: [calendar],
      draft: moveDraft(0),
    });
    expect(result.status).toBe("success");
    expect(updateMock).not.toHaveBeenCalled();
  });
});
