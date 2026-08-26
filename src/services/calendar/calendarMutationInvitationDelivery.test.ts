import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEventData, CalendarProvider } from "./types";

const queueDelivery = vi.hoisted(() => vi.fn(() => Promise.resolve([])));
const previousEnvelope = vi.hoisted(() => vi.fn());

vi.mock("./providerFactory", () => ({ getCalendarProvider: vi.fn() }));
vi.mock("@/services/db/calendars", () => ({
  getCalendarByRemoteId: vi.fn(() => Promise.resolve({ id: "calendar-db-1", access_json: "writable" })),
  accessForCalendar: vi.fn(() => ({ permissions: { canCreate: true, canUpdate: true, canDelete: true } })),
}));
vi.mock("@/services/db/calendarEvents", () => ({ getEventByRemoteId: vi.fn() }));
vi.mock("./calendarAccessService", () => ({ refreshCalendarAccess: vi.fn(() => Promise.resolve([])) }));
vi.mock("./itip/lifecycle", () => ({
  queueEventInvitationDeliveries: queueDelivery,
  invitationEnvelopeFromDbEvent: previousEnvelope,
}));

import { getCalendarProvider } from "./providerFactory";
import { getEventByRemoteId } from "@/services/db/calendarEvents";
import { calendarMutationService } from "./calendarMutationService";

const capabilities = {
  version: 5 as const,
  read: { calendars: "full" as const, events: "full" as const },
  events: { create: "remote" as const, update: "remote" as const, delete: "remote" as const },
  recurrence: { read: "full" as const, write: "partial" as const, updateScopes: ["single", "series"] as const, deleteScopes: ["single", "series"] as const },
  attendees: { read: "full" as const, write: "full" as const },
  rsvp: { local: "projection" as const, remote: "direct" as const }, invitations: "email-itip" as const,
  sync: { mode: "range-refresh" as const, pagination: false, durability: "ephemeral" as const },
  freeBusy: { self: "local-derived" as const, others: "none" as const }, permissions: "none" as const,
  sharedCalendars: "read" as const,
  calendarAccess: { discovery: "full" as const, ownership: "full" as const, effectivePermissions: "full" as const, aclRead: "none" as const, aclWrite: "none" as const },
  reminders: { read: "partial" as const, write: "partial" as const, multiple: true, methods: ["notification"] as const, defaults: "inherit" as const, maxCount: null },
  conflictDetection: "etag" as const,
};

function attendee(email: string) {
  return {
    participant: { kind: "email", value: email, normalizedEmail: email.toLowerCase() },
    role: "required", status: "needs-action", rsvpRequested: true, participantType: "individual",
    delegatedTo: [], delegatedFrom: [], sentBy: null,
  } as CalendarEventData["attendees"][number];
}

function event(attendees = [attendee("guest@example.com")], sequence = 1): CalendarEventData {
  return {
    remoteEventId: "event-1", uid: "uid-1", etag: "etag", summary: "Planning",
    description: null, location: null, startTime: 1_800_000_000, endTime: 1_800_003_600,
    isAllDay: false, status: "confirmed", organizerEmail: "self@example.com", attendeesJson: null,
    organizer: null, attendees, htmlLink: null, icalData: null,
    time: { kind: "floating", start: { year: 2027, month: 1, day: 15, hour: 10, minute: 0, second: 0 }, end: { year: 2027, month: 1, day: 15, hour: 11, minute: 0, second: 0 } },
    seriesUid: "uid-1", occurrenceKey: null, isRecurrenceMaster: true, transparency: "opaque",
    sequence, participants: attendees.map((item) => item.participant), reminders: { kind: "inherit" },
  };
}

function provider(result: CalendarEventData): CalendarProvider {
  return {
    accountId: "account-1", type: "caldav", capabilities,
    listCalendars: vi.fn(), fetchEvents: vi.fn(), syncEvents: vi.fn(), testConnection: vi.fn(),
    createEvent: vi.fn(() => Promise.resolve(result)),
    updateEvent: vi.fn(() => Promise.resolve(result)),
    deleteEvent: vi.fn(() => Promise.resolve()), respondToEvent: vi.fn(),
  };
}

describe("Calendar mutation iTIP delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEventByRemoteId).mockResolvedValue(null);
  });

  it("queues REQUEST after meeting creation", async () => {
    vi.mocked(getCalendarProvider).mockResolvedValue(provider(event()));
    const result = await calendarMutationService.create("account-1", "calendar-1", {
      summary: "Planning", startTime: "2027-01-15T10:00:00Z", endTime: "2027-01-15T11:00:00Z",
      attendees: [attendee("guest@example.com")],
    });
    expect(result.status).toBe("success");
    expect(queueDelivery).toHaveBeenCalledWith(expect.objectContaining({
      method: "REQUEST", calendarId: "calendar-db-1", allowMissingOrganizer: true,
    }));
  });

  it("queues update REQUEST and CANCEL only for removed attendee", async () => {
    const current = event([attendee("kept@example.com"), attendee("new@example.com")], 4);
    const previous = event([attendee("kept@example.com"), attendee("removed@example.com")], 3);
    vi.mocked(getCalendarProvider).mockResolvedValue(provider(current));
    vi.mocked(getEventByRemoteId).mockResolvedValue({} as never);
    previousEnvelope.mockReturnValue(previous);

    expect((await calendarMutationService.update({ accountId: "account-1", calendarRemoteId: "calendar-1", remoteEventId: "event-1", baseSequence: 3 }, { summary: "Updated" })).status).toBe("success");
    expect(queueDelivery).toHaveBeenCalledWith(expect.objectContaining({ method: "REQUEST", event: current }));
    expect(queueDelivery).toHaveBeenCalledWith(expect.objectContaining({ method: "CANCEL", recipients: ["removed@example.com"], sequence: 4 }));
  });

  it("queues same-UID incremented-sequence CANCEL after deletion", async () => {
    const previous = event([attendee("guest@example.com")], 5);
    vi.mocked(getCalendarProvider).mockResolvedValue(provider(previous));
    vi.mocked(getEventByRemoteId).mockResolvedValue({} as never);
    previousEnvelope.mockReturnValue(previous);
    expect((await calendarMutationService.delete({ accountId: "account-1", calendarRemoteId: "calendar-1", remoteEventId: "event-1", baseSequence: 5 })).status).toBe("success");
    expect(queueDelivery).toHaveBeenCalledWith(expect.objectContaining({ method: "CANCEL", event: expect.objectContaining({ uid: "uid-1" }), sequence: 6 }));
  });

  it("reports partial when event write succeeds but Mail queueing fails", async () => {
    vi.mocked(getCalendarProvider).mockResolvedValue(provider(event()));
    queueDelivery.mockRejectedValueOnce(new Error("queue unavailable"));
    expect((await calendarMutationService.create("account-1", "calendar-1", {
      summary: "Planning", startTime: "2027-01-15T10:00:00Z", endTime: "2027-01-15T11:00:00Z",
    })).status).toBe("partial");
  });
});
