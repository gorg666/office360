import { describe, expect, it } from "vitest";
import {
  compareInvitationVersion,
  invitationActionKey,
  normalizedParticipantKey,
  validateInboundInvitationIdentity,
  type CalendarInvitationMessage,
} from "./domain";

const message: CalendarInvitationMessage = {
  accountId: "account-1",
  direction: "inbound",
  method: "REQUEST",
  eventUid: "uid-1",
  recurrenceKey: "",
  sequence: 2,
  dtstamp: 10,
  participantKey: "user@example.com",
  messageId: "message-1",
  invitationId: null,
  calendarId: null,
  eventResourceKey: null,
  sourceFingerprint: "source-1",
};

describe("iTIP domain", () => {
  it("uses a deterministic action identity independent of Message-ID", () => {
    expect(invitationActionKey(message)).toBe(invitationActionKey({ ...message, messageId: "copy" }));
    expect(invitationActionKey(message)).not.toBe(invitationActionKey({ ...message, sequence: 3 }));
  });

  it("normalizes MAILTO identity without provider-specific alias merging", () => {
    expect(normalizedParticipantKey(" MAILTO:User@Example.COM ")).toBe("user@example.com");
    expect(normalizedParticipantKey("user+tag@example.com")).not.toBe(normalizedParticipantKey("user@example.com"));
  });

  it("trusts REQUEST/CANCEL only when sender is organizer and account is invited", () => {
    expect(validateInboundInvitationIdentity({
      method: "REQUEST",
      senderEmail: "organizer@example.com",
      organizerEmail: "ORGANIZER@example.com",
      currentAccountEmail: "self@example.com",
      attendeeEmails: ["SELF@example.com"],
    })).toEqual({ trusted: true });
    expect(validateInboundInvitationIdentity({
      method: "CANCEL",
      senderEmail: "attacker@example.com",
      organizerEmail: "organizer@example.com",
      currentAccountEmail: "self@example.com",
      attendeeEmails: ["self@example.com"],
    })).toEqual({ trusted: false, code: "sender-organizer-mismatch" });
  });

  it("trusts REPLY only for organizer account and matching reply sender", () => {
    expect(validateInboundInvitationIdentity({
      method: "REPLY",
      senderEmail: "guest@example.com",
      organizerEmail: "self@example.com",
      currentAccountEmail: "self@example.com",
      attendeeEmails: ["guest@example.com"],
      replyingParticipantEmail: "GUEST@example.com",
    })).toEqual({ trusted: true });
  });

  it("orders sequence first, then DTSTAMP, and deduplicates the same fingerprint", () => {
    const current = { sequence: 4, dtstamp: 20, source_fingerprint: "same" };
    expect(compareInvitationVersion({ sequence: 3, dtstamp: 100, sourceFingerprint: "other" }, current)).toBe("stale");
    expect(compareInvitationVersion({ sequence: 4, dtstamp: 20, sourceFingerprint: "same" }, current)).toBe("duplicate");
    expect(compareInvitationVersion({ sequence: 4, dtstamp: 21, sourceFingerprint: "other" }, current)).toBe("newer");
  });
});
