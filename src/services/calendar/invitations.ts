import type { DbAttachment } from "@/services/db/attachments";
import {
  getCalendarInvitationById,
  updateInvitationQueueStatus,
  updateInvitationRsvp,
  upsertCalendarInvitation,
  type CalendarInvitationRsvpStatus,
  type DbCalendarInvitation,
} from "@/services/db/calendarInvitations";
import { enqueuePendingOperation } from "@/services/db/pendingOperations";
import {
  calendarProjectionKey,
  removeCalendarProjection,
  upsertCalendarEvent,
} from "@/services/db/calendarEvents";
import { parseICalendarInvite } from "./icalHelper";
import type { EmailProvider } from "@/services/email/types";

export type InvitationPayloadSource = "body" | "attachment";

export interface DetectInvitationInput {
  accountId: string;
  threadId: string;
  messageId: string;
  bodyText?: string | null;
  bodyHtml?: string | null;
}

export interface CalendarRsvpQueueParams {
  invitationId: string;
  rsvpStatus: CalendarInvitationRsvpStatus;
  eventUid: string;
  recurrenceKey: string;
}

const RSVP_STATUSES: CalendarInvitationRsvpStatus[] = [
  "needs_action",
  "accepted",
  "tentative",
  "declined",
];

export function extractICalendarPayloads(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = text.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/gi) ?? [];
  return matches.map((match) => match.trim()).filter(Boolean);
}

export function isCalendarAttachment(att: Pick<DbAttachment, "filename" | "mime_type">): boolean {
  const filename = att.filename?.toLowerCase() ?? "";
  const mimeType = att.mime_type?.toLowerCase() ?? "";
  return mimeType.includes("text/calendar") || filename.endsWith(".ics");
}

export async function upsertInvitationFromICalendar(input: {
  accountId: string;
  threadId: string;
  messageId: string;
  icalData: string;
  source: InvitationPayloadSource;
}): Promise<DbCalendarInvitation | null> {
  if (!input.icalData.includes("BEGIN:VEVENT")) return null;

  const parsed = parseICalendarInvite(input.icalData);
  const uid = parsed.event.uid?.trim();
  if (!uid) return null;

  return upsertCalendarInvitation({
    accountId: input.accountId,
    threadId: input.threadId,
    messageId: input.messageId,
    eventUid: uid,
    recurrenceId: parsed.recurrenceId,
    method: parsed.method,
    sequence: parsed.sequence,
    status: parsed.isCancelled ? "cancelled" : parsed.event.status,
    summary: parsed.event.summary,
    description: parsed.event.description,
    location: parsed.event.location,
    startTime: parsed.event.startTime,
    endTime: parsed.event.endTime,
    isAllDay: parsed.event.isAllDay,
    timezoneId: parsed.timezoneId,
    timezoneWarning: parsed.timezoneWarning,
    organizerEmail: parsed.event.organizerEmail,
    attendeesJson: parsed.event.attendeesJson,
    rawIcal: input.icalData,
    sourceHash: `${input.source}:${simpleHash(input.icalData)}`,
  });
}

export async function detectInvitationsInMessage(
  input: DetectInvitationInput,
): Promise<DbCalendarInvitation[]> {
  const payloads = [
    ...extractICalendarPayloads(input.bodyText),
    ...extractICalendarPayloads(input.bodyHtml),
  ];

  const results: DbCalendarInvitation[] = [];
  for (const icalData of dedupe(payloads)) {
    const invitation = await upsertInvitationFromICalendar({
      accountId: input.accountId,
      threadId: input.threadId,
      messageId: input.messageId,
      icalData,
      source: "body",
    });
    if (invitation) results.push(invitation);
  }
  return results;
}

export async function detectInvitationsFromAttachments(input: {
  accountId: string;
  threadId: string;
  messageId: string;
  attachments: DbAttachment[];
  provider: Pick<EmailProvider, "fetchAttachment">;
}): Promise<DbCalendarInvitation[]> {
  const results: DbCalendarInvitation[] = [];
  for (const att of input.attachments) {
    if (!isCalendarAttachment(att)) continue;
    const attachmentId = att.gmail_attachment_id ?? att.imap_part_id ?? null;
    if (!attachmentId) continue;

    const response = await input.provider.fetchAttachment(input.messageId, attachmentId);
    const decoded = decodeAttachmentData(response.data);
    for (const icalData of extractICalendarPayloads(decoded)) {
      const invitation = await upsertInvitationFromICalendar({
        accountId: input.accountId,
        threadId: input.threadId,
        messageId: input.messageId,
        icalData,
        source: "attachment",
      });
      if (invitation) results.push(invitation);
    }
  }
  return results;
}

export async function respondToCalendarInvitation(
  accountId: string,
  invitationId: string,
  rsvpStatus: CalendarInvitationRsvpStatus,
): Promise<{ queuedOperationId: string }> {
  if (!RSVP_STATUSES.includes(rsvpStatus) || rsvpStatus === "needs_action") {
    throw new Error(`Unsupported RSVP status: ${rsvpStatus}`);
  }

  const invitation = await getCalendarInvitationById(invitationId);
  if (!invitation) throw new Error(`Calendar invitation ${invitationId} not found`);

  if (rsvpStatus === "accepted" || rsvpStatus === "tentative") {
    await projectInvitationToCalendarEvent(accountId, invitation, rsvpStatus);
  }

  const queuedOperationId = await enqueuePendingOperation(
    accountId,
    "calendarRsvp",
    invitationId,
    {
      invitationId,
      rsvpStatus,
      eventUid: invitation.event_uid,
      recurrenceKey: invitation.recurrence_key,
    } satisfies CalendarRsvpQueueParams,
  );

  await updateInvitationRsvp(invitationId, rsvpStatus, "queued", queuedOperationId);
  emitInvitationChanged();
  return { queuedOperationId };
}

export async function executeCalendarQueuedAction(
  accountId: string,
  operationType: string,
  params: Record<string, unknown>,
): Promise<void> {
  void accountId;
  if (operationType !== "calendarRsvp") {
    throw new Error(`Unsupported calendar queue operation: ${operationType}`);
  }

  const invitationId = typeof params.invitationId === "string" ? params.invitationId : null;
  if (!invitationId) throw new Error("calendarRsvp requires invitationId");

  const eventUid = typeof params.eventUid === "string" ? params.eventUid : null;
  const recurrenceKey = typeof params.recurrenceKey === "string" ? params.recurrenceKey : "";
  if (eventUid) {
    await removeCalendarProjection(accountId, calendarProjectionKey(eventUid, recurrenceKey));
  }
  await updateInvitationQueueStatus(invitationId, "blocked");
  emitInvitationChanged();
  throw new Error("unsupported capability: remote calendar RSVP delivery is not implemented yet");
}

async function projectInvitationToCalendarEvent(
  accountId: string,
  invitation: DbCalendarInvitation,
  rsvpStatus: CalendarInvitationRsvpStatus,
): Promise<void> {
  if (invitation.start_time <= 0 || invitation.end_time <= 0) return;

  const eventId = calendarProjectionKey(invitation.event_uid, invitation.recurrence_key);
  await upsertCalendarEvent({
    accountId,
    googleEventId: eventId,
    summary: invitation.summary,
    description: invitation.description,
    location: invitation.location,
    startTime: invitation.start_time,
    endTime: invitation.end_time,
    isAllDay: invitation.is_all_day === 1,
    status: rsvpStatus === "tentative" ? "tentative" : invitation.status,
    organizerEmail: invitation.organizer_email,
    attendeesJson: invitation.attendees_json,
    htmlLink: null,
    calendarId: null,
    remoteEventId: eventId,
    etag: null,
    icalData: invitation.raw_ical,
    uid: invitation.event_uid,
    origin: "local_projection",
    projectionKey: eventId,
    projectionStatus: "pending",
  });
}

function decodeAttachmentData(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    return decodeURIComponent(escape(atob(padded)));
  } catch {
    return atob(padded);
  }
}

function simpleHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function emitInvitationChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("velo-calendar-invitations-changed"));
    window.dispatchEvent(new Event("velo-queue-changed"));
  }
}
