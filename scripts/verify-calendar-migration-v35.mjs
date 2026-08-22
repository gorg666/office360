import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const source = readFileSync(new URL("../src/services/db/migrations.ts", import.meta.url), "utf8");
const match = /version:\s*35,[\s\S]*?sql:\s*`([\s\S]*?)`/.exec(source);
if (!match) throw new Error("Calendar migration v35 was not found");
const sql = match[1];

if (/(?:^|;)\s*(?:DROP|DELETE|UPDATE|REPLACE)\b/im.test(sql)) {
  throw new Error("Calendar migration v35 is not append-only");
}

const baseSchema = `
CREATE TABLE accounts (id TEXT PRIMARY KEY);
CREATE TABLE calendars (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  google_event_id TEXT NOT NULL,
  summary TEXT,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  is_all_day INTEGER NOT NULL DEFAULT 0,
  UNIQUE(account_id, google_event_id)
);`;

function openDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(baseSchema);
  db.exec("INSERT INTO accounts(id) VALUES ('acc-1')");
  db.exec("INSERT INTO calendars(id, account_id) VALUES ('cal-1', 'acc-1')");
  return db;
}

const fresh = openDatabase();
fresh.exec(sql);
const eventColumns = fresh.prepare("PRAGMA table_info(calendar_events)").all().map((column) => column.name);
const coverageColumns = fresh.prepare("PRAGMA table_info(calendar_sync_coverage)").all().map((column) => column.name);
fresh.close();

const existing = openDatabase();
existing.prepare(`INSERT INTO calendar_events
  (id, account_id, google_event_id, summary, start_time, end_time, is_all_day)
  VALUES (?, ?, ?, ?, ?, ?, ?)`)
  .run("legacy-1", "acc-1", "remote-1", "Legacy", 100, 200, 0);
existing.exec(sql);
const legacy = existing.prepare("SELECT * FROM calendar_events WHERE id = ?").get("legacy-1");
existing.prepare(`INSERT INTO calendar_sync_coverage
  (id, account_id, calendar_id, range_start, range_end, coverage_state, last_successful_sync)
  VALUES (?, ?, ?, ?, ?, ?, ?)`)
  .run("coverage-1", "acc-1", "cal-1", 100, 200, "complete", 300);
const coverage = existing.prepare("SELECT * FROM calendar_sync_coverage WHERE id = ?").get("coverage-1");
existing.close();

for (const column of ["origin", "projection_key", "projection_status"]) {
  if (!eventColumns.includes(column)) throw new Error(`Missing calendar_events.${column}`);
}
for (const column of ["account_id", "calendar_id", "range_start", "range_end", "coverage_state", "last_successful_sync"]) {
  if (!coverageColumns.includes(column)) throw new Error(`Missing calendar_sync_coverage.${column}`);
}
if (legacy.summary !== "Legacy" || legacy.origin !== null || legacy.projection_key !== null) {
  throw new Error("Existing row changed during migration");
}
if (coverage.coverage_state !== "complete" || coverage.last_successful_sync !== 300) {
  throw new Error("Coverage row did not round-trip");
}

console.log(JSON.stringify({
  migration: 35,
  appendOnly: true,
  freshDb: "PASS",
  existingDb: "PASS",
  legacyRow: "PASS",
  coverageRow: "PASS",
  eventColumns: 3,
  coverageColumns: coverageColumns.length,
}));
