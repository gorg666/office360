import { getDb, selectFirstBy } from "./connection";
import type {
  CalendarInvitationMessage,
  InvitationDeliveryStatus,
  InvitationProcessingStatus,
} from "@/services/calendar/itip/domain";
import { invitationActionKey } from "@/services/calendar/itip/domain";

export interface DbCalendarItipAction {
  action_key: string;
  account_id: string;
  invitation_id: string | null;
  calendar_id: string | null;
  direction: "inbound" | "outbound";
  method: "REQUEST" | "REPLY" | "CANCEL";
  event_uid: string;
  recurrence_key: string;
  sequence: number;
  dtstamp: number | null;
  participant_key: string;
  event_resource_key: string | null;
  message_id: string | null;
  source_fingerprint: string;
  pending_operation_id: string | null;
  processing_status: InvitationProcessingStatus;
  delivery_status: InvitationDeliveryStatus | null;
  failure_code: string | null;
  applied_at: number | null;
  delivered_at: number | null;
  created_at: number;
  updated_at: number;
}

export async function recordCalendarItipAction(
  message: CalendarInvitationMessage,
  processingStatus: InvitationProcessingStatus = "pending",
): Promise<{ action: DbCalendarItipAction; created: boolean }> {
  const db = await getDb();
  const actionKey = invitationActionKey(message);
  const result = await db.execute(
    `INSERT OR IGNORE INTO calendar_itip_actions (
       action_key, account_id, invitation_id, calendar_id, direction, method,
       event_uid, recurrence_key, sequence, dtstamp, participant_key,
       event_resource_key, message_id, source_fingerprint, processing_status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      actionKey, message.accountId, message.invitationId, message.calendarId,
      message.direction, message.method, message.eventUid, message.recurrenceKey,
      message.sequence, message.dtstamp, message.participantKey,
      message.eventResourceKey, message.messageId, message.sourceFingerprint,
      processingStatus,
    ],
  );
  return { action: (await getCalendarItipAction(actionKey))!, created: result.rowsAffected > 0 };
}

export function getCalendarItipAction(actionKey: string): Promise<DbCalendarItipAction | null> {
  return selectFirstBy<DbCalendarItipAction>(
    "SELECT * FROM calendar_itip_actions WHERE action_key = $1",
    [actionKey],
  );
}

export function getLatestAppliedItipAction(input: {
  accountId: string;
  eventUid: string;
  recurrenceKey: string;
  method?: "REQUEST" | "REPLY" | "CANCEL";
  participantKey?: string;
}): Promise<DbCalendarItipAction | null> {
  const methodFilter = input.method ? "AND method = $4" : "";
  const participantFilter = input.participantKey !== undefined
    ? `AND participant_key = $${input.method ? 5 : 4}`
    : "";
  return selectFirstBy<DbCalendarItipAction>(
    `SELECT * FROM calendar_itip_actions
     WHERE account_id = $1 AND event_uid = $2 AND recurrence_key = $3
       AND processing_status = 'applied' ${methodFilter} ${participantFilter}
     ORDER BY sequence DESC, COALESCE(dtstamp, 0) DESC, updated_at DESC LIMIT 1`,
    [input.accountId, input.eventUid, input.recurrenceKey,
      ...(input.method ? [input.method] : []),
      ...(input.participantKey !== undefined ? [input.participantKey] : [])],
  );
}

export async function updateCalendarItipAction(input: {
  actionKey: string;
  processingStatus?: InvitationProcessingStatus;
  deliveryStatus?: InvitationDeliveryStatus | null;
  pendingOperationId?: string | null;
  invitationId?: string | null;
  failureCode?: string | null;
  appliedAt?: number | null;
  deliveredAt?: number | null;
}): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE calendar_itip_actions SET
       processing_status = COALESCE($2, processing_status),
       delivery_status = CASE WHEN $3 = '__unchanged__' THEN delivery_status ELSE $3 END,
       pending_operation_id = CASE WHEN $4 = '__unchanged__' THEN pending_operation_id ELSE $4 END,
       invitation_id = CASE WHEN $5 = '__unchanged__' THEN invitation_id ELSE $5 END,
       failure_code = CASE WHEN $6 = '__unchanged__' THEN failure_code ELSE $6 END,
       applied_at = CASE WHEN $7 = -1 THEN applied_at ELSE $7 END,
       delivered_at = CASE WHEN $8 = -1 THEN delivered_at ELSE $8 END,
       updated_at = unixepoch()
     WHERE action_key = $1`,
    [
      input.actionKey,
      input.processingStatus ?? null,
      input.deliveryStatus === undefined ? "__unchanged__" : input.deliveryStatus,
      input.pendingOperationId === undefined ? "__unchanged__" : input.pendingOperationId,
      input.invitationId === undefined ? "__unchanged__" : input.invitationId,
      input.failureCode === undefined ? "__unchanged__" : input.failureCode,
      input.appliedAt === undefined ? -1 : input.appliedAt,
      input.deliveredAt === undefined ? -1 : input.deliveredAt,
    ],
  );
}
