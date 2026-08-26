import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/services/db/calendarInvitations", () => ({
  getCalendarInvitationById: vi.fn(),
  getCalendarInvitationByIdentity: vi.fn(() => Promise.resolve(null)),
  updateInvitationQueueStatus: vi.fn(() => Promise.resolve()),
  updateInvitationRsvp: vi.fn(() => Promise.resolve()),
  upsertCalendarInvitation: vi.fn((input) => Promise.resolve({
    id: "invite-1",
    account_id: input.accountId,
    thread_id: input.threadId,
    message_id: input.messageId,
    event_uid: input.eventUid,
    recurrence_id: input.recurrenceId ?? null,
    recurrence_key: input.recurrenceId ?? "",
    method: input.method ?? null,
    sequence: input.sequence ?? 0,
    status: input.status ?? "confirmed",
    summary: input.summary ?? null,
    description: input.description ?? null,
    location: input.location ?? null,
    start_time: input.startTime ?? 0,
    end_time: input.endTime ?? 0,
    is_all_day: input.isAllDay ? 1 : 0,
    timezone_id: input.timezoneId ?? null,
    timezone_warning: input.timezoneWarning ? 1 : 0,
    organizer_email: input.organizerEmail ?? null,
    attendees_json: input.attendeesJson ?? null,
    rsvp_status: "needs_action",
    rsvp_queue_status: null,
    queued_operation_id: null,
    calendar_event_id: null,
    raw_ical: input.rawIcal,
    source_hash: input.sourceHash,
    created_at: 1,
    updated_at: 1,
  })),
}));

vi.mock("@/services/db/pendingOperations", () => ({
  enqueuePendingOperation: vi.fn(() => Promise.resolve("op-1")),
  enqueueItipSendOperation: vi.fn(() => Promise.resolve("op-1")),
}));

vi.mock("@/services/db/calendarItipActions", () => ({
  getCalendarItipAction: vi.fn(() => Promise.resolve(null)),
  getLatestAppliedItipAction: vi.fn(() => Promise.resolve(null)),
  recordCalendarItipAction: vi.fn((message) => Promise.resolve({
    created: true,
    action: {
      action_key: `action:${message.method}:${message.eventUid}:${message.participantKey}`,
      delivery_status: null,
      pending_operation_id: null,
    },
  })),
  updateCalendarItipAction: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/services/db/calendarEvents", () => ({
  calendarProjectionKey: vi.fn((uid: string, recurrenceKey: string) => `invite:${uid}:${recurrenceKey}`),
  removeCalendarProjection: vi.fn(() => Promise.resolve()),
  upsertCalendarEvent: vi.fn(() => Promise.resolve()),
  getCalendarEventByUid: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@/services/db/accounts", () => ({
  getAccountIdentity: vi.fn(() => Promise.resolve({ id: "account-1", email: "self@example.com" })),
}));

import {
  detectInvitationsInMessage,
  executeCalendarQueuedAction,
  extractICalendarPayloads,
  respondToCalendarInvitation,
  upsertInvitationFromICalendar,
} from "./invitations";
import {
  getCalendarInvitationById,
  updateInvitationQueueStatus,
  updateInvitationRsvp,
  upsertCalendarInvitation,
} from "@/services/db/calendarInvitations";
import { enqueueItipSendOperation } from "@/services/db/pendingOperations";
import { removeCalendarProjection, upsertCalendarEvent } from "@/services/db/calendarEvents";

const ical = [
  "BEGIN:VCALENDAR",
  "METHOD:REQUEST",
  "BEGIN:VEVENT",
  "UID:uid-1",
  "ORGANIZER:mailto:lead@example.com",
  "ATTENDEE;ROLE=REQ-PARTICIPANT:mailto:self@example.com",
  "SUMMARY:Planning",
  "DTSTART:20260620T100000Z",
  "DTEND:20260620T110000Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("calendar invitations service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts VCALENDAR payloads from mixed text", () => {
    expect(extractICalendarPayloads(`hello\n${ical}\nbye`)).toEqual([ical]);
  });

  it("normalizes raw iCalendar into a DB invitation", async () => {
    await upsertInvitationFromICalendar({
      accountId: "acc-1",
      threadId: "thread-1",
      messageId: "msg-1",
      icalData: ical,
      source: "body",
    });

    expect(upsertCalendarInvitation).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "acc-1",
      threadId: "thread-1",
      messageId: "msg-1",
      eventUid: "uid-1",
      method: "REQUEST",
      summary: "Planning",
      startTime: Math.floor(new Date("2026-06-20T10:00:00Z").getTime() / 1000),
      rawIcal: ical,
    }));
  });

  it("detects invitations in message body text", async () => {
    const result = await detectInvitationsInMessage({
      accountId: "acc-1",
      threadId: "thread-1",
      messageId: "msg-1",
      bodyText: ical,
      senderEmail: "lead@example.com",
    });

    expect(result).toHaveLength(1);
    expect(upsertCalendarInvitation).toHaveBeenCalledTimes(1);
  });

  it("responds locally, projects accepted invite, and queues delivery", async () => {
    vi.mocked(getCalendarInvitationById).mockResolvedValueOnce({
      id: "invite-1",
      account_id: "acc-1",
      thread_id: "thread-1",
      message_id: "msg-1",
      event_uid: "uid-1",
      recurrence_id: null,
      recurrence_key: "",
      method: "REQUEST",
      sequence: 1,
      status: "confirmed",
      summary: "Planning",
      description: null,
      location: null,
      start_time: 1000,
      end_time: 2000,
      is_all_day: 0,
      timezone_id: null,
      timezone_warning: 0,
      organizer_email: "lead@example.com",
      attendees_json: null,
      rsvp_status: "needs_action",
      rsvp_queue_status: null,
      queued_operation_id: null,
      calendar_event_id: null,
      raw_ical: ical,
      source_hash: "body:abc",
      created_at: 1,
      updated_at: 1,
    });

    const result = await respondToCalendarInvitation("acc-1", "invite-1", "accepted");

    expect(result.queuedOperationId).toBe("op-1");
    expect(upsertCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "acc-1",
      googleEventId: "invite:uid-1:",
      summary: "Planning",
      origin: "local_projection",
      projectionKey: "invite:uid-1:",
      projectionStatus: "pending",
    }));
    expect(enqueueItipSendOperation).toHaveBeenCalledWith("acc-1", expect.any(String), expect.objectContaining({
      itipActionKey: expect.any(String),
      itipInvitationId: "invite-1",
    }));
    expect(updateInvitationRsvp).toHaveBeenCalledWith("invite-1", "accepted", "queued", "op-1");
  });

  it("returns typed unsupported and marks Mail RSVP delivery blocked", async () => {
    const result = await executeCalendarQueuedAction("acc-1", "calendarRsvp", {
      invitationId: "invite-1",
      rsvpStatus: "accepted",
      eventUid: "uid-1",
      recurrenceKey: "",
    });

    expect(result.status).toBe("unsupported");
    expect(updateInvitationQueueStatus).toHaveBeenCalledWith("invite-1", "blocked");
    expect(removeCalendarProjection).toHaveBeenCalledWith("acc-1", "invite:uid-1:");
  });

  it("keeps Mail invitation VALARM payload in raw ICS without breaking semantic ingestion", async () => {
    const withAlarm = ical.replace(
      "END:VEVENT",
      "BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:Invite reminder\r\nEND:VALARM\r\nEND:VEVENT",
    );
    await upsertInvitationFromICalendar({
      accountId: "acc-1", threadId: "thread-1", messageId: "msg-alarm", icalData: withAlarm, source: "body",
    });
    expect(upsertCalendarInvitation).toHaveBeenCalledWith(expect.objectContaining({
      eventUid: "uid-1", summary: "Planning", rawIcal: withAlarm,
    }));
  });

  it("reuses one stable projection identity for repeated RSVP", async () => {
    const invitation = {
      id: "invite-repeat", account_id: "acc-1", thread_id: "thread-1", message_id: "msg-1",
      event_uid: "uid-repeat", recurrence_id: null, recurrence_key: "", method: "REQUEST",
      sequence: 1, status: "confirmed", summary: "Repeat", description: null, location: null,
      start_time: 1000, end_time: 2000, is_all_day: 0, timezone_id: null,
      timezone_warning: 0, organizer_email: "lead@example.com", attendees_json: null,
      rsvp_status: "needs_action" as const, rsvp_queue_status: null, queued_operation_id: null,
      calendar_event_id: null, raw_ical: ical, source_hash: "body:repeat", created_at: 1, updated_at: 1,
    };
    vi.mocked(getCalendarInvitationById).mockResolvedValue(invitation);

    await respondToCalendarInvitation("acc-1", invitation.id, "accepted");
    await respondToCalendarInvitation("acc-1", invitation.id, "tentative");

    expect(upsertCalendarEvent).toHaveBeenCalledTimes(2);
    expect(vi.mocked(upsertCalendarEvent).mock.calls.map(([event]) => event.projectionKey))
      .toEqual(["invite:uid-repeat:", "invite:uid-repeat:"]);
  });
});
