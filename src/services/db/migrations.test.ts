// @vitest-environment node
import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
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

function applyMigration(db: DatabaseSync, version: number): void {
  const migration = MIGRATIONS.find((item) => item.version === version);
  if (!migration) throw new Error(`Missing migration v${version}`);
  for (const statement of splitStatements(migration.sql)) {
    try {
      db.exec(statement);
    } catch (error) {
      if (!String(error).toLowerCase().includes("duplicate column")) throw error;
    }
  }
}

function applyMigrationsBefore(db: DatabaseSync, version: number): void {
  for (const migration of MIGRATIONS.filter((item) => item.version < version)) {
    applyMigration(db, migration.version);
  }
}

describe("v41 provider-neutral task projection migration", () => {
  it("upgrades a legacy database without losing local tasks", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    applyMigrationsBefore(db, 41);
    db.exec(`INSERT INTO tasks (id, title, priority, is_completed) VALUES ('legacy', 'Keep me', 'urgent', 1)`);

    applyMigration(db, 41);

    const task = db.prepare(
      "SELECT id, title, provider, status, sync_state FROM tasks WHERE id = 'legacy'",
    ).get() as Record<string, unknown>;
    expect(task).toEqual(expect.objectContaining({
      id: "legacy",
      title: "Keep me",
      provider: "local",
      status: "done",
      sync_state: "fresh",
    }));
  });

  it("upgrades a database whose global migration ledger is already at v40", () => {
    const db = new DatabaseSync(":memory:");
    applyMigrationsBefore(db, 41);
    for (let version = 34; version <= 40; version += 1) {
      db.prepare("INSERT OR IGNORE INTO _migrations (version, description) VALUES (?, ?)")
        .run(version, `reserved parallel migration v${version}`);
    }
    applyMigration(db, 41);
    db.prepare("INSERT OR IGNORE INTO _migrations (version, description) VALUES (?, ?)")
      .run(41, "Provider-neutral task projection");
    expect(db.prepare("SELECT MAX(version) AS version FROM _migrations").get())
      .toEqual(expect.objectContaining({ version: 41 }));
  });

  it("builds a fresh schema through v41 with required tables and indexes", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const migration of MIGRATIONS) applyMigration(db, migration.version);

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tasks', 'task_sources', 'organization_task_settings') ORDER BY name",
    ).all().map((row) => String((row as { name: string }).name));
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_task%' ORDER BY name",
    ).all().map((row) => String((row as { name: string }).name));
    expect(tables).toEqual(["organization_task_settings", "task_sources", "tasks"]);
    expect(indexes).toEqual(expect.arrayContaining([
      "idx_tasks_provider_task",
      "idx_tasks_organization_status",
      "idx_task_sources_task",
      "idx_task_sources_mail",
    ]));
  });

  it("allows one mail to link to multiple tasks and cascades sources on task delete", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    applyMigrationsBefore(db, 41);
    applyMigration(db, 41);
    db.exec(`
      INSERT INTO tasks (id, title) VALUES ('t1', 'One'), ('t2', 'Two');
      INSERT INTO task_sources (id, task_id, type, account_id, message_id)
        VALUES ('s1', 't1', 'mail', 'a1', 'm1'), ('s2', 't2', 'mail', 'a1', 'm1');
    `);
    expect(db.prepare(
      "SELECT COUNT(*) AS count FROM task_sources WHERE account_id = 'a1' AND message_id = 'm1'",
    ).get()).toEqual(expect.objectContaining({ count: 2 }));

    db.exec("DELETE FROM tasks WHERE id = 't1'");
    expect(db.prepare("SELECT COUNT(*) AS count FROM task_sources WHERE task_id = 't1'").get())
      .toEqual(expect.objectContaining({ count: 0 }));
  });

  it("keeps provider task and organization settings identities deterministic", () => {
    const db = new DatabaseSync(":memory:");
    applyMigrationsBefore(db, 41);
    applyMigration(db, 41);
    db.exec(`INSERT INTO tasks (id, title, provider, provider_task_id)
      VALUES ('r1', 'Remote', 'yandex-tracker', 'TEST-1')`);
    expect(() => db.exec(`INSERT INTO tasks (id, title, provider, provider_task_id)
      VALUES ('r2', 'Duplicate', 'yandex-tracker', 'TEST-1')`)).toThrow();
    db.exec(`INSERT INTO organization_task_settings (organization_id, provider)
      VALUES ('org1', 'yandex-tracker')`);
    expect(() => db.exec(`INSERT INTO organization_task_settings (organization_id, provider)
      VALUES ('org1', 'yandex-tracker')`)).toThrow();
  });

  it("is safe when v41 is retried after a partial application", () => {
    const db = new DatabaseSync(":memory:");
    applyMigrationsBefore(db, 41);
    applyMigration(db, 41);
    expect(() => applyMigration(db, 41)).not.toThrow();
  });
});
