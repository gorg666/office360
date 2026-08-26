import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const source = readFileSync(new URL("../src/services/db/migrations.ts", import.meta.url), "utf8");
const match = /version:\s*39,[\s\S]*?sql:\s*`([\s\S]*?)`/.exec(source);
if (!match) throw new Error("Calendar migration v39 was not found");
const sql = match[1];
if (/(?:^|;)\s*(?:DROP|DELETE|UPDATE|REPLACE|INSERT|ALTER)\b/im.test(sql)) {
  throw new Error("Calendar migration v39 is not append-only");
}

function openDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE accounts (id TEXT PRIMARY KEY);
    CREATE TABLE calendars (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE TABLE calendar_invitations (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      event_uid TEXT NOT NULL,
      source_hash TEXT NOT NULL
    );
    CREATE TABLE messages (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, subject TEXT);
    CREATE TABLE calendar_events (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, summary TEXT);
  `);
  return db;
}

const fresh = openDatabase();
fresh.exec(sql);
const columns = fresh.prepare("PRAGMA table_info(calendar_itip_actions)").all();
const indexes = fresh.prepare("PRAGMA index_list(calendar_itip_actions)").all();
fresh.close();

const existing = openDatabase();
existing.prepare("INSERT INTO accounts (id) VALUES (?)").run("acc-1");
existing.prepare("INSERT INTO calendars (id, account_id) VALUES (?, ?)").run("cal-1", "acc-1");
existing.prepare("INSERT INTO calendar_invitations (id, account_id, event_uid, source_hash) VALUES (?, ?, ?, ?)")
  .run("invite-1", "acc-1", "uid-1", "legacy-hash");
existing.prepare("INSERT INTO messages (id, account_id, subject) VALUES (?, ?, ?)")
  .run("message-1", "acc-1", "Legacy subject");
existing.prepare("INSERT INTO calendar_events (id, account_id, summary) VALUES (?, ?, ?)")
  .run("event-1", "acc-1", "Legacy event");
existing.exec(sql);
const legacyInvitation = existing.prepare("SELECT event_uid, source_hash FROM calendar_invitations WHERE id = ?").get("invite-1");
const legacyMessage = existing.prepare("SELECT subject FROM messages WHERE id = ?").get("message-1");
const legacyEvent = existing.prepare("SELECT summary FROM calendar_events WHERE id = ?").get("event-1");
const actionCount = existing.prepare("SELECT COUNT(*) AS count FROM calendar_itip_actions").get().count;
existing.close();

for (const required of ["action_key", "account_id", "invitation_id", "calendar_id", "direction", "method", "event_uid", "recurrence_key", "sequence", "dtstamp", "participant_key", "event_resource_key", "message_id", "source_fingerprint", "pending_operation_id", "processing_status", "delivery_status", "failure_code", "applied_at", "delivered_at", "created_at", "updated_at"]) {
  if (!columns.some((column) => column.name === required)) throw new Error(`Missing ${required}`);
}
for (const required of ["idx_calendar_itip_actions_event", "idx_calendar_itip_actions_delivery", "idx_calendar_itip_actions_message", "idx_calendar_itip_actions_pending_operation"]) {
  if (!indexes.some((index) => index.name === required)) throw new Error(`Missing ${required}`);
}
if (legacyInvitation.event_uid !== "uid-1" || legacyInvitation.source_hash !== "legacy-hash"
  || legacyMessage.subject !== "Legacy subject" || legacyEvent.summary !== "Legacy event" || actionCount !== 0) {
  throw new Error("Migration rewrote legacy Mail/Calendar data or performed a backfill");
}

console.log(JSON.stringify({ migration: 39, appendOnly: true, freshDb: "PASS", existingDb: "PASS", legacyRowsUnchanged: "PASS", backfillRows: actionCount }));
