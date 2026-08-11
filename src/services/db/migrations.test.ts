import { describe, it, expect } from "vitest";
import { MIGRATIONS } from "./migrations";

// Mirror of splitStatements from migrations.ts for testing
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let depth = 0;
  const upper = sql.toUpperCase();

  for (let i = 0; i < sql.length; i++) {
    if (
      upper.startsWith("BEGIN", i) &&
      (i === 0 || /\W/.test(sql[i - 1]!)) &&
      (i + 5 >= sql.length || /\W/.test(sql[i + 5]!))
    ) {
      depth++;
    }

    if (
      upper.startsWith("END", i) &&
      (i === 0 || /\W/.test(sql[i - 1]!)) &&
      (i + 3 >= sql.length || /\W/.test(sql[i + 3]!)) &&
      depth > 0
    ) {
      depth--;
    }

    if (sql[i] === ";" && depth === 0) {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = "";
    } else {
      current += sql[i];
    }
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) statements.push(trimmed);

  return statements;
}

describe("splitStatements", () => {
  it("splits simple statements", () => {
    const result = splitStatements("CREATE TABLE foo (id INT); CREATE TABLE bar (id INT);");
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("CREATE TABLE foo (id INT)");
    expect(result[1]).toBe("CREATE TABLE bar (id INT)");
  });

  it("keeps trigger body intact", () => {
    const sql = `
      CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, subject) VALUES (new.rowid, new.subject);
      END;
    `;
    const result = splitStatements(sql);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("BEGIN");
    expect(result[0]).toContain("END");
    expect(result[0]).toContain("INSERT INTO messages_fts");
  });

  it("handles multiple triggers", () => {
    const sql = `
      CREATE TABLE foo (id INT);

      CREATE TRIGGER t1 AFTER INSERT ON foo BEGIN
        INSERT INTO bar VALUES (new.id);
      END;

      CREATE TRIGGER t2 AFTER DELETE ON foo BEGIN
        DELETE FROM bar WHERE id = old.id;
      END;
    `;
    const result = splitStatements(sql);
    expect(result).toHaveLength(3);
    expect(result[0]).toContain("CREATE TABLE");
    expect(result[1]).toContain("CREATE TRIGGER t1");
    expect(result[2]).toContain("CREATE TRIGGER t2");
  });

  it("handles trigger with multiple statements inside BEGIN...END", () => {
    const sql = `
      CREATE TRIGGER t1 AFTER UPDATE ON messages BEGIN
        INSERT INTO fts(fts, rowid, subject) VALUES ('delete', old.rowid, old.subject);
        INSERT INTO fts(rowid, subject) VALUES (new.rowid, new.subject);
      END;
    `;
    const result = splitStatements(sql);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("BEGIN");
    expect(result[0]).toContain("END");
  });

  it("handles empty input", () => {
    expect(splitStatements("")).toHaveLength(0);
    expect(splitStatements("   ")).toHaveLength(0);
  });

  it("does not match END inside words like BACKEND", () => {
    const sql = "CREATE TABLE backend (id INT); CREATE TABLE foo (id INT);";
    const result = splitStatements(sql);
    expect(result).toHaveLength(2);
  });
});

describe("contacts address book migration", () => {
  it("adds identity table and backfills existing contacts", () => {
    const migration = MIGRATIONS.find((item) => item.version === 29);

    expect(migration?.sql).toContain("contact_identities");
    expect(migration?.sql).toContain("ALTER TABLE contacts ADD COLUMN contact_type");
    expect(migration?.sql).toContain("ALTER TABLE contacts ADD COLUMN vcard_raw");
    expect(migration?.sql).toContain("INSERT OR IGNORE INTO contact_identities");
    expect(migration?.sql).toContain("LOWER(email)");
  });
});

describe("queue observability migration", () => {
  it("adds updated_at without a non-constant ALTER TABLE default", () => {
    const migration = MIGRATIONS.find((item) => item.version === 27);

    expect(migration?.sql).toContain("ADD COLUMN updated_at INTEGER;");
    expect(migration?.sql).not.toContain("ADD COLUMN updated_at INTEGER DEFAULT");
    expect(migration?.sql).toContain("COALESCE(updated_at, created_at, unixepoch())");
  });
});

describe("calendar invitations migration", () => {
  it("adds invitation table with RSVP metadata and stable identity key", () => {
    const migration = MIGRATIONS.find((item) => item.version === 30);

    expect(migration?.sql).toContain("CREATE TABLE IF NOT EXISTS calendar_invitations");
    expect(migration?.sql).toContain("event_uid TEXT NOT NULL");
    expect(migration?.sql).toContain("recurrence_key TEXT NOT NULL DEFAULT ''");
    expect(migration?.sql).toContain("rsvp_status TEXT NOT NULL DEFAULT 'needs_action'");
    expect(migration?.sql).toContain("queued_operation_id TEXT");
    expect(migration?.sql).toContain("raw_ical TEXT NOT NULL");
    expect(migration?.sql).toContain("UNIQUE(account_id, event_uid, recurrence_key)");
    expect(migration?.sql).toContain("idx_calendar_invitations_thread");
  });
});

describe("full address book migration", () => {
  it("adds directories, rich fields, mailing lists, and compatibility backfill", () => {
    const migration = MIGRATIONS.find((item) => item.version === 31);

    expect(migration?.sql).toContain("CREATE TABLE IF NOT EXISTS contact_directories");
    expect(migration?.sql).toContain("INSERT OR IGNORE INTO contact_directories");
    expect(migration?.sql).toContain("ALTER TABLE contacts ADD COLUMN directory_id");
    expect(migration?.sql).toContain("CREATE TABLE IF NOT EXISTS contact_methods");
    expect(migration?.sql).toContain("INSERT OR IGNORE INTO contact_methods");
    expect(migration?.sql).toContain("CREATE TABLE IF NOT EXISTS contact_addresses");
    expect(migration?.sql).toContain("CREATE TABLE IF NOT EXISTS contact_special_dates");
    expect(migration?.sql).toContain("CREATE TABLE IF NOT EXISTS contact_lists");
    expect(migration?.sql).toContain("CREATE TABLE IF NOT EXISTS contact_list_members");
  });
});
