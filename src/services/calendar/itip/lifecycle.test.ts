import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  existingAction: null as Record<string, unknown> | null,
  latestAction: null as Record<string, unknown> | null,
  invitation: null as Record<string, unknown> | null,
  event: null as Record<string, unknown> | null,
}));

vi.mock("@/services/db/accounts", () => ({
  getAccountIdentity: vi.fn(() => Promise.resolve({ id: "account-1", email: "self@example.com" })),
}));

vi.mock("@/services/db/calendarItipActions", () => ({
  getCalendarItipAction: vi.fn(() => Promise.resolve(state.existingAction)),
  getLatestAppliedItipAction: vi.fn(() => Promise.resolve(state.latestAction)),
  recordCalendarItipAction: vi.fn((message, processingStatus) => Promise.resolve({
    created: true,
    action: { action_key: `action:${message.method}:${message.sequence}`, processing_status: processingStatus },
  })),
  updateCalendarItipAction: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/services/db/calendarInvitations", () => ({
  getCalendarInvitationByIdentity: vi.fn(() => Promise.resolve(state.invitation)),
  upsertCalendarInvitation: vi.fn((input) => Promise.resolve({
    id: "invitation-1", account_id: input.accountId, event_uid: input.eventUid,
    recurrence_id: input.recurrenceId ?? null, recurrence_key: input.recurrenceId ?? "",
    sequence: input.sequence, source_hash: input.sourceHash, raw_ical: input.rawIcal,
    summary: input.summary, description: input.description, location: input.location,
    start_time: input.startTime, end_time: input.endTime, is_all_day: input.isAllDay ? 1 : 0,
    status: input.status, organizer_email: input.organizerEmail, attendees_json: input.attendeesJson,
    calendar_event_id: null,
  })),
  updateInvitationQueueStatus: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/services/db/calendarEvents", () => ({
  calendarProjectionKey: vi.fn((uid, recurrenceKey) => `invite:${uid}:${recurrenceKey}`),
  getCalendarEventByUid: vi.fn(() => Promise.resolve(state.event)),
  removeCalendarProjection: vi.fn(() => Promise.resolve()),
  upsertCalendarEvent: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/services/db/calendars", () => ({ getCalendarById: vi.fn(() => Promise.resolve(null)) }));
vi.mock("@/services/db/pendingOperations", () => ({ enqueueItipSendOperation: vi.fn() }));

import { hasOrganizerDeliveryAuthority, ingestInboundItip } from "./lifecycle";
import { recordCalendarItipAction, updateCalendarItipAction } from "@/services/db/calendarItipActions";
import { removeCalendarProjection, upsertCalendarEvent } from "@/services/db/calendarEvents";
import { upsertCalendarInvitation } from "@/services/db/calendarInvitations";

function request(input: { method?: "REQUEST" | "REPLY" | "CANCEL"; sequence?: number; recurrenceId?: string; sender?: string } = {}) {
  const method = input.method ?? "REQUEST";
  const attendee = method === "REPLY"
    ? "ATTENDEE;PARTSTAT=ACCEPTED:mailto:guest@example.com"
    : "ATTENDEE;ROLE=OPT-PARTICIPANT:mailto:self@example.com";
  const organizer = method === "REPLY" ? "self@example.com" : "organizer@example.com";
  const recurrence = input.recurrenceId ? `RECURRENCE-ID:${input.recurrenceId}\r\n` : "";
  return {
    accountId: "account-1",
    threadId: "thread-1",
    messageId: `message-${method}-${input.sequence ?? 1}`,
    senderEmail: input.sender ?? (method === "REPLY" ? "guest@example.com" : "organizer@example.com"),
    sourceHash: `fixture-${method}-${input.sequence ?? 1}`,
    icalData: [
      "BEGIN:VCALENDAR", `METHOD:${method}`, "BEGIN:VEVENT", "UID:uid-1",
      `SEQUENCE:${input.sequence ?? 1}`, "DTSTAMP:20260823T100000Z",
      `ORGANIZER:mailto:${organizer}`, attendee, recurrence.trimEnd(),
      "SUMMARY:Planning", "DTSTART:20261001T090000Z", "DTEND:20261001T100000Z",
      "END:VEVENT", "END:VCALENDAR",
    ].filter(Boolean).join("\r\n"),
  };
}

describe("iTIP lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.existingAction = null;
    state.latestAction = null;
    state.invitation = null;
    state.event = null;
  });

  it("automatically applies a new REQUEST with optional attendee semantics", async () => {
    const result = await ingestInboundItip(request());
    expect(result.status).toBe("applied");
    expect(upsertCalendarInvitation).toHaveBeenCalledWith(expect.objectContaining({ method: "REQUEST", sequence: 1 }));
    expect(upsertCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({ origin: "local_projection" }));
  });

  it("applies higher SEQUENCE and ignores stale REQUEST", async () => {
    state.latestAction = { sequence: 1, dtstamp: 1, source_fingerprint: "old" };
    expect((await ingestInboundItip(request({ sequence: 2 }))).status).toBe("applied");
    state.latestAction = { sequence: 3, dtstamp: 1, source_fingerprint: "newer" };
    expect((await ingestInboundItip(request({ sequence: 2 }))).status).toBe("stale");
    expect(updateCalendarItipAction).toHaveBeenCalledWith(expect.objectContaining({ processingStatus: "ignored_stale" }));
  });

  it("deduplicates a previously recorded deterministic action", async () => {
    state.existingAction = { action_key: "existing" };
    expect((await ingestInboundItip(request())).status).toBe("duplicate");
    expect(recordCalendarItipAction).not.toHaveBeenCalled();
  });

  it("quarantines sender/organizer mismatch without calendar mutation", async () => {
    const result = await ingestInboundItip(request({ sender: "attacker@example.com" }));
    expect(result.status).toBe("suspicious");
    expect(upsertCalendarInvitation).not.toHaveBeenCalled();
    expect(upsertCalendarEvent).not.toHaveBeenCalled();
  });

  it("isolates unknown REPLY without creating an event", async () => {
    const result = await ingestInboundItip(request({ method: "REPLY" }));
    expect(result.status).toBe("failed");
    expect(result.diagnostic).toBe("unknown-uid");
    expect(upsertCalendarEvent).not.toHaveBeenCalled();
  });

  it("cancels only the addressed occurrence projection", async () => {
    state.invitation = { sequence: 0, source_hash: "old" };
    const result = await ingestInboundItip(request({ method: "CANCEL", sequence: 2, recurrenceId: "20261008T090000Z" }));
    expect(result.status).toBe("applied");
    expect(removeCalendarProjection).toHaveBeenCalledWith("account-1", "invite:uid-1:20261008T090000Z");
  });

  it("allows outbound delivery only for organizer or explicit SENT-BY delegate", () => {
    const participant = (email: string) => ({ kind: "email" as const, value: email, normalizedEmail: email });
    expect(hasOrganizerDeliveryAuthority({ organizer: { participant: participant("self@example.com") } }, "self@example.com")).toBe(true);
    expect(hasOrganizerDeliveryAuthority({
      organizer: { participant: participant("owner@example.com"), sentBy: participant("self@example.com") },
    }, "self@example.com")).toBe(true);
    expect(hasOrganizerDeliveryAuthority({ organizer: { participant: participant("owner@example.com") } }, "self@example.com")).toBe(false);
    expect(hasOrganizerDeliveryAuthority({ organizer: null }, "self@example.com")).toBe(false);
    expect(hasOrganizerDeliveryAuthority({ organizer: null }, "self@example.com", true)).toBe(true);
  });
});
