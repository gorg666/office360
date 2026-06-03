import { executeWrite, getDb } from "./connection";

export interface DbLabel {
  id: string;
  account_id: string;
  name: string;
  type: string;
  color_bg: string | null;
  color_fg: string | null;
  visible: number;
  sort_order: number;
  imap_folder_path?: string | null;
  imap_special_use?: string | null;
  imap_subscribed?: number | null;
  imap_selectable?: number | null;
  imap_has_children?: number | null;
}

export async function getLabelsForAccount(
  accountId: string,
): Promise<DbLabel[]> {
  const db = await getDb();
  return db.select<DbLabel[]>(
    "SELECT * FROM labels WHERE account_id = $1 ORDER BY sort_order ASC, name ASC",
    [accountId],
  );
}

export async function upsertLabel(label: {
  id: string;
  accountId: string;
  name: string;
  type: string;
  colorBg?: string | null;
  colorFg?: string | null;
  imapFolderPath?: string | null;
  imapSpecialUse?: string | null;
  imapSubscribed?: boolean | null;
  imapSelectable?: boolean | null;
  imapHasChildren?: boolean | null;
}): Promise<void> {
  await executeWrite(
    `INSERT INTO labels (id, account_id, name, type, color_bg, color_fg, imap_folder_path, imap_special_use, imap_subscribed, imap_selectable, imap_has_children)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT(account_id, id) DO UPDATE SET
       name = $3, type = $4, color_bg = $5, color_fg = $6,
       imap_folder_path = COALESCE($7, imap_folder_path),
       imap_special_use = COALESCE($8, imap_special_use),
       imap_subscribed = COALESCE($9, imap_subscribed),
       imap_selectable = COALESCE($10, imap_selectable),
       imap_has_children = COALESCE($11, imap_has_children)`,
    [
      label.id,
      label.accountId,
      label.name,
      label.type,
      label.colorBg ?? null,
      label.colorFg ?? null,
      label.imapFolderPath ?? null,
      label.imapSpecialUse ?? null,
      label.imapSubscribed === undefined || label.imapSubscribed === null ? null : (label.imapSubscribed ? 1 : 0),
      label.imapSelectable === undefined || label.imapSelectable === null ? null : (label.imapSelectable ? 1 : 0),
      label.imapHasChildren === undefined || label.imapHasChildren === null ? null : (label.imapHasChildren ? 1 : 0),
    ],
  );
}

export async function deleteLabelsForAccount(
  accountId: string,
): Promise<void> {
  await executeWrite("DELETE FROM labels WHERE account_id = $1", [accountId]);
}

export async function deleteLabel(
  accountId: string,
  labelId: string,
): Promise<void> {
  await executeWrite(
    "DELETE FROM labels WHERE account_id = $1 AND id = $2",
    [accountId, labelId],
  );
}

export async function updateLabelSortOrder(
  accountId: string,
  labelOrders: { id: string; sortOrder: number }[],
): Promise<void> {
  const db = await getDb();
  await Promise.all(
    labelOrders.map(({ id, sortOrder }) =>
      db.execute(
        "UPDATE labels SET sort_order = $1 WHERE account_id = $2 AND id = $3",
        [sortOrder, accountId, id],
      ),
    ),
  );
}
