import { getAccountIdentity } from "@/services/db/accounts";
import {
  getCalendarInvitationByIdentity,
  upsertCalendarInvitation,
  updateInvitationQueueStatus,
  type CalendarInvitationRsvpStatus,
  type DbCalendarInvitation,
} from "@/services/db/calendarInvitations";
import {
  getCalendarItipAction,
  getLatestAppliedItipAction,
  recordCalendarItipAction,
  updateCalendarItipAction,
} from "@/services/db/calendarItipActions";
import {
  calendarProjectionKey,
  getCalendarEventByUid,
  removeCalendarProjection,
  upsertCalendarEvent,
  type DbCalendarEvent,
} from "@/services/db/calendarEvents";
import { getCalendarById } from "@/services/db/calendars";
import { enqueueItipSendOperation } from "@/services/db/pendingOperations";
import { buildRawEmail } from "@/utils/emailBuilder";
import {
  parseCalendarParticipants,
  serializeCalendarParticipants,
  withAttendeeStatus,
  recurrenceRuleFromICalendar,
  type AttendanceStatus,
} from "../domain";
import { parseICalendarInvite, generateVEvent } from "../icalHelper";
import { CalendarMutationService, type CalendarMutationTarget, type CalendarWriteResult } from "../calendarMutationService";
import type { CalendarEventData, CalendarParticipationStatus, CreateEventInput } from "../types";
import { prepareItipCalendar, utf8Base64 } from "./codec";
import {
  compareInvitationVersion,
  invitationActionKey,
  invitationSourceFingerprint,
  normalizeInvitationMethod,
  normalizedParticipantKey,
  validateInboundInvitationIdentity,
  type CalendarInvitationMessage,
  type InvitationMethod,
} from "./domain";

export interface InboundItipInput {
  accountId: string;
  threadId: string;
  messageId: string;
  senderEmail: string | null;
  icalData: string;
  sourceHash: string;
}

export interface InboundItipResult {
  status: "applied" | "duplicate" | "stale" | "suspicious" | "failed";
  actionKey: string | null;
  invitation: DbCalendarInvitation | null;
  diagnostic?: string;
}

const inboundAccountChains = new Map<string, Promise<void>>();

export type InvitationEventEnvelope = Pick<CalendarEventData,
  | "remoteEventId" | "uid" | "summary" | "description" | "location"
  | "startTime" | "endTime" | "isAllDay" | "status" | "organizer"
  | "attendees" | "icalData" | "occurrenceKey" | "sequence" | "transparency"
  | "recurrenceRule"
> & { time?: CalendarEventData["time"]; reminders?: CalendarEventData["reminders"] };

export async function ingestInboundItip(input: InboundItipInput): Promise<InboundItipResult> {
  const previous = inboundAccountChains.get(input.accountId) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(() => ingestInboundItipNow(input));
  const tail = task.then(() => undefined, () => undefined);
  inboundAccountChains.set(input.accountId, tail);
  try {
    return await task;
  } finally {
    if (inboundAccountChains.get(input.accountId) === tail) inboundAccountChains.delete(input.accountId);
  }
}

async function ingestInboundItipNow(input: InboundItipInput): Promise<InboundItipResult> {
  let parsed: ReturnType<typeof parseICalendarInvite>;
  try {
    parsed = parseICalendarInvite(input.icalData);
  } catch {
    return { status: "failed", actionKey: null, invitation: null, diagnostic: "malformed-itip" };
  }
  const method = normalizeInvitationMethod(parsed.method);
  const uid = parsed.event.uid?.trim();
  if (!method || !uid) return { status: "failed", actionKey: null, invitation: null, diagnostic: "unsupported-method-or-uid" };

  const identity = await getAccountIdentity(input.accountId);
  if (!identity) return { status: "failed", actionKey: null, invitation: null, diagnostic: "unknown-account" };
  const replying = method === "REPLY"
    ? parsed.attendees.find((attendee) => normalizedParticipantKey(attendee.email) === normalizedParticipantKey(input.senderEmail))
    : null;
  const security = validateInboundInvitationIdentity({
    method,
    senderEmail: input.senderEmail,
    organizerEmail: parsed.event.organizerEmail,
    currentAccountEmail: identity.email,
    attendeeEmails: parsed.attendees.map((attendee) => attendee.email),
    replyingParticipantEmail: replying?.email,
  });
  const participantKey = method === "REPLY"
    ? normalizedParticipantKey(replying?.email)
    : normalizedParticipantKey(identity.email);
  const recurrenceKey = parsed.recurrenceId?.trim() ?? "";
  const sourceFingerprint = invitationSourceFingerprint({
    method, eventUid: uid, recurrenceKey, sequence: parsed.sequence,
    dtstamp: parsed.dtstamp, participantKey, sourceHash: input.sourceHash,
  });
  const message: CalendarInvitationMessage = {
    accountId: input.accountId,
    direction: "inbound",
    method,
    eventUid: uid,
    recurrenceKey,
    sequence: parsed.sequence,
    dtstamp: parsed.dtstamp,
    participantKey,
    messageId: input.messageId,
    invitationId: null,
    calendarId: null,
    eventResourceKey: null,
    sourceFingerprint,
  };
  const actionKey = invitationActionKey(message);
  const existingAction = await getCalendarItipAction(actionKey);
  if (existingAction) return { status: "duplicate", actionKey, invitation: null };
  const { action, created } = await recordCalendarItipAction(message, security.trusted ? "pending" : "suspicious");
  if (!created) return { status: "duplicate", actionKey, invitation: null };
  if (!security.trusted) {
    await updateCalendarItipAction({ actionKey, failureCode: security.code });
    return { status: "suspicious", actionKey, invitation: null, diagnostic: security.code };
  }

  const latest = await getLatestAppliedItipAction({
    accountId: input.accountId,
    eventUid: uid,
    recurrenceKey,
    ...(method === "REPLY" ? { method, participantKey } : {}),
  });
  const legacyInvitation = await getCalendarInvitationByIdentity(input.accountId, uid, parsed.recurrenceId);
  const comparison = compareInvitationVersion(
    { sequence: parsed.sequence, dtstamp: parsed.dtstamp, sourceFingerprint },
    latest ?? (legacyInvitation ? {
      sequence: legacyInvitation.sequence,
      dtstamp: null,
      source_fingerprint: legacyInvitation.source_hash,
    } : null),
  );
  if (comparison !== "newer") {
    await updateCalendarItipAction({ actionKey, processingStatus: "ignored_stale", failureCode: comparison });
    return { status: comparison === "duplicate" ? "duplicate" : "stale", actionKey, invitation: legacyInvitation };
  }

  try {
    if (method === "REPLY") {
      await applyOrganizerReply(input.accountId, uid, parsed.recurrenceIdTime, replying?.email ?? "", replying?.responseStatus ?? "");
      await updateCalendarItipAction({ actionKey, processingStatus: "applied", appliedAt: nowSeconds() });
      return { status: "applied", actionKey, invitation: legacyInvitation };
    }
    if (method === "CANCEL" && !legacyInvitation && !(await getCalendarEventByUid(input.accountId, uid, parsed.recurrenceIdTime))) {
      await updateCalendarItipAction({ actionKey, processingStatus: "failed", failureCode: "unknown-uid" });
      return { status: "failed", actionKey, invitation: null, diagnostic: "unknown-uid" };
    }

    const invitation = await upsertCalendarInvitation({
      accountId: input.accountId,
      threadId: input.threadId,
      messageId: input.messageId,
      eventUid: uid,
      recurrenceId: parsed.recurrenceId,
      method,
      sequence: parsed.sequence,
      status: method === "CANCEL" ? "cancelled" : parsed.event.status,
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
      sourceHash: sourceFingerprint,
    });
    await updateCalendarItipAction({ actionKey, invitationId: invitation.id });
    if (method === "CANCEL") {
      await applyInboundCancel(input.accountId, uid, recurrenceKey, parsed.recurrenceIdTime, parsed.sequence);
    } else {
      await projectInvitation(input.accountId, invitation, "needs_action");
    }
    await updateCalendarItipAction({ actionKey, processingStatus: "applied", appliedAt: nowSeconds() });
    return { status: "applied", actionKey: action.action_key, invitation };
  } catch (error) {
    await updateCalendarItipAction({ actionKey, processingStatus: "failed", failureCode: safeFailureCode(error) });
    return { status: "failed", actionKey, invitation: legacyInvitation, diagnostic: safeFailureCode(error) };
  }
}

export async function queueInvitationReply(input: {
  accountId: string;
  invitation: DbCalendarInvitation;
  status: CalendarParticipationStatus;
}): Promise<{ actionKey: string; pendingOperationId: string }> {
  const identity = await getAccountIdentity(input.accountId);
  if (!identity || !input.invitation.organizer_email) throw new Error("Invitation delivery identity is incomplete");
  const sequence = input.invitation.sequence;
  const source = prepareItipCalendar({
    source: input.invitation.raw_ical,
    method: "REPLY",
    sequence,
    recurrenceId: input.invitation.recurrence_id,
    replyingParticipant: { email: identity.email, status: input.status },
  });
  return queueItipMail({
    accountId: input.accountId,
    invitationId: input.invitation.id,
    method: "REPLY",
    eventUid: input.invitation.event_uid,
    recurrenceKey: input.invitation.recurrence_key,
    sequence,
    participantKey: normalizedParticipantKey(identity.email),
    recipient: input.invitation.organizer_email,
    from: identity.email,
    subject: `Re: ${input.invitation.summary ?? "Calendar invitation"}`,
    icalData: source,
    eventResourceKey: input.invitation.calendar_event_id,
  });
}

export async function respondToCalendarEventInvitation(input: {
  target: Omit<CalendarMutationTarget, "isRecurring" | "recurrenceScope">;
  event: DbCalendarEvent;
  attendeeEmail: string;
  status: CalendarParticipationStatus;
}): Promise<CalendarWriteResult<void>> {
  const result = await new CalendarMutationService().respond(input.target, input.attendeeEmail, input.status);
  if (result.status !== "success") return result;
  const uid = input.event.uid?.trim();
  if (!uid) return { status: "partial", message: "Ответ доставлен, но событие не содержит UID для локальной сверки." };

  const participants = parseCalendarParticipants(input.event.attendees_json, input.event.organizer_email);
  const current = participants.attendees.find((attendee) =>
    normalizedParticipantKey(attendee.participant.normalizedEmail ?? attendee.participant.value)
      === normalizedParticipantKey(input.attendeeEmail));
  if (current) {
    const updated = withAttendeeStatus(participants.attendees, current.participant, input.status);
    await upsertCalendarEvent(dbEventToUpsert(
      input.event,
      serializeCalendarParticipants({ ...participants, attendees: updated }),
      input.event.status ?? "confirmed",
    ));
  }

  const participantKey = normalizedParticipantKey(input.attendeeEmail);
  const sourceFingerprint = invitationSourceFingerprint({
    method: "REPLY",
    eventUid: uid,
    recurrenceKey: input.event.occurrence_key ?? "",
    sequence: input.event.sequence,
    participantKey,
    sourceHash: compactHash([uid, input.event.occurrence_key ?? "", input.event.sequence, participantKey, input.status].join("\u001f")),
  });
  const { action } = await recordCalendarItipAction({
    accountId: input.target.accountId,
    direction: "outbound",
    method: "REPLY",
    eventUid: uid,
    recurrenceKey: input.event.occurrence_key ?? "",
    sequence: input.event.sequence,
    dtstamp: nowSeconds(),
    participantKey,
    messageId: null,
    invitationId: null,
    calendarId: input.event.calendar_id,
    eventResourceKey: input.event.remote_event_id,
    sourceFingerprint,
  }, "applied");
  await updateCalendarItipAction({
    actionKey: action.action_key,
    processingStatus: "applied",
    deliveryStatus: "delivered",
    appliedAt: nowSeconds(),
    deliveredAt: nowSeconds(),
  });
  return result;
}

export async function queueEventInvitationDeliveries(input: {
  accountId: string;
  method: "REQUEST" | "CANCEL";
  event: InvitationEventEnvelope;
  calendarId?: string | null;
  recipients?: string[];
  sequence?: number;
  recurrenceId?: string | null;
  recurrenceTzid?: string | null;
  /** Only a newly-created event may infer a missing organizer from the owning account. */
  allowMissingOrganizer?: boolean;
}): Promise<string[]> {
  const identity = await getAccountIdentity(input.accountId);
  if (!identity || !input.event.uid) return [];
  if (!hasOrganizerDeliveryAuthority(input.event, identity.email, input.allowMissingOrganizer === true)) return [];
  const participants = input.event.attendees;
  const recipients = input.recipients ?? participants
    .map((attendee) => attendee.participant.normalizedEmail ?? attendee.participant.value)
    .filter((email) => normalizedParticipantKey(email) !== normalizedParticipantKey(identity.email));
  const source = input.event.icalData ?? generateVEvent(eventToCreateInput(input.event), input.event.uid);
  const icalData = prepareItipCalendar({
    source,
    method: input.method,
    sequence: input.sequence ?? input.event.sequence,
    recurrenceId: input.recurrenceId ?? null,
    recurrenceTzid: input.recurrenceTzid ?? null,
    organizerEmail: identity.email,
  });
  const actionKeys: string[] = [];
  for (const recipient of [...new Set(recipients.map(normalizedParticipantKey).filter(Boolean))]) {
    const queued = await queueItipMail({
      accountId: input.accountId,
      invitationId: null,
      calendarId: input.calendarId ?? null,
      method: input.method,
      eventUid: input.event.uid,
      recurrenceKey: input.event.occurrenceKey ?? "",
      sequence: input.sequence ?? input.event.sequence,
      participantKey: recipient,
      recipient,
      from: identity.email,
      subject: `${input.method === "CANCEL" ? "Cancelled: " : "Invitation: "}${input.event.summary ?? "Calendar event"}`,
      icalData,
      eventResourceKey: input.event.remoteEventId,
    });
    actionKeys.push(queued.actionKey);
  }
  return actionKeys;
}

/** Outbound iTIP may only impersonate the organizer or an explicit SENT-BY delegate. */
export function hasOrganizerDeliveryAuthority(
  event: Pick<InvitationEventEnvelope, "organizer">,
  accountEmail: string,
  allowMissingOrganizer = false,
): boolean {
  const organizer = event.organizer;
  if (!organizer) return allowMissingOrganizer;
  const accountKey = normalizedParticipantKey(accountEmail);
  return [organizer.participant, organizer.sentBy]
    .filter((participant): participant is NonNullable<typeof participant> => Boolean(participant))
    .some((participant) => normalizedParticipantKey(participant.normalizedEmail ?? participant.value) === accountKey);
}

export function invitationEnvelopeFromDbEvent(event: DbCalendarEvent): InvitationEventEnvelope {
  const participants = parseCalendarParticipants(event.attendees_json, event.organizer_email);
  return {
    remoteEventId: event.remote_event_id ?? event.google_event_id,
    uid: event.uid,
    summary: event.summary,
    description: event.description,
    location: event.location,
    startTime: event.start_time,
    endTime: event.end_time,
    isAllDay: event.is_all_day === 1,
    status: event.status ?? "confirmed",
    organizer: participants.organizer,
    attendees: participants.attendees,
    icalData: event.ical_data,
    occurrenceKey: event.occurrence_key,
    sequence: event.sequence,
    transparency: event.transp,
    recurrenceRule: recurrenceRuleFromICalendar(event.ical_data),
  };
}

async function queueItipMail(input: {
  accountId: string;
  invitationId: string | null;
  calendarId?: string | null;
  method: InvitationMethod;
  eventUid: string;
  recurrenceKey: string;
  sequence: number;
  participantKey: string;
  recipient: string;
  from: string;
  subject: string;
  icalData: string;
  eventResourceKey?: string | null;
}): Promise<{ actionKey: string; pendingOperationId: string }> {
  const sourceFingerprint = invitationSourceFingerprint({
    method: input.method,
    eventUid: input.eventUid,
    recurrenceKey: input.recurrenceKey,
    sequence: input.sequence,
    participantKey: input.participantKey,
    // Generated DTSTAMP changes between attempts. Durable idempotency is based on
    // the semantic delivery tuple, not on byte-for-byte generated MIME content.
    sourceHash: compactHash([
      input.method,
      input.eventUid,
      input.recurrenceKey,
      input.sequence,
      input.participantKey,
    ].join("\u001f")),
  });
  const message: CalendarInvitationMessage = {
    accountId: input.accountId,
    direction: "outbound",
    method: input.method,
    eventUid: input.eventUid,
    recurrenceKey: input.recurrenceKey,
    sequence: input.sequence,
    dtstamp: nowSeconds(),
    participantKey: input.participantKey,
    messageId: null,
    invitationId: input.invitationId,
    calendarId: input.calendarId ?? null,
    eventResourceKey: input.eventResourceKey ?? null,
    sourceFingerprint,
  };
  const { action } = await recordCalendarItipAction(message, "applied");
  if (action.delivery_status === "delivered" || action.delivery_status === "queued"
    || action.delivery_status === "delivering" || action.delivery_status === "retry_scheduled") {
    return { actionKey: action.action_key, pendingOperationId: action.pending_operation_id ?? action.action_key };
  }
  const rawBase64Url = buildRawEmail({
    from: input.from,
    to: [input.recipient],
    subject: input.subject,
    htmlBody: "<p>Calendar invitation attached.</p>",
    attachments: [{
      filename: "invite.ics",
      mimeType: `text/calendar; method=${input.method}; charset=UTF-8`,
      content: utf8Base64(input.icalData),
    }],
  });
  const pendingOperationId = await enqueueItipSendOperation(input.accountId, action.action_key, {
    rawBase64Url,
    itipActionKey: action.action_key,
    ...(input.invitationId ? { itipInvitationId: input.invitationId } : {}),
  });
  await updateCalendarItipAction({
    actionKey: action.action_key,
    deliveryStatus: "queued",
    pendingOperationId,
    appliedAt: nowSeconds(),
  });
  if (input.invitationId) await updateInvitationQueueStatus(input.invitationId, "queued");
  return { actionKey: action.action_key, pendingOperationId };
}

async function applyOrganizerReply(
  accountId: string,
  uid: string,
  occurrenceStart: number | null,
  attendeeEmail: string,
  responseStatus: string,
): Promise<void> {
  const event = await getCalendarEventByUid(accountId, uid, occurrenceStart);
  if (!event) throw new Error("unknown-uid");
  const normalizedStatus = rsvpStatus(responseStatus);
  if (!normalizedStatus) throw new Error("invalid-partstat");
  const participantSet = parseCalendarParticipants(event.attendees_json, event.organizer_email);
  const attendee = participantSet.attendees.find((item) =>
    normalizedParticipantKey(item.participant.normalizedEmail ?? item.participant.value) === normalizedParticipantKey(attendeeEmail));
  if (!attendee) throw new Error("unknown-attendee");
  const attendees = withAttendeeStatus(participantSet.attendees, attendee.participant, normalizedStatus);
  const attendeesJson = serializeCalendarParticipants({ ...participantSet, attendees });
  if (event.calendar_id && event.remote_event_id) {
    const calendar = await getCalendarById(event.calendar_id);
    if (!calendar) throw new Error("unknown-calendar");
    if (occurrenceStart !== null && (!event.occurrence_key || !event.series_uid)) {
      throw new Error("missing-occurrence-identity");
    }
    const result = await new CalendarMutationService().update({
      accountId,
      calendarRemoteId: calendar.remote_id,
      remoteEventId: event.remote_event_id,
      etag: event.etag ?? undefined,
      baseSequence: undefined,
      suppressInvitationDelivery: true,
      ...(occurrenceStart !== null ? {
        isRecurring: true,
        recurrenceScope: "single" as const,
        seriesUid: event.series_uid!,
        occurrenceKey: event.occurrence_key!,
      } : {}),
    }, {
      attendees,
      organizer: participantSet.organizer ?? undefined,
      sequence: event.sequence,
    });
    if (result.status !== "success") throw new Error(result.status);
    return;
  }
  await upsertCalendarEvent(dbEventToUpsert(event, attendeesJson, event.status ?? "confirmed"));
}

async function applyInboundCancel(
  accountId: string,
  uid: string,
  recurrenceKey: string,
  occurrenceStart: number | null,
  sequence: number,
): Promise<void> {
  const event = await getCalendarEventByUid(accountId, uid, occurrenceStart);
  if (event?.calendar_id && event.remote_event_id) {
    const calendar = await getCalendarById(event.calendar_id);
    if (calendar) {
      if (occurrenceStart !== null && (!event.occurrence_key || !event.series_uid)) {
        throw new Error("missing-occurrence-identity");
      }
      const result = await new CalendarMutationService().update({
        accountId,
        calendarRemoteId: calendar.remote_id,
        remoteEventId: event.remote_event_id,
        etag: event.etag ?? undefined,
        suppressInvitationDelivery: true,
        ...(occurrenceStart !== null ? {
          isRecurring: true,
          recurrenceScope: "single" as const,
          seriesUid: event.series_uid!,
          occurrenceKey: event.occurrence_key!,
        } : {}),
      }, { status: "cancelled", sequence: Math.max(event.sequence, sequence) });
      if (result.status !== "success") throw new Error(result.status);
      return;
    }
  }
  await removeCalendarProjection(accountId, calendarProjectionKey(uid, recurrenceKey));
}

async function projectInvitation(accountId: string, invitation: DbCalendarInvitation, rsvp: CalendarInvitationRsvpStatus): Promise<void> {
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
    status: rsvp === "tentative" ? "tentative" : invitation.status,
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
    sequence: invitation.sequence,
  });
}

function dbEventToUpsert(event: DbCalendarEvent, attendeesJson: string | null, status: string) {
  return {
    accountId: event.account_id,
    googleEventId: event.google_event_id,
    summary: event.summary,
    description: event.description,
    location: event.location,
    startTime: event.start_time,
    endTime: event.end_time,
    isAllDay: event.is_all_day === 1,
    status,
    organizerEmail: event.organizer_email,
    attendeesJson,
    htmlLink: event.html_link,
    calendarId: event.calendar_id,
    remoteEventId: event.remote_event_id,
    etag: event.etag,
    icalData: event.ical_data,
    uid: event.uid,
    seriesUid: event.series_uid,
    occurrenceKey: event.occurrence_key,
    isRecurrenceMaster: event.is_recurrence_master === 1,
    transparency: event.transp,
    sequence: event.sequence,
    origin: (event.origin ?? "remote") as "remote" | "local_projection",
    projectionKey: event.projection_key,
    projectionStatus: event.projection_status,
    remindersJson: event.reminders_json,
  };
}

function eventToCreateInput(event: InvitationEventEnvelope): CreateEventInput {
  return {
    summary: event.summary ?? "Calendar event",
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    startTime: new Date(event.startTime * 1000).toISOString(),
    endTime: new Date(event.endTime * 1000).toISOString(),
    isAllDay: event.isAllDay,
    attendees: event.attendees,
    organizer: event.organizer ?? undefined,
    time: event.time,
    transparency: event.transparency ?? undefined,
    status: event.status,
    sequence: event.sequence,
    reminders: event.reminders,
    recurrenceRule: event.recurrenceRule ?? undefined,
  };
}

function rsvpStatus(value: string): AttendanceStatus | null {
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  return normalized === "accepted" || normalized === "tentative" || normalized === "declined" || normalized === "delegated"
    ? normalized
    : null;
}

function compactHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

function safeFailureCode(error: unknown): string {
  const value = error instanceof Error ? error.message : "itip-processing-failed";
  return value.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase().slice(0, 96) || "itip-processing-failed";
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
