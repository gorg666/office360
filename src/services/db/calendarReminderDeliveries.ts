import { parseCalendarAccess, parseCalendarReminderPolicy } from "@/services/calendar/domain";
import {
  snoozedReminderDeliveryKey,
  type ReminderDelivery,
  type ReminderOccurrence,
  type ReminderSourceEvent,
} from "@/services/calendar/reminderDelivery/domain";
import { getDb, withTransaction } from "./connection";
import { normalizeCalendarEventRow, type DbCalendarEvent } from "./calendarEvents";

interface ReminderSourceRow extends DbCalendarEvent {
  calendar_name: string | null;
  access_json: string | null;
}

interface DbReminderDelivery {
  delivery_key: string;
  account_id: string;
  calendar_id: string;
  event_resource_key: string;
  series_uid: string | null;
  occurrence_key: string;
  reminder_key: string;
  scheduled_at: number;
  source_fingerprint: string;
  status: ReminderDelivery["status"];
  parent_delivery_key: string | null;
  delivered_at: number | null;
  handled_at: number | null;
  lease_expires_at: number | null;
  attempt_count: number;
  failure_code: string | null;
  created_at: number;
  updated_at: number;
}

export async function getCalendarReminderSources(
  eventStartFrom: number,
  eventStartThrough: number,
): Promise<ReminderSourceEvent[]> {
  const db = await getDb();
  const rows = await db.select<ReminderSourceRow[]>(
    `SELECT e.*, c.display_name AS calendar_name, c.access_json
     FROM calendar_events e
     JOIN calendars c ON c.id = e.calendar_id AND c.account_id = e.account_id
     WHERE e.calendar_id IS NOT NULL
       AND c.provider_presence IS NOT 'removed'
       AND e.start_time >= $1 AND e.start_time <= $2
       AND (e.reminders_json IS NOT NULL OR e.ical_data IS NOT NULL)
     ORDER BY e.start_time ASC`,
    [eventStartFrom, eventStartThrough],
  );

  return rows.flatMap((raw) => {
    const row = normalizeCalendarEventRow(raw);
    const reminders = parseCalendarReminderPolicy(row.reminders_json);
    // Despite its legacy name, google_event_id is the cache's provider-neutral
    // instance/resource key. CalDAV recurrence expansion stores href+occurrence
    // here, whereas remote_event_id can be the same href for every instance.
    const eventResourceKey = row.google_event_id;
    if (!reminders || !eventResourceKey || !row.calendar_id) return [];
    const access = parseCalendarAccess(raw.access_json);
    return [{
      accountId: row.account_id,
      calendarId: row.calendar_id,
      calendarName: raw.calendar_name,
      eventResourceKey,
      seriesUid: row.series_uid,
      occurrenceKey: row.occurrence_key,
      startTime: row.start_time,
      endTime: row.end_time,
      timeKind: row.time_kind,
      tzid: row.tzid,
      wallStart: row.wall_start,
      status: row.status,
      summary: row.summary,
      canSeeEventDetails: access.permissions.canSeeEventDetails,
      reminders,
    }];
  });
}

export async function reconcileCalendarReminderDeliveries(
  planned: readonly ReminderOccurrence[],
  activeSourceFingerprints: ReadonlySet<string>,
  window: { catchUpStart: number; scheduleEnd: number },
): Promise<{ created: number; cancelled: number }> {
  let created = 0;
  let cancelled = 0;
  await withTransaction(async (db) => {
    for (const occurrence of planned) {
      const result = await db.execute(
        `INSERT OR IGNORE INTO calendar_reminder_deliveries (
           delivery_key, account_id, calendar_id, event_resource_key, series_uid,
           occurrence_key, reminder_key, scheduled_at, source_fingerprint, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'scheduled')`,
        [
          occurrence.deliveryKey,
          occurrence.accountId,
          occurrence.calendarId,
          occurrence.eventResourceKey,
          occurrence.seriesUid,
          occurrence.occurrenceKey,
          occurrence.reminderKey,
          occurrence.scheduledAt,
          occurrence.sourceFingerprint,
        ],
      ) as { rowsAffected?: number };
      created += result.rowsAffected ?? 0;
    }

    const pending = await db.select<DbReminderDelivery[]>(
      `SELECT * FROM calendar_reminder_deliveries
       WHERE status IN ('scheduled', 'delivering', 'failed')
         AND scheduled_at >= $1 AND scheduled_at <= $2`,
      [window.catchUpStart, window.scheduleEnd],
    );
    for (const row of pending) {
      if (activeSourceFingerprints.has(row.source_fingerprint)) continue;
      const result = await db.execute(
        `UPDATE calendar_reminder_deliveries
         SET status = 'cancelled', handled_at = unixepoch(), lease_expires_at = NULL,
             updated_at = unixepoch()
         WHERE delivery_key = $1 AND status IN ('scheduled', 'delivering', 'failed')`,
        [row.delivery_key],
      ) as { rowsAffected?: number };
      cancelled += result.rowsAffected ?? 0;
    }
  });
  return { created, cancelled };
}

export async function claimDueCalendarReminderDeliveries(input: {
  now: number;
  catchUpStart: number;
  leaseSeconds: number;
}): Promise<ReminderDelivery[]> {
  const claimed: ReminderDelivery[] = [];
  await withTransaction(async (db) => {
    await db.execute(
      `UPDATE calendar_reminder_deliveries
       SET status = 'cancelled', handled_at = $1, updated_at = $1
       WHERE status = 'scheduled' AND scheduled_at < $2`,
      [input.now, input.catchUpStart],
    );
    await db.execute(
      `UPDATE calendar_reminder_deliveries
       SET status = 'scheduled', lease_expires_at = NULL, updated_at = $1
       WHERE status = 'delivering' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $1`,
      [input.now],
    );

    const due = await db.select<DbReminderDelivery[]>(
      `SELECT * FROM calendar_reminder_deliveries
       WHERE status = 'scheduled' AND scheduled_at >= $1 AND scheduled_at <= $2
       ORDER BY scheduled_at ASC, delivery_key ASC`,
      [input.catchUpStart, input.now],
    );
    for (const row of due) {
      const result = await db.execute(
        `UPDATE calendar_reminder_deliveries
         SET status = 'delivering', lease_expires_at = $2,
             attempt_count = attempt_count + 1, updated_at = $1
         WHERE delivery_key = $3 AND status = 'scheduled'`,
        [input.now, input.now + input.leaseSeconds, row.delivery_key],
      ) as { rowsAffected?: number };
      if ((result.rowsAffected ?? 0) > 0) {
        claimed.push(mapDelivery({
          ...row,
          status: "delivering",
          lease_expires_at: input.now + input.leaseSeconds,
          attempt_count: row.attempt_count + 1,
          updated_at: input.now,
        }));
      }
    }
  });
  return claimed;
}

export async function getReminderSourceForDelivery(
  delivery: Pick<ReminderDelivery, "accountId" | "calendarId" | "eventResourceKey">,
): Promise<ReminderSourceEvent | null> {
  const db = await getDb();
  const rows = await db.select<ReminderSourceRow[]>(
    `SELECT e.*, c.display_name AS calendar_name, c.access_json
     FROM calendar_events e
     JOIN calendars c ON c.id = e.calendar_id AND c.account_id = e.account_id
     WHERE e.account_id = $1 AND e.calendar_id = $2
       AND e.google_event_id = $3
       AND c.provider_presence IS NOT 'removed'
     ORDER BY e.updated_at DESC LIMIT 1`,
    [delivery.accountId, delivery.calendarId, delivery.eventResourceKey],
  );
  const raw = rows[0];
  if (!raw) return null;
  const row = normalizeCalendarEventRow(raw);
  const reminders = parseCalendarReminderPolicy(row.reminders_json);
  if (!reminders || !row.calendar_id) return null;
  return {
    accountId: row.account_id,
    calendarId: row.calendar_id,
    calendarName: raw.calendar_name,
    eventResourceKey: delivery.eventResourceKey,
    seriesUid: row.series_uid,
    occurrenceKey: row.occurrence_key,
    startTime: row.start_time,
    endTime: row.end_time,
    timeKind: row.time_kind,
    tzid: row.tzid,
    wallStart: row.wall_start,
    status: row.status,
    summary: row.summary,
    canSeeEventDetails: parseCalendarAccess(raw.access_json).permissions.canSeeEventDetails,
    reminders,
  };
}

export async function completeCalendarReminderDelivery(
  deliveryKey: string,
  now: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE calendar_reminder_deliveries
     SET status = 'delivered', delivered_at = $2, lease_expires_at = NULL,
         failure_code = NULL, updated_at = $2
     WHERE delivery_key = $1 AND status = 'delivering'`,
    [deliveryKey, now],
  );
}

export async function failCalendarReminderDelivery(
  deliveryKey: string,
  now: number,
  failureCode: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE calendar_reminder_deliveries
     SET status = 'failed', delivered_at = NULL, failure_code = $2,
         lease_expires_at = NULL, updated_at = $3
     WHERE delivery_key = $1 AND status IN ('delivering', 'delivered')`,
    [deliveryKey, failureCode, now],
  );
}

export async function cancelCalendarReminderDelivery(deliveryKey: string, now: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE calendar_reminder_deliveries
     SET status = 'cancelled', handled_at = $2, lease_expires_at = NULL, updated_at = $2
     WHERE delivery_key = $1 AND status IN ('scheduled', 'delivering', 'failed')`,
    [deliveryKey, now],
  );
}

export async function dismissCalendarReminderDelivery(deliveryKey: string, now: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE calendar_reminder_deliveries
     SET status = 'dismissed', handled_at = $2, updated_at = $2
     WHERE delivery_key = $1 AND status = 'delivered'`,
    [deliveryKey, now],
  );
}

export async function snoozeCalendarReminderDelivery(
  deliveryKey: string,
  scheduledAt: number,
  now: number,
): Promise<ReminderDelivery | null> {
  let child: ReminderDelivery | null = null;
  await withTransaction(async (db) => {
    const parents = await db.select<DbReminderDelivery[]>(
      "SELECT * FROM calendar_reminder_deliveries WHERE delivery_key = $1 AND status = 'delivered' LIMIT 1",
      [deliveryKey],
    );
    const parent = parents[0];
    if (!parent) return;
    const childKey = snoozedReminderDeliveryKey(deliveryKey, scheduledAt);
    await db.execute(
      `UPDATE calendar_reminder_deliveries
       SET status = 'snoozed', handled_at = $2, updated_at = $2
       WHERE delivery_key = $1 AND status = 'delivered'`,
      [deliveryKey, now],
    );
    await db.execute(
      `INSERT OR IGNORE INTO calendar_reminder_deliveries (
         delivery_key, account_id, calendar_id, event_resource_key, series_uid,
         occurrence_key, reminder_key, scheduled_at, source_fingerprint, status,
         parent_delivery_key
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'scheduled', $10)`,
      [childKey, parent.account_id, parent.calendar_id, parent.event_resource_key,
        parent.series_uid, parent.occurrence_key, parent.reminder_key, scheduledAt,
        parent.source_fingerprint, parent.delivery_key],
    );
    const rows = await db.select<DbReminderDelivery[]>(
      "SELECT * FROM calendar_reminder_deliveries WHERE delivery_key = $1 LIMIT 1",
      [childKey],
    );
    child = rows[0] ? mapDelivery(rows[0]) : null;
  });
  return child;
}

export async function getUnhandledCalendarReminderDeliveries(since: number): Promise<ReminderDelivery[]> {
  const db = await getDb();
  const rows = await db.select<DbReminderDelivery[]>(
    `SELECT * FROM calendar_reminder_deliveries
     WHERE status = 'delivered' AND handled_at IS NULL AND delivered_at >= $1
     ORDER BY delivered_at DESC`,
    [since],
  );
  return rows.map(mapDelivery);
}

export async function getNextCalendarReminderDeliveryAt(after: number): Promise<number | null> {
  const db = await getDb();
  const rows = await db.select<{ scheduled_at: number }[]>(
    `SELECT scheduled_at FROM calendar_reminder_deliveries
     WHERE status = 'scheduled' AND scheduled_at > $1
     ORDER BY scheduled_at ASC LIMIT 1`,
    [after],
  );
  return rows[0]?.scheduled_at ?? null;
}

export async function requeuePermissionDeniedCalendarReminders(catchUpStart: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE calendar_reminder_deliveries
     SET status = 'scheduled', failure_code = NULL, updated_at = unixepoch()
     WHERE status = 'failed' AND failure_code = 'permission-denied'
       AND scheduled_at >= $1`,
    [catchUpStart],
  );
}

function mapDelivery(row: DbReminderDelivery): ReminderDelivery {
  return {
    deliveryKey: row.delivery_key,
    accountId: row.account_id,
    calendarId: row.calendar_id,
    eventResourceKey: row.event_resource_key,
    seriesUid: row.series_uid,
    occurrenceKey: row.occurrence_key,
    reminderKey: row.reminder_key,
    scheduledAt: row.scheduled_at,
    sourceFingerprint: row.source_fingerprint,
    status: row.status,
    parentDeliveryKey: row.parent_delivery_key,
    deliveredAt: row.delivered_at,
    handledAt: row.handled_at,
    leaseExpiresAt: row.lease_expires_at,
    attemptCount: row.attempt_count,
    failureCode: row.failure_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
