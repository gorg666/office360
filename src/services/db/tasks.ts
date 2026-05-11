import { getDb } from "./connection";

export type TaskPriority = "none" | "low" | "medium" | "high" | "urgent";

export interface DbTask {
  id: string;
  account_id: string | null;
  title: string;
  description: string | null;
  priority: TaskPriority;
  is_completed: number;
  completed_at: number | null;
  due_date: number | null;
  parent_id: string | null;
  thread_id: string | null;
  thread_account_id: string | null;
  sort_order: number;
  recurrence_rule: string | null;
  next_recurrence_at: number | null;
  tags_json: string;
  start_at: number | null;
  end_at: number | null;
  timezone: string | null;
  all_day: number;
  location: string | null;
  participants_json: string;
  optional_participants_json: string;
  attachments_json: string;
  reminder_minutes: number | null;
  reminder_channel: string | null;
  color_label: string | null;
  telemost_url: string | null;
  telemost_conference_id: string | null;
  telemost_live_url: string | null;
  created_at: number;
  updated_at: number;
}

export interface DbTaskTag {
  tag: string;
  account_id: string | null;
  color: string | null;
  sort_order: number;
  created_at: number;
}

const TASK_DETAIL_COLUMNS: { name: keyof DbTask; sql: string }[] = [
  { name: "start_at", sql: "ALTER TABLE tasks ADD COLUMN start_at INTEGER" },
  { name: "end_at", sql: "ALTER TABLE tasks ADD COLUMN end_at INTEGER" },
  { name: "timezone", sql: "ALTER TABLE tasks ADD COLUMN timezone TEXT" },
  { name: "all_day", sql: "ALTER TABLE tasks ADD COLUMN all_day INTEGER DEFAULT 0" },
  { name: "location", sql: "ALTER TABLE tasks ADD COLUMN location TEXT" },
  { name: "participants_json", sql: "ALTER TABLE tasks ADD COLUMN participants_json TEXT DEFAULT '[]'" },
  { name: "optional_participants_json", sql: "ALTER TABLE tasks ADD COLUMN optional_participants_json TEXT DEFAULT '[]'" },
  { name: "attachments_json", sql: "ALTER TABLE tasks ADD COLUMN attachments_json TEXT DEFAULT '[]'" },
  { name: "reminder_minutes", sql: "ALTER TABLE tasks ADD COLUMN reminder_minutes INTEGER" },
  { name: "reminder_channel", sql: "ALTER TABLE tasks ADD COLUMN reminder_channel TEXT" },
  { name: "color_label", sql: "ALTER TABLE tasks ADD COLUMN color_label TEXT" },
  { name: "telemost_url", sql: "ALTER TABLE tasks ADD COLUMN telemost_url TEXT" },
  { name: "telemost_conference_id", sql: "ALTER TABLE tasks ADD COLUMN telemost_conference_id TEXT" },
  { name: "telemost_live_url", sql: "ALTER TABLE tasks ADD COLUMN telemost_live_url TEXT" },
];

let taskDetailSchemaReady: Promise<void> | null = null;

async function ensureTaskDetailColumns(): Promise<void> {
  if (taskDetailSchemaReady) return taskDetailSchemaReady;

  taskDetailSchemaReady = (async () => {
    const db = await getDb();
    const columns = await db.select<{ name: string }[]>("PRAGMA table_info(tasks)");
    const existing = new Set(columns.map((column) => column.name));

    for (const column of TASK_DETAIL_COLUMNS) {
      if (existing.has(column.name)) continue;
      try {
        await db.execute(column.sql);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.toLowerCase().includes("duplicate column")) throw err;
      }
    }

    await db.execute("CREATE INDEX IF NOT EXISTS idx_tasks_start_at ON tasks(start_at)");
  })().catch((err) => {
    taskDetailSchemaReady = null;
    throw err;
  });

  return taskDetailSchemaReady;
}

export async function getTasksForAccount(
  accountId: string | null,
  includeCompleted = false,
): Promise<DbTask[]> {
  const db = await getDb();
  if (includeCompleted) {
    return db.select<DbTask[]>(
      `SELECT * FROM tasks WHERE (account_id = $1 OR account_id IS NULL) AND parent_id IS NULL
       ORDER BY is_completed ASC, sort_order ASC, created_at DESC`,
      [accountId],
    );
  }
  return db.select<DbTask[]>(
    `SELECT * FROM tasks WHERE (account_id = $1 OR account_id IS NULL) AND parent_id IS NULL AND is_completed = 0
     ORDER BY sort_order ASC, created_at DESC`,
    [accountId],
  );
}

export async function getTaskById(id: string): Promise<DbTask | null> {
  const db = await getDb();
  const rows = await db.select<DbTask[]>(
    "SELECT * FROM tasks WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

export async function getTasksForThread(
  accountId: string,
  threadId: string,
): Promise<DbTask[]> {
  const db = await getDb();
  return db.select<DbTask[]>(
    `SELECT * FROM tasks WHERE thread_account_id = $1 AND thread_id = $2
     ORDER BY is_completed ASC, sort_order ASC, created_at DESC`,
    [accountId, threadId],
  );
}

export async function getSubtasks(parentId: string): Promise<DbTask[]> {
  const db = await getDb();
  return db.select<DbTask[]>(
    "SELECT * FROM tasks WHERE parent_id = $1 ORDER BY sort_order ASC, created_at ASC",
    [parentId],
  );
}

export async function insertTask(task: {
  id?: string;
  accountId: string | null;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  dueDate?: number | null;
  parentId?: string | null;
  threadId?: string | null;
  threadAccountId?: string | null;
  sortOrder?: number;
  recurrenceRule?: string | null;
  tagsJson?: string;
  startAt?: number | null;
  endAt?: number | null;
  timezone?: string | null;
  allDay?: boolean;
  location?: string | null;
  participantsJson?: string;
  optionalParticipantsJson?: string;
  attachmentsJson?: string;
  reminderMinutes?: number | null;
  reminderChannel?: string | null;
  colorLabel?: string | null;
  telemostUrl?: string | null;
  telemostConferenceId?: string | null;
  telemostLiveUrl?: string | null;
}): Promise<string> {
  await ensureTaskDetailColumns();
  const db = await getDb();
  const id = task.id ?? crypto.randomUUID();
  await db.execute(
    `INSERT INTO tasks (
       id, account_id, title, description, priority, due_date, parent_id, thread_id,
       thread_account_id, sort_order, recurrence_rule, tags_json, start_at, end_at,
       timezone, all_day, location, participants_json, optional_participants_json,
       attachments_json, reminder_minutes, reminder_channel, color_label, telemost_url,
       telemost_conference_id, telemost_live_url
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
       $17, $18, $19, $20, $21, $22, $23, $24, $25, $26
     )`,
    [
      id,
      task.accountId,
      task.title,
      task.description ?? null,
      task.priority ?? "none",
      task.dueDate ?? null,
      task.parentId ?? null,
      task.threadId ?? null,
      task.threadAccountId ?? null,
      task.sortOrder ?? 0,
      task.recurrenceRule ?? null,
      task.tagsJson ?? "[]",
      task.startAt ?? null,
      task.endAt ?? null,
      task.timezone ?? null,
      task.allDay ? 1 : 0,
      task.location ?? null,
      task.participantsJson ?? "[]",
      task.optionalParticipantsJson ?? "[]",
      task.attachmentsJson ?? "[]",
      task.reminderMinutes ?? null,
      task.reminderChannel ?? null,
      task.colorLabel ?? null,
      task.telemostUrl ?? null,
      task.telemostConferenceId ?? null,
      task.telemostLiveUrl ?? null,
    ],
  );
  return id;
}

export async function updateTask(
  id: string,
  updates: {
    title?: string;
    description?: string | null;
    priority?: TaskPriority;
    dueDate?: number | null;
    sortOrder?: number;
    recurrenceRule?: string | null;
    nextRecurrenceAt?: number | null;
    tagsJson?: string;
    startAt?: number | null;
    endAt?: number | null;
    timezone?: string | null;
    allDay?: boolean;
    location?: string | null;
    participantsJson?: string;
    optionalParticipantsJson?: string;
    attachmentsJson?: string;
    reminderMinutes?: number | null;
    reminderChannel?: string | null;
    colorLabel?: string | null;
    telemostUrl?: string | null;
    telemostConferenceId?: string | null;
    telemostLiveUrl?: string | null;
  },
): Promise<void> {
  await ensureTaskDetailColumns();
  const db = await getDb();
  const sets: string[] = ["updated_at = unixepoch()"];
  const params: unknown[] = [];
  let idx = 1;

  if (updates.title !== undefined) {
    sets.push(`title = $${idx++}`);
    params.push(updates.title);
  }
  if (updates.description !== undefined) {
    sets.push(`description = $${idx++}`);
    params.push(updates.description);
  }
  if (updates.priority !== undefined) {
    sets.push(`priority = $${idx++}`);
    params.push(updates.priority);
  }
  if (updates.dueDate !== undefined) {
    sets.push(`due_date = $${idx++}`);
    params.push(updates.dueDate);
  }
  if (updates.sortOrder !== undefined) {
    sets.push(`sort_order = $${idx++}`);
    params.push(updates.sortOrder);
  }
  if (updates.recurrenceRule !== undefined) {
    sets.push(`recurrence_rule = $${idx++}`);
    params.push(updates.recurrenceRule);
  }
  if (updates.nextRecurrenceAt !== undefined) {
    sets.push(`next_recurrence_at = $${idx++}`);
    params.push(updates.nextRecurrenceAt);
  }
  if (updates.tagsJson !== undefined) {
    sets.push(`tags_json = $${idx++}`);
    params.push(updates.tagsJson);
  }
  if (updates.startAt !== undefined) {
    sets.push(`start_at = $${idx++}`);
    params.push(updates.startAt);
  }
  if (updates.endAt !== undefined) {
    sets.push(`end_at = $${idx++}`);
    params.push(updates.endAt);
  }
  if (updates.timezone !== undefined) {
    sets.push(`timezone = $${idx++}`);
    params.push(updates.timezone);
  }
  if (updates.allDay !== undefined) {
    sets.push(`all_day = $${idx++}`);
    params.push(updates.allDay ? 1 : 0);
  }
  if (updates.location !== undefined) {
    sets.push(`location = $${idx++}`);
    params.push(updates.location);
  }
  if (updates.participantsJson !== undefined) {
    sets.push(`participants_json = $${idx++}`);
    params.push(updates.participantsJson);
  }
  if (updates.optionalParticipantsJson !== undefined) {
    sets.push(`optional_participants_json = $${idx++}`);
    params.push(updates.optionalParticipantsJson);
  }
  if (updates.attachmentsJson !== undefined) {
    sets.push(`attachments_json = $${idx++}`);
    params.push(updates.attachmentsJson);
  }
  if (updates.reminderMinutes !== undefined) {
    sets.push(`reminder_minutes = $${idx++}`);
    params.push(updates.reminderMinutes);
  }
  if (updates.reminderChannel !== undefined) {
    sets.push(`reminder_channel = $${idx++}`);
    params.push(updates.reminderChannel);
  }
  if (updates.colorLabel !== undefined) {
    sets.push(`color_label = $${idx++}`);
    params.push(updates.colorLabel);
  }
  if (updates.telemostUrl !== undefined) {
    sets.push(`telemost_url = $${idx++}`);
    params.push(updates.telemostUrl);
  }
  if (updates.telemostConferenceId !== undefined) {
    sets.push(`telemost_conference_id = $${idx++}`);
    params.push(updates.telemostConferenceId);
  }
  if (updates.telemostLiveUrl !== undefined) {
    sets.push(`telemost_live_url = $${idx++}`);
    params.push(updates.telemostLiveUrl);
  }

  params.push(id);
  await db.execute(
    `UPDATE tasks SET ${sets.join(", ")} WHERE id = $${idx}`,
    params,
  );
}

export async function deleteTask(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM tasks WHERE id = $1", [id]);
}

export async function completeTask(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE tasks SET is_completed = 1, completed_at = unixepoch(), updated_at = unixepoch() WHERE id = $1",
    [id],
  );
}

export async function uncompleteTask(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE tasks SET is_completed = 0, completed_at = NULL, updated_at = unixepoch() WHERE id = $1",
    [id],
  );
}

export async function reorderTasks(
  taskIds: string[],
): Promise<void> {
  const db = await getDb();
  for (let i = 0; i < taskIds.length; i++) {
    await db.execute(
      "UPDATE tasks SET sort_order = $1, updated_at = unixepoch() WHERE id = $2",
      [i, taskIds[i]],
    );
  }
}

export async function getIncompleteTaskCount(
  accountId: string | null,
): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM tasks WHERE (account_id = $1 OR account_id IS NULL) AND is_completed = 0",
    [accountId],
  );
  return rows[0]?.count ?? 0;
}

export async function getTaskTags(
  accountId: string | null,
): Promise<DbTaskTag[]> {
  const db = await getDb();
  return db.select<DbTaskTag[]>(
    "SELECT * FROM task_tags WHERE account_id = $1 OR account_id IS NULL ORDER BY sort_order ASC",
    [accountId],
  );
}

export async function upsertTaskTag(
  tag: string,
  accountId: string | null,
  color?: string | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO task_tags (tag, account_id, color)
     VALUES ($1, $2, $3)
     ON CONFLICT(tag, account_id) DO UPDATE SET color = $3`,
    [tag, accountId, color ?? null],
  );
}

export async function deleteTaskTag(
  tag: string,
  accountId: string | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM task_tags WHERE tag = $1 AND account_id = $2",
    [tag, accountId],
  );
}
