import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const source = readFileSync(new URL("../src/services/db/migrations.ts", import.meta.url), "utf8");
const match = /version:\s*36,[\s\S]*?sql:\s*`([\s\S]*?)`/.exec(source);
if (!match) throw new Error("Calendar migration v36 was not found");
const sql = match[1];
if (/(?:^|;)\s*(?:DROP|DELETE|UPDATE|REPLACE|INSERT)\b/im.test(sql)) {
  throw new Error("Calendar migration v36 is not append-only");
}

function openDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE calendar_events (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    google_event_id TEXT NOT NULL,
    summary TEXT,
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    is_all_day INTEGER NOT NULL DEFAULT 0,
    UNIQUE(account_id, google_event_id)
  )`);
  return db;
}

const fresh = openDatabase();
fresh.exec(sql);
const reminderColumn = fresh.prepare("PRAGMA table_info(calendar_events)").all().find((column) => column.name === "reminders_json");
fresh.close();

const existing = openDatabase();
existing.prepare("INSERT INTO calendar_events (id, account_id, google_event_id, summary, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)")
  .run("legacy-1", "acc-1", "remote-1", "Legacy", 100, 200);
existing.exec(sql);
const legacy = existing.prepare("SELECT summary, reminders_json FROM calendar_events WHERE id = ?").get("legacy-1");
existing.close();

if (!reminderColumn || reminderColumn.type !== "TEXT" || reminderColumn.notnull !== 0) {
  throw new Error("calendar_events.reminders_json must be nullable TEXT");
}
if (legacy.summary !== "Legacy" || legacy.reminders_json !== null) {
  throw new Error("Existing row changed during migration");
}

console.log(JSON.stringify({
  migration: 36,
  appendOnly: true,
  freshDb: "PASS",
  existingDb: "PASS",
  legacyRowRemainsNull: "PASS",
}));
