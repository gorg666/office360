import { getDb } from "./connection";
import type { DbTask } from "./tasks";

export interface DbTaskSource {
  id: string;
  task_id: string;
  type: string;
  account_id: string | null;
  message_id: string | null;
  thread_id: string | null;
  rfc_message_id: string | null;
  subject_snapshot: string | null;
  sender_snapshot: string | null;
  created_at: number;
}

export interface DbOrganizationTaskSettings {
  organization_id: string;
  provider: string;
  enabled: number;
  provider_organization_id: string | null;
  default_queue: string | null;
  updated_at: number;
}

export async function getProjectedTask(id: string): Promise<DbTask | null> {
  const db = await getDb();
  const rows = await db.select<DbTask[]>("SELECT * FROM tasks WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function listProjectedTasks(organizationId?: string | null): Promise<DbTask[]> {
  const db = await getDb();
  if (organizationId === undefined) {
    return db.select<DbTask[]>("SELECT * FROM tasks ORDER BY updated_at DESC");
  }
  return db.select<DbTask[]>(
    "SELECT * FROM tasks WHERE organization_id = $1 ORDER BY updated_at DESC",
    [organizationId],
  );
}

export async function listProjectedTasksByPrincipal(
  column: "assignee_json" | "creator_json",
  email: string,
): Promise<DbTask[]> {
  const db = await getDb();
  return db.select<DbTask[]>(
    `SELECT * FROM tasks
     WHERE LOWER(json_extract(${column}, '$.email')) = LOWER($1)
     ORDER BY updated_at DESC`,
    [email],
  );
}

export async function upsertProjectedTask(row: DbTask): Promise<void> {
  if (!row.provider || row.provider === "local" || !row.provider_task_id) {
    throw new Error("Remote task projections require provider and providerTaskId");
  }
  const db = await getDb();
  await db.execute(
    `INSERT INTO tasks (
       id, account_id, title, description, priority, is_completed, completed_at, due_date,
       parent_id, thread_id, thread_account_id, sort_order, recurrence_rule, next_recurrence_at,
       tags_json, provider, provider_task_id, external_key, organization_id, status,
       provider_status, provider_priority, assignee_json, creator_json, followers_json,
       provider_updated_at, sync_state, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, NULL, NULL, NULL, 0, NULL, NULL, '[]',
       $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
     )
     ON CONFLICT(provider, provider_task_id) WHERE provider_task_id IS NOT NULL DO UPDATE SET
       external_key = excluded.external_key,
       organization_id = excluded.organization_id,
       title = excluded.title,
       description = excluded.description,
       priority = excluded.priority,
       is_completed = excluded.is_completed,
       completed_at = excluded.completed_at,
       due_date = excluded.due_date,
       status = excluded.status,
       provider_status = excluded.provider_status,
       provider_priority = excluded.provider_priority,
       assignee_json = excluded.assignee_json,
       creator_json = excluded.creator_json,
       followers_json = excluded.followers_json,
       provider_updated_at = excluded.provider_updated_at,
       sync_state = excluded.sync_state,
       updated_at = excluded.updated_at`,
    [
      row.id, row.account_id, row.title, row.description, row.priority, row.is_completed,
      row.completed_at, row.due_date, row.provider, row.provider_task_id, row.external_key,
      row.organization_id, row.status, row.provider_status, row.provider_priority,
      row.assignee_json, row.creator_json, row.followers_json ?? "[]",
      row.provider_updated_at, row.sync_state ?? "fresh", row.created_at, row.updated_at,
    ],
  );
}

export async function updateLocalProjectedTask(id: string, fields: {
  title?: string;
  description?: string | null;
  status?: string;
  priority?: string;
  dueDate?: number | null;
}): Promise<void> {
  const db = await getDb();
  const sets = ["updated_at = unixepoch()"];
  const params: unknown[] = [];
  const add = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if (fields.title !== undefined) add("title", fields.title);
  if (fields.description !== undefined) add("description", fields.description);
  if (fields.status !== undefined) {
    const statusParam = params.length + 1;
    add("status", fields.status);
    add("is_completed", fields.status === "done" ? 1 : 0);
    sets.push(`completed_at = CASE WHEN $${statusParam} = 'done' THEN unixepoch() ELSE NULL END`);
  }
  if (fields.priority !== undefined) add("priority", fields.priority);
  if (fields.dueDate !== undefined) add("due_date", fields.dueDate);
  params.push(id);
  await db.execute(
    `UPDATE tasks SET ${sets.join(", ")} WHERE id = $${params.length} AND provider = 'local'`,
    params,
  );
}

export async function removeProjectedTask(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM tasks WHERE id = $1", [id]);
}

export async function insertTaskSource(source: Omit<DbTaskSource, "created_at"> & { created_at?: number }): Promise<void> {
  if (source.type === "mail" && (!source.account_id || !source.message_id)) {
    throw new Error("Mail task sources require accountId and messageId");
  }
  const db = await getDb();
  await db.execute(
    `INSERT INTO task_sources (
       id, task_id, type, account_id, message_id, thread_id, rfc_message_id,
       subject_snapshot, sender_snapshot, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, unixepoch()))`,
    [source.id, source.task_id, source.type, source.account_id, source.message_id,
      source.thread_id, source.rfc_message_id, source.subject_snapshot,
      source.sender_snapshot, source.created_at ?? null],
  );
}

export async function listTaskSources(taskId: string): Promise<DbTaskSource[]> {
  const db = await getDb();
  return db.select<DbTaskSource[]>(
    "SELECT * FROM task_sources WHERE task_id = $1 ORDER BY created_at ASC",
    [taskId],
  );
}

export async function listProjectedTasksForMail(accountId: string, messageId: string): Promise<DbTask[]> {
  const db = await getDb();
  return db.select<DbTask[]>(
    `SELECT DISTINCT tasks.* FROM tasks
     JOIN task_sources ON task_sources.task_id = tasks.id
     WHERE task_sources.type = 'mail'
       AND task_sources.account_id = $1
       AND task_sources.message_id = $2
     ORDER BY tasks.updated_at DESC`,
    [accountId, messageId],
  );
}

export async function upsertOrganizationTaskSettings(settings: DbOrganizationTaskSettings): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO organization_task_settings (
       organization_id, provider, enabled, provider_organization_id, default_queue, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(organization_id, provider) DO UPDATE SET
       enabled = excluded.enabled,
       provider_organization_id = excluded.provider_organization_id,
       default_queue = excluded.default_queue,
       updated_at = excluded.updated_at`,
    [settings.organization_id, settings.provider, settings.enabled,
      settings.provider_organization_id, settings.default_queue, settings.updated_at],
  );
}

export async function getOrganizationTaskSettings(
  organizationId: string,
  provider: string,
): Promise<DbOrganizationTaskSettings | null> {
  const db = await getDb();
  const rows = await db.select<DbOrganizationTaskSettings[]>(
    `SELECT * FROM organization_task_settings
     WHERE organization_id = $1 AND provider = $2`,
    [organizationId, provider],
  );
  return rows[0] ?? null;
}
