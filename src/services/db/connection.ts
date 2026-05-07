import Database from "@tauri-apps/plugin-sql";

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:office360.db");
    await configureSqlite(db);
  }
  return db;
}

async function configureSqlite(database: Database): Promise<void> {
  const pragmas = [
    "PRAGMA busy_timeout = 30000",
    "PRAGMA journal_mode = WAL",
    "PRAGMA foreign_keys = ON",
  ];

  for (const pragma of pragmas) {
    try {
      await database.execute(pragma, []);
    } catch (err) {
      console.warn(`Failed to apply SQLite setting "${pragma}":`, err);
    }
  }
}

/**
 * Build a dynamic SQL UPDATE statement from a set of field updates.
 * Returns null if no fields to update.
 */
export function buildDynamicUpdate(
  table: string,
  idColumn: string,
  id: unknown,
  fields: [string, unknown][],
): { sql: string; params: unknown[] } | null {
  if (fields.length === 0) return null;

  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  for (const [column, value] of fields) {
    sets.push(`${column} = $${idx++}`);
    params.push(value);
  }

  params.push(id);
  return {
    sql: `UPDATE ${table} SET ${sets.join(", ")} WHERE ${idColumn} = $${idx}`,
    params,
  };
}

let writeQueue: Promise<void> = Promise.resolve();

function getErrorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function isSqliteBusyError(err: unknown): boolean {
  const message = getErrorText(err);
  return /database is locked|database busy|SQLITE_BUSY|code["']?\s*[:=]\s*5|\(code:\s*5\)/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Queue write operations so account-level writes do not race with explicit
 * transactions on the same WebView connection.
 */
async function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeQueue;
  let resolve!: () => void;
  writeQueue = new Promise<void>((r) => {
    resolve = r;
  });

  try {
    await prev;
  } catch {
    // Previous write failed; the queue must still continue.
  }

  try {
    return await fn();
  } finally {
    resolve();
  }
}

export async function executeWrite(
  sql: string,
  params: unknown[] = [],
  maxAttempts = 12,
): Promise<unknown> {
  return withWriteLock(async () => {
    const database = await getDb();
    let delayMs = 200;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await database.execute(sql, params);
      } catch (err) {
        if (!isSqliteBusyError(err) || attempt === maxAttempts) {
          throw err;
        }
        await sleep(delayMs);
        delayMs = Math.min(delayMs * 2, 2_000);
      }
    }
  });
}

export async function withTransaction(
  fn: (db: Database) => Promise<void>,
  maxAttempts = 12,
): Promise<void> {
  await withWriteLock(async () => {
    const database = await getDb();

    let delayMs = 200;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Tauri SQL uses a connection pool. A manual BEGIN/COMMIT can pin the
        // transaction to one pooled connection while subsequent execute() calls
        // are served by another connection, which self-locks SQLite for the
        // full busy_timeout. The JS write queue gives us the ordering we need
        // without holding a pooled SQLite transaction open.
        await fn(database);
        return;
      } catch (err) {
        if (!isSqliteBusyError(err) || attempt === maxAttempts) {
          throw err;
        }
      }

      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, 2_000);
    }
  });
}

/**
 * Execute a SELECT query and return the first result or null.
 */
export async function selectFirstBy<T>(
  query: string,
  params: unknown[] = [],
): Promise<T | null> {
  const db = await getDb();
  const rows = await db.select<T[]>(query, params);
  return rows[0] ?? null;
}

/**
 * Execute a COUNT(*) query and return whether any rows exist.
 */
export async function existsBy(
  query: string,
  params: unknown[] = [],
): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(query, params);
  return (rows[0]?.count ?? 0) > 0;
}

/**
 * Convert a boolean to SQLite integer (0 or 1).
 */
export function boolToInt(value: boolean | undefined | null): number {
  return value ? 1 : 0;
}
