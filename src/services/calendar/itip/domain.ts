import { normalizeEmail } from "@/utils/emailUtils";

export type InvitationMethod = "REQUEST" | "REPLY" | "CANCEL";
export type InvitationDirection = "inbound" | "outbound";
export type InvitationProcessingStatus = "pending" | "applied" | "ignored_stale" | "suspicious" | "failed";
export type InvitationDeliveryStatus = "queued" | "delivering" | "retry_scheduled" | "delivered" | "failed" | "cancelled";

export interface CalendarInvitationMessage {
  accountId: string;
  direction: InvitationDirection;
  method: InvitationMethod;
  eventUid: string;
  recurrenceKey: string;
  sequence: number;
  dtstamp: number | null;
  participantKey: string;
  messageId: string | null;
  invitationId: string | null;
  calendarId: string | null;
  eventResourceKey: string | null;
  sourceFingerprint: string;
}

export interface InvitationDeliveryResult {
  actionKey: string;
  localState: "applied" | "unchanged";
  delivery: InvitationDeliveryStatus | null;
  failureCode?: string;
}

export function normalizeInvitationMethod(value: string | null | undefined): InvitationMethod | null {
  const method = value?.trim().toUpperCase();
  return method === "REQUEST" || method === "REPLY" || method === "CANCEL" ? method : null;
}

export function normalizedParticipantKey(value: string | null | undefined): string {
  if (!value) return "";
  const normalized = value.trim().replace(/^mailto:/i, "");
  return normalizeEmail(normalized) ?? normalized.toLowerCase();
}

export function invitationActionKey(message: CalendarInvitationMessage): string {
  return `itip:${stableHash([
    message.accountId,
    message.direction,
    message.method,
    message.eventUid,
    message.recurrenceKey,
    String(message.sequence),
    message.participantKey,
    message.sourceFingerprint,
  ].join("\u001f"))}`;
}

export function invitationSourceFingerprint(input: {
  method: InvitationMethod;
  eventUid: string;
  recurrenceKey?: string | null;
  sequence?: number | null;
  dtstamp?: number | null;
  participantKey?: string | null;
  sourceHash: string;
}): string {
  return stableHash([
    input.method,
    input.eventUid,
    input.recurrenceKey ?? "",
    String(input.sequence ?? 0),
    String(input.dtstamp ?? 0),
    input.participantKey ?? "",
    input.sourceHash,
  ].join("\u001f"));
}

export function validateInboundInvitationIdentity(input: {
  method: InvitationMethod;
  senderEmail: string | null;
  organizerEmail: string | null;
  currentAccountEmail: string;
  attendeeEmails: string[];
  replyingParticipantEmail?: string | null;
}): { trusted: true } | { trusted: false; code: "sender-organizer-mismatch" | "current-account-not-invited" | "reply-sender-mismatch" | "current-account-not-organizer" } {
  const sender = normalizedParticipantKey(input.senderEmail);
  const organizer = normalizedParticipantKey(input.organizerEmail);
  const current = normalizedParticipantKey(input.currentAccountEmail);
  const attendees = new Set(input.attendeeEmails.map(normalizedParticipantKey).filter(Boolean));

  if (input.method === "REQUEST" || input.method === "CANCEL") {
    if (!sender || !organizer || sender !== organizer) return { trusted: false, code: "sender-organizer-mismatch" };
    if (!attendees.has(current)) return { trusted: false, code: "current-account-not-invited" };
    return { trusted: true };
  }

  if (!organizer || organizer !== current) return { trusted: false, code: "current-account-not-organizer" };
  const replying = normalizedParticipantKey(input.replyingParticipantEmail);
  if (!sender || !replying || sender !== replying) return { trusted: false, code: "reply-sender-mismatch" };
  return { trusted: true };
}

export function compareInvitationVersion(
  incoming: { sequence: number; dtstamp: number | null; sourceFingerprint: string },
  current: { sequence: number; dtstamp: number | null; source_fingerprint: string } | null,
): "newer" | "duplicate" | "stale" {
  if (!current) return "newer";
  if (incoming.sequence !== current.sequence) return incoming.sequence > current.sequence ? "newer" : "stale";
  if (incoming.sourceFingerprint === current.source_fingerprint) return "duplicate";
  return (incoming.dtstamp ?? 0) > (current.dtstamp ?? 0) ? "newer" : "stale";
}

function stableHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}
