import { getDb, selectFirstBy } from "./connection";

export type CalendarInvitationRsvpStatus = "needs_action" | "accepted" | "tentative" | "declined";
export type CalendarInvitationQueueStatus = "queued" | "delivered" | "blocked" | "failed" | null;

export interface DbCalendarInvitation {
  id: string;
  account_id: string;
  thread_id: string;
  message_id: string;
  event_uid: string;
  recurrence_id: string | null;
  recurrence_key: string;
  method: string | null;
  sequence: number;
  status: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  start_time: number;
  end_time: number;
  is_all_day: number;
  timezone_id: string | null;
  timezone_warning: number;
  organizer_email: string | null;
  attendees_json: string | null;
  rsvp_status: CalendarInvitationRsvpStatus;
  rsvp_queue_status: CalendarInvitationQueueStatus;
  queued_operation_id: string | null;
  calendar_event_id: string | null;
  raw_ical: string;
  source_hash: string;
  created_at: number;
  updated_at: number;
}

export interface UpsertCalendarInvitationInput {
  accountId: string;
  threadId: string;
  messageId: string;
  eventUid: string;
  recurrenceId?: string | null;
  method?: string | null;
  sequence?: number;
  status?: string | null;
  summary?: string | null;
  description?: string | null;
  location?: string | null;
  startTime?: number;
  endTime?: number;
  isAllDay?: boolean;
  timezoneId?: string | null;
  timezoneWarning?: boolean;
  organizerEmail?: string | null;
  attendeesJson?: string | null;
  rawIcal: string;
  sourceHash: string;
}

function recurrenceKey(recurrenceId?: string | null): string {
  return recurrenceId?.trim() ?? "";
}

export async function getCalendarInvitationById(id: string): Promise<DbCalendarInvitation | null> {
  return selectFirstBy<DbCalendarInvitation>(
    "SELECT * FROM calendar_invitations WHERE id = $1",
    [id],
  );
}

export async function upsertCalendarInvitation(
  input: UpsertCalendarInvitationInput,
): Promise<DbCalendarInvitation> {
  const db = await getDb();
  const key = recurrenceKey(input.recurrenceId);
  const existing = await selectFirstBy<DbCalendarInvitation>(
    `SELECT * FROM calendar_invitations
     WHERE account_id = $1 AND event_uid = $2 AND recurrence_key = $3`,
    [input.accountId, input.eventUid, key],
  );

  const nextSequence = input.sequence ?? 0;
  if (existing && existing.sequence > nextSequence) {
    return existing;
  }

  const id = existing?.id ?? crypto.randomUUID();
  await db.execute(
    `INSERT INTO calendar_invitations (
       id, account_id, thread_id, message_id, event_uid, recurrence_id, recurrence_key,
       method, sequence, status, summary, description, location, start_time, end_time,
       is_all_day, timezone_id, timezone_warning, organizer_email, attendees_json,
       raw_ical, source_hash
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12, $13, $14, $15,
       $16, $17, $18, $19, $20,
       $21, $22
     )
     ON CONFLICT(account_id, event_uid, recurrence_key) DO UPDATE SET
       thread_id = $3,
       message_id = $4,
       recurrence_id = $6,
       method = $8,
       sequence = $9,
       status = $10,
       summary = $11,
       description = $12,
       location = $13,
       start_time = $14,
       end_time = $15,
       is_all_day = $16,
       timezone_id = $17,
       timezone_warning = $18,
       organizer_email = $19,
       attendees_json = $20,
       raw_ical = $21,
       source_hash = $22,
       updated_at = unixepoch()`,
    [
      id,
      input.accountId,
      input.threadId,
      input.messageId,
      input.eventUid,
      input.recurrenceId ?? null,
      key,
      input.method ?? null,
      nextSequence,
      input.status ?? "confirmed",
      input.summary ?? null,
      input.description ?? null,
      input.location ?? null,
      input.startTime ?? 0,
      input.endTime ?? 0,
      input.isAllDay ? 1 : 0,
      input.timezoneId ?? null,
      input.timezoneWarning ? 1 : 0,
      input.organizerEmail ?? null,
      input.attendeesJson ?? null,
      input.rawIcal,
      input.sourceHash,
    ],
  );

  return (await getCalendarInvitationById(id))!;
}

export async function listInvitationsForThread(
  accountId: string,
  threadId: string,
): Promise<DbCalendarInvitation[]> {
  const db = await getDb();
  return db.select<DbCalendarInvitation[]>(
    `SELECT * FROM calendar_invitations
     WHERE account_id = $1 AND thread_id = $2
     ORDER BY updated_at DESC, sequence DESC`,
    [accountId, threadId],
  );
}

export async function updateInvitationRsvp(
  invitationId: string,
  rsvpStatus: CalendarInvitationRsvpStatus,
  queueStatus: CalendarInvitationQueueStatus,
  queuedOperationId?: string | null,
  attendeesJson?: string | null,
): Promise<void> {
  const db = await getDb();
  if (attendeesJson === undefined) {
    await db.execute(
      `UPDATE calendar_invitations
       SET rsvp_status = $1, rsvp_queue_status = $2, queued_operation_id = $3, updated_at = unixepoch()
       WHERE id = $4`,
      [rsvpStatus, queueStatus, queuedOperationId ?? null, invitationId],
    );
    return;
  }
  await db.execute(
    `UPDATE calendar_invitations
     SET rsvp_status = $1,
         rsvp_queue_status = $2,
         queued_operation_id = $3,
         attendees_json = $4,
         updated_at = unixepoch()
     WHERE id = $5`,
    [rsvpStatus, queueStatus, queuedOperationId ?? null, attendeesJson ?? null, invitationId],
  );
}

export async function updateInvitationQueueStatus(
  invitationId: string,
  queueStatus: CalendarInvitationQueueStatus,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE calendar_invitations
     SET rsvp_queue_status = $1,
         updated_at = unixepoch()
     WHERE id = $2`,
    [queueStatus, invitationId],
  );
}
