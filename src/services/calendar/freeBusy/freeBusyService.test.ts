import { describe, expect, it, vi } from "vitest";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import type { DbCalendar } from "@/services/db/calendars";
import { participantRefFromEmail } from "../domain";
import { FreeBusyService } from "./freeBusyService";
import { LocalAccountFreeBusyAdapter, type LocalAccountFreeBusyDependencies } from "./localAccountAdapter";
import { availabilityStateForInterval } from "./intervals";
import type { AvailabilityRequest, ParticipantAvailability } from "./types";

const NOW = Date.UTC(2026, 2, 15, 12) / 1000;
const RANGE = { start: Date.UTC(2026, 2, 15) / 1000, end: Date.UTC(2026, 2, 16) / 1000 };
const SELF = participantRefFromEmail("self@example.test");
const STRANGER = participantRefFromEmail("stranger@example.test");
const iso = (instant: number) => new Date(instant * 1000).toISOString();

function calendar(id: string, visible = 1): DbCalendar {
  return {
    id, account_id: "account-1", provider: "caldav", remote_id: `/${id}/`,
    display_name: id, color: null, is_primary: id === "cal-1" ? 1 : 0, is_visible: visible,
    sync_token: null, ctag: null, created_at: 1, updated_at: 1,
  };
}

function event(overrides: Partial<DbCalendarEvent> = {}): DbCalendarEvent {
  const start = Date.UTC(2026, 2, 15, 10) / 1000;
  return {
    id: "event-1", account_id: "account-1", google_event_id: "remote-1",
    summary: "Secret roadmap review", description: "Internal only", location: "Room 5",
    start_time: start, end_time: start + 3600, is_all_day: 0, status: "confirmed",
    organizer_email: "owner@example.test", attendees_json: null, html_link: null, updated_at: 1,
    calendar_id: "cal-1", remote_event_id: "remote-1", etag: null,
    ical_data: "BEGIN:VEVENT\r\nSUMMARY:Secret roadmap review\r\nEND:VEVENT", uid: "uid-1",
    time_kind: "timed-zoned", tzid: "UTC",
    wall_start: "2026-03-15T10:00:00", wall_end: "2026-03-15T11:00:00",
    end_date_exclusive: null, series_uid: "uid-1", occurrence_key: null,
    is_recurrence_master: 0, transp: null, sequence: 0,
    origin: "remote", projection_key: null, projection_status: null,
    ...overrides,
  };
}

function deps(overrides: Partial<LocalAccountFreeBusyDependencies> = {}): LocalAccountFreeBusyDependencies {
  return {
    getAccountIdentity: vi.fn().mockResolvedValue({ id: "account-1", email: "self@example.test" }),
    getCalendarsForAccount: vi.fn().mockResolvedValue([calendar("cal-1")]),
    getCalendarEventsInRangeMulti: vi.fn().mockResolvedValue([]),
    getCalendarRangeCoverage: vi.fn().mockResolvedValue({ state: "complete", lastSuccessfulSync: NOW - 60 }),
    now: () => NOW,
    ...overrides,
  } as LocalAccountFreeBusyDependencies;
}

function service(overrides: Partial<LocalAccountFreeBusyDependencies> = {}): FreeBusyService {
  return new FreeBusyService([new LocalAccountFreeBusyAdapter("account-1", deps(overrides))]);
}

async function selfAvailability(
  overrides: Partial<LocalAccountFreeBusyDependencies> = {},
  request: Partial<AvailabilityRequest> = {},
): Promise<ParticipantAvailability> {
  const result = await service(overrides).queryAvailability({
    participants: [SELF], range: RANGE, timeZone: "UTC", ...request,
  });
  return result.participants[0]!;
}

describe("cache coverage decides how much the answer can be trusted", () => {
  it("complete and fresh coverage with no events is known free", async () => {
    const availability = await selfAvailability();
    expect(availability.reliability).toBe("known");
    expect(availability.busy).toEqual([]);
    expect(availabilityStateForInterval(availability, RANGE)).toBe("free");
  });

  it("never-synced with no events is unknown, never free", async () => {
    const availability = await selfAvailability({
      getCalendarRangeCoverage: vi.fn().mockResolvedValue({ state: "never-synced", lastSuccessfulSync: null }),
    });
    expect(availability.reliability).toBe("unknown");
    expect(availability.busy).toEqual([]);
    expect(availabilityStateForInterval(availability, RANGE)).toBe("unknown");
    expect(availability.diagnostics.map((value) => value.code)).toContain("never-synced");
  });

  it("partial coverage still returns intervals but downgrades trust", async () => {
    const availability = await selfAvailability({
      getCalendarRangeCoverage: vi.fn().mockResolvedValue({ state: "partial", lastSuccessfulSync: NOW - 60 }),
      getCalendarEventsInRangeMulti: vi.fn().mockResolvedValue([event()]),
    });
    expect(availability.reliability).toBe("partial");
    expect(availability.busy).toHaveLength(1);
    expect(availability.diagnostics.map((value) => value.code)).toContain("partial-coverage");
    // Busy is still busy; only the gaps become unknown.
    expect(availabilityStateForInterval(availability, { start: RANGE.start, end: RANGE.start + 60 }))
      .toBe("unknown");
  });

  it("stale complete coverage keeps the intervals and marks them stale", async () => {
    const availability = await selfAvailability({
      getCalendarRangeCoverage: vi.fn().mockResolvedValue({ state: "complete", lastSuccessfulSync: NOW - 7200 }),
      getCalendarEventsInRangeMulti: vi.fn().mockResolvedValue([event()]),
    });
    expect(availability.reliability).toBe("partial");
    expect(availability.busy).toHaveLength(1);
    expect(availability.diagnostics.map((value) => value.code)).toContain("stale-cache");
    expect(availability.dataAsOf).toBe(NOW - 7200);
  });

  it("reports unknown when the account has no calendars at all", async () => {
    const availability = await selfAvailability({
      getCalendarsForAccount: vi.fn().mockResolvedValue([]),
    });
    expect(availability.reliability).toBe("unknown");
    expect(availability.diagnostics.map((value) => value.code)).toContain("no-calendars");
  });
});

describe("availability spans every calendar the account owns", () => {
  it("aggregates busy time across calendars and ignores UI visibility", async () => {
    const getCalendarsForAccount = vi.fn().mockResolvedValue([calendar("cal-1"), calendar("cal-2", 0)]);
    const getCalendarEventsInRangeMulti = vi.fn().mockResolvedValue([
      event({ id: "a", calendar_id: "cal-1" }),
      event({
        id: "b", calendar_id: "cal-2",
        start_time: Date.UTC(2026, 2, 15, 11) / 1000, end_time: Date.UTC(2026, 2, 15, 12) / 1000,
        wall_start: "2026-03-15T11:00:00", wall_end: "2026-03-15T12:00:00",
      }),
    ]);
    const availability = await selfAvailability({ getCalendarsForAccount, getCalendarEventsInRangeMulti });

    // A hidden calendar is a display filter, not a statement about real availability.
    expect(getCalendarEventsInRangeMulti).toHaveBeenCalledWith(
      "account-1", ["cal-1", "cal-2"], RANGE.start, RANGE.end,
    );
    expect(availability.busy).toEqual([
      { start: Date.UTC(2026, 2, 15, 10) / 1000, end: Date.UTC(2026, 2, 15, 12) / 1000, busyType: "busy" },
    ]);
  });
});

describe("privacy boundary", () => {
  it("returns busy time without any event detail", async () => {
    const availability = await selfAvailability({
      getCalendarEventsInRangeMulti: vi.fn().mockResolvedValue([event()]),
    });
    const serialized = JSON.stringify(availability);
    for (const leak of ["Secret roadmap review", "Internal only", "Room 5", "owner@example.test", "BEGIN:VEVENT", "uid-1", "remote-1"]) {
      expect(serialized).not.toContain(leak);
    }
    expect(Object.keys(availability.busy[0]!).sort()).toEqual(["busyType", "end", "start"]);
    expect(iso(availability.busy[0]!.start)).toBe("2026-03-15T10:00:00.000Z");
  });
});

describe("identities nobody can answer for", () => {
  it("reports other people as unsupported rather than free", async () => {
    const result = await service().queryAvailability({
      participants: [SELF, STRANGER], range: RANGE, timeZone: "UTC",
    });
    expect(result.participants).toHaveLength(2);
    const [self, stranger] = result.participants;
    expect(self!.reliability).toBe("known");
    expect(stranger!.reliability).toBe("unsupported");
    expect(stranger!.source).toBe("none");
    expect(stranger!.busy).toEqual([]);
    expect(availabilityStateForInterval(stranger!, RANGE)).toBe("unknown");
    expect(stranger!.diagnostics.map((value) => value.code)).toContain("remote-unsupported");
  });

  it("preserves the requested participant order", async () => {
    const result = await service().queryAvailability({
      participants: [STRANGER, SELF], range: RANGE, timeZone: "UTC",
    });
    expect(result.participants.map((value) => value.participant.normalizedEmail))
      .toEqual(["stranger@example.test", "self@example.test"]);
  });

  it("turns a storage failure into error, never into free", async () => {
    const availability = await selfAvailability({
      getCalendarEventsInRangeMulti: vi.fn().mockRejectedValue(new Error("db offline")),
    });
    expect(availability.reliability).toBe("error");
    expect(availability.busy).toEqual([]);
    expect(availabilityStateForInterval(availability, RANGE)).toBe("unknown");
    expect(availability.diagnostics).toEqual([{ code: "provider-error", severity: "warning" }]);
    expect(JSON.stringify(availability)).not.toContain("db offline");
  });
});

describe("request handling", () => {
  it("rejects when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(service().queryAvailability({
      participants: [SELF], range: RANGE, timeZone: "UTC", options: { signal: controller.signal },
    })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("normalizes an inverted range instead of returning nothing", async () => {
    const result = await service().queryAvailability({
      participants: [SELF], range: { start: RANGE.end, end: RANGE.start }, timeZone: "UTC",
    });
    expect(result.range).toEqual(RANGE);
  });
});
