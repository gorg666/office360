import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const source = readFileSync(new URL("../src/services/db/migrations.ts", import.meta.url), "utf8");
const match = /version:\s*34,[\s\S]*?sql:\s*`([\s\S]*?)`/.exec(source);
if (!match) throw new Error("Calendar migration v34 was not found");
const sql = match[1];

if (/\b(?:DROP|DELETE|UPDATE|REPLACE)\b/i.test(sql)) {
  throw new Error("Calendar migration v34 is not append-only");
}

const baseSchema = `CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  google_event_id TEXT NOT NULL,
  summary TEXT,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  is_all_day INTEGER NOT NULL DEFAULT 0
)`;

const fresh = new DatabaseSync(":memory:");
fresh.exec(baseSchema);
fresh.exec(sql);
const columns = fresh.prepare("PRAGMA table_info(calendar_events)").all().map((column) => column.name);
const indexes = fresh.prepare("PRAGMA index_list(calendar_events)").all().map((index) => index.name);
fresh.close();

const existing = new DatabaseSync(":memory:");
existing.exec(baseSchema);
existing.prepare(`INSERT INTO calendar_events
  (id, account_id, google_event_id, summary, start_time, end_time, is_all_day)
  VALUES (?, ?, ?, ?, ?, ?, ?)`)
  .run("legacy-1", "acc-1", "remote-1", "Legacy", 100, 200, 0);
existing.exec(sql);
const legacy = existing.prepare("SELECT * FROM calendar_events WHERE id = ?").get("legacy-1");
existing.prepare(`INSERT INTO calendar_events
  (id, account_id, google_event_id, summary, start_time, end_time, is_all_day,
   time_kind, tzid, wall_start, wall_end, series_uid, occurrence_key,
   is_recurrence_master, transp, sequence)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  .run(
    "semantic-1", "acc-1", "remote-2", "Semantic", 1773558000, 1773561600, 0,
    "timed-zoned", "Europe/Moscow", "2026-03-15T10:00:00", "2026-03-15T11:00:00",
    "series-1", "series-1::timed-zoned::Europe%2FMoscow::2026-03-15T10%3A00%3A00",
    1, "transparent", 7,
  );
const semantic = existing.prepare("SELECT time_kind, tzid, wall_start, wall_end, series_uid, occurrence_key, is_recurrence_master, transp, sequence FROM calendar_events WHERE id = ?").get("semantic-1");
existing.close();

const requiredColumns = [
  "time_kind", "tzid", "wall_start", "wall_end", "end_date_exclusive",
  "series_uid", "occurrence_key", "is_recurrence_master", "transp", "sequence",
];
if (!requiredColumns.every((column) => columns.includes(column))) throw new Error("Fresh schema is missing semantic columns");
if (!indexes.includes("idx_calendar_events_series_uid") || !indexes.includes("idx_calendar_events_occurrence_key")) {
  throw new Error("Fresh schema is missing semantic indexes");
}
if (legacy.summary !== "Legacy" || legacy.start_time !== 100 || legacy.end_time !== 200) {
  throw new Error("Existing row changed during migration");
}
if (legacy.time_kind !== null || legacy.is_recurrence_master !== 0 || legacy.sequence !== 0) {
  throw new Error("Legacy row defaults are incompatible");
}
if (semantic.time_kind !== "timed-zoned" || semantic.tzid !== "Europe/Moscow" || semantic.sequence !== 7) {
  throw new Error("New semantic row did not round-trip");
}

console.log(JSON.stringify({
  migration: 34,
  appendOnly: true,
  freshDb: "PASS",
  existingDb: "PASS",
  legacyRow: "PASS",
  semanticRow: "PASS",
  columns: requiredColumns.length,
  indexes: 2,
}));
