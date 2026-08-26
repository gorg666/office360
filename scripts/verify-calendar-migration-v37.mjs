import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const source = readFileSync(new URL("../src/services/db/migrations.ts", import.meta.url), "utf8");
const match = /version:\s*37,[\s\S]*?sql:\s*`([\s\S]*?)`/.exec(source);
if (!match) throw new Error("Calendar migration v37 was not found");
const sql = match[1];
if (/(?:^|;)\s*(?:DROP|DELETE|UPDATE|REPLACE|INSERT)\b/im.test(sql)) {
  throw new Error("Calendar migration v37 is not append-only");
}

function openDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE calendars (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    remote_id TEXT NOT NULL,
    display_name TEXT,
    UNIQUE(account_id, remote_id)
  )`);
  return db;
}

const fresh = openDatabase();
fresh.exec(sql);
const columns = fresh.prepare("PRAGMA table_info(calendars)").all();
const indexes = fresh.prepare("PRAGMA index_list(calendars)").all();
fresh.close();

const existing = openDatabase();
existing.prepare("INSERT INTO calendars (id, account_id, provider, remote_id, display_name) VALUES (?, ?, ?, ?, ?)")
  .run("legacy-1", "acc-1", "caldav", "remote-1", "Legacy");
existing.exec(sql);
const legacy = existing.prepare("SELECT display_name, access_json, access_observed_at, provider_presence, provider_seen_at FROM calendars WHERE id = ?")
  .get("legacy-1");
existing.close();

for (const [name, type] of [["access_json", "TEXT"], ["access_observed_at", "INTEGER"], ["provider_presence", "TEXT"], ["provider_seen_at", "INTEGER"]]) {
  const column = columns.find((candidate) => candidate.name === name);
  if (!column || column.type !== type || column.notnull !== 0) throw new Error(`${name} must be nullable ${type}`);
}
if (!indexes.some((index) => index.name === "idx_calendars_account_presence")) throw new Error("Presence index is missing");
if (legacy.display_name !== "Legacy" || legacy.access_json !== null || legacy.access_observed_at !== null || legacy.provider_presence !== null || legacy.provider_seen_at !== null) {
  throw new Error("Existing row changed during migration");
}

console.log(JSON.stringify({ migration: 37, appendOnly: true, freshDb: "PASS", existingDb: "PASS", legacyMetadataRemainsNull: "PASS" }));
