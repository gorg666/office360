import { getDb, buildDynamicUpdate, selectFirstBy } from "./connection";

export interface DbSmartFolder {
  id: string;
  account_id: string | null;
  name: string;
  query: string;
  icon: string;
  color: string | null;
  sort_order: number;
  is_default: number;
  created_at: number;
  status?: string | null;
  status_reason?: string | null;
  status_updated_at?: number | null;
}

/**
 * Return global (account_id IS NULL) + account-specific folders, ordered by sort_order.
 */
export async function getSmartFolders(
  accountId?: string,
): Promise<DbSmartFolder[]> {
  const db = await getDb();
  if (accountId) {
    return db.select<DbSmartFolder[]>(
      "SELECT * FROM smart_folders WHERE account_id IS NULL OR account_id = $1 ORDER BY sort_order, created_at",
      [accountId],
    );
  }
  return db.select<DbSmartFolder[]>(
    "SELECT * FROM smart_folders WHERE account_id IS NULL ORDER BY sort_order, created_at",
  );
}

export async function getSmartFolderById(
  id: string,
): Promise<DbSmartFolder | null> {
  return selectFirstBy<DbSmartFolder>(
    "SELECT * FROM smart_folders WHERE id = $1",
    [id],
  );
}

export async function insertSmartFolder(folder: {
  name: string;
  query: string;
  accountId?: string;
  icon?: string;
  color?: string;
}): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.execute(
    "INSERT INTO smart_folders (id, account_id, name, query, icon, color) VALUES ($1, $2, $3, $4, $5, $6)",
    [
      id,
      folder.accountId ?? null,
      folder.name,
      folder.query,
      folder.icon ?? "Search",
      folder.color ?? null,
    ],
  );
  return id;
}

export async function updateSmartFolder(
  id: string,
  updates: { name?: string; query?: string; icon?: string; color?: string; status?: string | null; statusReason?: string | null },
): Promise<void> {
  const fields: [string, unknown][] = [];
  if (updates.name !== undefined) fields.push(["name", updates.name]);
  if (updates.query !== undefined) fields.push(["query", updates.query]);
  if (updates.icon !== undefined) fields.push(["icon", updates.icon]);
  if (updates.color !== undefined) fields.push(["color", updates.color]);
  if (updates.status !== undefined) fields.push(["status", updates.status]);
  if (updates.statusReason !== undefined) {
    fields.push(["status_reason", updates.statusReason]);
    fields.push(["status_updated_at", Math.floor(Date.now() / 1000)]);
  }

  const built = buildDynamicUpdate("smart_folders", "id", id, fields);
  if (!built) return;

  const db = await getDb();
  await db.execute(built.sql, built.params);
}

export async function rewriteSmartFolderReference(
  accountId: string,
  fromOperator: "label" | "labelid" | "folderpath",
  fromValue: string,
  toValue: string,
): Promise<void> {
  const folders = await getSmartFolders(accountId);
  const quoted = `${fromOperator}:"${fromValue}"`;
  const bare = `${fromOperator}:${fromValue}`;
  for (const folder of folders) {
    const nextQuery = folder.query
      .replaceAll(quoted, `${fromOperator}:"${toValue}"`)
      .replaceAll(bare, `${fromOperator}:${toValue}`);
    if (nextQuery !== folder.query) {
      await updateSmartFolder(folder.id, {
        query: nextQuery,
        status: "ok",
        statusReason: null,
      });
    }
  }
}

export async function markSmartFoldersMissingReference(
  accountId: string,
  operator: "label" | "labelid" | "folderpath",
  value: string,
  reason: string,
): Promise<void> {
  const folders = await getSmartFolders(accountId);
  const quoted = `${operator}:"${value}"`;
  const bare = `${operator}:${value}`;
  for (const folder of folders) {
    if (folder.query.includes(quoted) || folder.query.includes(bare)) {
      await updateSmartFolder(folder.id, {
        status: "missing_reference",
        statusReason: reason,
      });
    }
  }
}

export async function deleteSmartFolder(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM smart_folders WHERE id = $1", [id]);
}

export async function updateSmartFolderSortOrder(
  orders: { id: string; sortOrder: number }[],
): Promise<void> {
  const db = await getDb();
  for (const { id, sortOrder } of orders) {
    await db.execute(
      "UPDATE smart_folders SET sort_order = $1 WHERE id = $2",
      [sortOrder, id],
    );
  }
}
