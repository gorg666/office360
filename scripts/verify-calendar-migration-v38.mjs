import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const source = readFileSync(new URL("../src/services/db/migrations.ts", import.meta.url), "utf8");
const match = /version:\s*38,[\s\S]*?sql:\s*`([\s\S]*?)`/.exec(source);
if (!match) throw new Error("Calendar migration v38 was not found");
const sql = match[1];
if (/(?:^|;)\s*(?:DROP|DELETE|UPDATE|REPLACE|INSERT|ALTER)\b/im.test(sql)) {
  throw new Error("Calendar migration v38 is not append-only");
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
    CREATE TABLE calendar_events (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      calendar_id TEXT,
      reminders_json TEXT
    );
  `);
  return db;
}

const fresh = openDatabase();
fresh.exec(sql);
const columns = fresh.prepare("PRAGMA table_info(calendar_reminder_deliveries)").all();
const indexes = fresh.prepare("PRAGMA index_list(calendar_reminder_deliveries)").all();
fresh.close();

const existing = openDatabase();
existing.prepare("INSERT INTO accounts (id) VALUES (?)").run("acc-1");
existing.prepare("INSERT INTO calendars (id, account_id) VALUES (?, ?)").run("cal-1", "acc-1");
existing.prepare("INSERT INTO calendar_events (id, account_id, calendar_id, reminders_json) VALUES (?, ?, ?, ?)")
  .run("event-1", "acc-1", "cal-1", '{"version":1}');
existing.exec(sql);
const legacyEvent = existing.prepare("SELECT * FROM calendar_events WHERE id = ?").get("event-1");
const deliveryCount = existing.prepare("SELECT COUNT(*) AS count FROM calendar_reminder_deliveries").get().count;
existing.close();

for (const required of ["delivery_key", "account_id", "calendar_id", "event_resource_key", "occurrence_key", "reminder_key", "scheduled_at", "source_fingerprint", "status", "parent_delivery_key", "delivered_at", "handled_at", "lease_expires_at", "attempt_count", "failure_code", "created_at", "updated_at"]) {
  if (!columns.some((column) => column.name === required)) throw new Error(`Missing ${required}`);
}
for (const required of ["idx_calendar_reminder_deliveries_due", "idx_calendar_reminder_deliveries_event", "idx_calendar_reminder_deliveries_parent"]) {
  if (!indexes.some((index) => index.name === required)) throw new Error(`Missing ${required}`);
}
if (legacyEvent.reminders_json !== '{"version":1}' || deliveryCount !== 0) {
  throw new Error("Migration rewrote legacy calendar data or performed a backfill");
}

console.log(JSON.stringify({ migration: 38, appendOnly: true, freshDb: "PASS", existingDb: "PASS", legacyRowsUnchanged: "PASS", backfillRows: deliveryCount }));
