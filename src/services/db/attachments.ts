import { getDb } from "./connection";

export interface DbAttachment {
  id: string;
  message_id: string;
  account_id: string;
  filename: string | null;
  mime_type: string | null;
  size: number | null;
  gmail_attachment_id: string | null;
  imap_part_id?: string | null;
  content_id: string | null;
  is_inline: number;
  local_path: string | null;
}

const ATTACHMENT_LIBRARY_FILTER = `
       a.filename IS NOT NULL AND a.filename != ''
       AND a.is_inline = 0
       AND NOT (
         a.content_id IS NOT NULL
         AND LOWER(COALESCE(a.mime_type, '')) LIKE 'image/%'
       )`;

export async function upsertAttachment(att: {
  id: string;
  messageId: string;
  accountId: string;
  filename: string | null;
  mimeType: string | null;
  size: number | null;
  gmailAttachmentId: string | null;
  contentId: string | null;
  isInline: boolean;
}): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO attachments (id, message_id, account_id, filename, mime_type, size, gmail_attachment_id, content_id, is_inline)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT(id) DO UPDATE SET
       filename = $4, mime_type = $5, size = $6,
       gmail_attachment_id = $7, content_id = $8, is_inline = $9`,
    [
      att.id,
      att.messageId,
      att.accountId,
      att.filename,
      att.mimeType,
      att.size,
      att.gmailAttachmentId,
      att.contentId,
      att.isInline ? 1 : 0,
    ],
  );
}

export interface AttachmentWithContext {
  id: string;
  message_id: string;
  account_id: string;
  filename: string | null;
  mime_type: string | null;
  size: number | null;
  gmail_attachment_id: string | null;
  imap_part_id?: string | null;
  content_id: string | null;
  is_inline: number;
  local_path: string | null;
  from_address: string | null;
  from_name: string | null;
  date: number | null;
  subject: string | null;
  thread_id: string | null;
}

export async function getAttachmentsForAccount(
  accountId: string,
  limit = 200,
  offset = 0,
): Promise<AttachmentWithContext[]> {
  const db = await getDb();
  return db.select<AttachmentWithContext[]>(
    `SELECT a.*, m.from_address, m.from_name, m.date, m.subject, m.thread_id
     FROM attachments a
     JOIN messages m ON a.message_id = m.id AND a.account_id = m.account_id
     WHERE a.account_id = $1
       AND ${ATTACHMENT_LIBRARY_FILTER}
     ORDER BY m.date DESC
     LIMIT $2 OFFSET $3`,
    [accountId, limit, offset],
  );
}

export interface AttachmentSender {
  from_address: string;
  from_name: string | null;
  count: number;
}

export async function getAttachmentSenders(
  accountId: string,
): Promise<AttachmentSender[]> {
  const db = await getDb();
  return db.select<AttachmentSender[]>(
    `SELECT m.from_address, m.from_name, COUNT(*) as count
     FROM attachments a
     JOIN messages m ON a.message_id = m.id AND a.account_id = m.account_id
     WHERE a.account_id = $1
       AND ${ATTACHMENT_LIBRARY_FILTER}
       AND m.from_address IS NOT NULL
     GROUP BY m.from_address
     ORDER BY count DESC`,
    [accountId],
  );
}

export async function getAttachmentsForMessage(
  accountId: string,
  messageId: string,
): Promise<DbAttachment[]> {
  const db = await getDb();
  return db.select<DbAttachment[]>(
    "SELECT * FROM attachments WHERE account_id = $1 AND message_id = $2 ORDER BY filename ASC",
    [accountId, messageId],
  );
}

// ---------- Раздел «Файлы»: входящие / исходящие вложения из писем ----------

export type MailFilesDirection = "incoming" | "outgoing";

export type MailFilesSortKey = "date" | "filename" | "size";

export type MailFilesSortDir = "asc" | "desc";

export type MailFilesTypeCategory =
  | "all"
  | "documents"
  | "images"
  | "archives"
  | "spreadsheets"
  | "pdf"
  | "other";

export interface MailAttachmentFileRow extends AttachmentWithContext {
  to_addresses: string | null;
  cc_addresses: string | null;
  bcc_addresses: string | null;
}

function normalizeAccountEmail(email: string): string {
  return email.trim().toLowerCase();
}

function mailFilesOrderByClause(
  sortKey: MailFilesSortKey,
  sortDir: MailFilesSortDir,
): string {
  const d = sortDir === "asc" ? "ASC" : "DESC";
  if (sortKey === "filename") {
    return `ORDER BY LOWER(COALESCE(a.filename, '')) ${d}, COALESCE(m.date, 0) DESC`;
  }
  if (sortKey === "size") {
    return `ORDER BY COALESCE(a.size, 0) ${d}, COALESCE(m.date, 0) DESC`;
  }
  return `ORDER BY COALESCE(m.date, 0) ${d}, LOWER(COALESCE(a.filename, '')) ASC`;
}

/** Условие по категории типа файла (только литералы в SQL, без пользовательского ввода в структуру). */
function mailFilesCategoryCondition(category: MailFilesTypeCategory): string {
  if (category === "all") return "1 = 1";
  const fn = "LOWER(COALESCE(a.filename, ''))";
  const mt = "LOWER(COALESCE(a.mime_type, ''))";
  if (category === "pdf") {
    return `(${mt} = 'application/pdf' OR ${fn} LIKE '%.pdf')`;
  }
  if (category === "images") {
    return `(${mt} LIKE 'image/%' OR ${fn} LIKE '%.png' OR ${fn} LIKE '%.jpg' OR ${fn} LIKE '%.jpeg' OR ${fn} LIKE '%.gif' OR ${fn} LIKE '%.webp' OR ${fn} LIKE '%.bmp' OR ${fn} LIKE '%.svg')`;
  }
  if (category === "documents") {
    return `(${mt} LIKE '%msword%' OR ${mt} LIKE '%wordprocessingml%' OR ${mt} LIKE '%opendocument.text%' OR ${mt} = 'application/rtf' OR ${fn} LIKE '%.doc' OR ${fn} LIKE '%.docx' OR ${fn} LIKE '%.odt' OR ${fn} LIKE '%.rtf')`;
  }
  if (category === "spreadsheets") {
    return `(${mt} LIKE '%spreadsheet%' OR ${mt} LIKE '%excel%' OR ${mt} = 'text/csv' OR ${fn} LIKE '%.xls' OR ${fn} LIKE '%.xlsx' OR ${fn} LIKE '%.ods' OR ${fn} LIKE '%.csv')`;
  }
  if (category === "archives") {
    return `(${mt} LIKE '%zip%' OR ${mt} LIKE '%compressed%' OR ${mt} LIKE '%archive%' OR ${mt} LIKE '%tar%' OR ${mt} = 'application/gzip' OR ${mt} = 'application/x-gzip' OR ${fn} LIKE '%.zip' OR ${fn} LIKE '%.rar' OR ${fn} LIKE '%.7z' OR ${fn} LIKE '%.tar' OR ${fn} LIKE '%.gz')`;
  }
  const inner = [
    mailFilesCategoryCondition("pdf"),
    mailFilesCategoryCondition("images"),
    mailFilesCategoryCondition("documents"),
    mailFilesCategoryCondition("spreadsheets"),
    mailFilesCategoryCondition("archives"),
  ].join(" OR ");
  return `NOT (${inner})`;
}

function buildMailFilesParams(
  accountId: string,
  accountEmail: string,
  direction: MailFilesDirection,
  search: string | undefined,
): { whereExtra: string; params: unknown[] } {
  const emailNorm = normalizeAccountEmail(accountEmail);
  const params: unknown[] = [accountId];

  let whereExtra: string;
  if (direction === "outgoing") {
    params.push(emailNorm);
    whereExtra = `AND (
      EXISTS (
        SELECT 1 FROM thread_labels tl
        WHERE tl.account_id = m.account_id AND tl.thread_id = m.thread_id AND tl.label_id = 'SENT'
      )
      OR LOWER(TRIM(COALESCE(m.from_address, ''))) = LOWER(TRIM($2))
    )`;
  } else {
    params.push(emailNorm, emailNorm, emailNorm);
    whereExtra = `AND NOT (
      EXISTS (
        SELECT 1 FROM thread_labels tl
        WHERE tl.account_id = m.account_id AND tl.thread_id = m.thread_id AND tl.label_id = 'SENT'
      )
      OR LOWER(TRIM(COALESCE(m.from_address, ''))) = LOWER(TRIM($2))
    )
    AND (
      EXISTS (
        SELECT 1 FROM thread_labels tl
        WHERE tl.account_id = m.account_id AND tl.thread_id = m.thread_id AND tl.label_id = 'INBOX'
      )
      OR (
        LOWER(TRIM(COALESCE(m.from_address, ''))) <> LOWER(TRIM($3))
        AND (
          INSTR(LOWER(COALESCE(m.to_addresses, '')), LOWER($4)) > 0
          OR INSTR(LOWER(COALESCE(m.cc_addresses, '')), LOWER($4)) > 0
          OR INSTR(LOWER(COALESCE(m.bcc_addresses, '')), LOWER($4)) > 0
        )
      )
    )`;
  }

  const q = search?.trim();
  if (q) {
    const next = params.length + 1;
    params.push(q.toLowerCase());
    whereExtra += ` AND INSTR(LOWER(COALESCE(a.filename, '')), $${next}) > 0`;
  }

  return { whereExtra, params };
}

const MAIL_FILES_SELECT = `
  SELECT a.*, m.from_address, m.from_name, m.date, m.subject, m.thread_id,
         m.to_addresses, m.cc_addresses, m.bcc_addresses
  FROM attachments a
  JOIN messages m ON a.message_id = m.id AND a.account_id = m.account_id
  WHERE a.account_id = $1
    AND ${ATTACHMENT_LIBRARY_FILTER}
`;

export async function getMailFilesAttachments(
  accountId: string,
  accountEmail: string,
  direction: MailFilesDirection,
  options: {
    sortKey: MailFilesSortKey;
    sortDir: MailFilesSortDir;
    search?: string;
    category?: MailFilesTypeCategory;
    limit?: number;
    offset?: number;
  },
): Promise<MailAttachmentFileRow[]> {
  const db = await getDb();
  const { whereExtra, params } = buildMailFilesParams(
    accountId,
    accountEmail,
    direction,
    options.search,
  );
  const category = options.category ?? "all";
  const catSql = mailFilesCategoryCondition(category);
  const orderBy = mailFilesOrderByClause(options.sortKey, options.sortDir);
  const limit = options.limit ?? 80;
  const offset = options.offset ?? 0;
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const sql = `${MAIL_FILES_SELECT}
    ${whereExtra}
    AND (${catSql})
    ${orderBy}
    LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
  return db.select<MailAttachmentFileRow[]>(sql, [...params, limit, offset]);
}

export async function countMailFilesAttachments(
  accountId: string,
  accountEmail: string,
  direction: MailFilesDirection,
  options: { search?: string; category?: MailFilesTypeCategory },
): Promise<number> {
  const db = await getDb();
  const { whereExtra, params } = buildMailFilesParams(
    accountId,
    accountEmail,
    direction,
    options.search,
  );
  const category = options.category ?? "all";
  const catSql = mailFilesCategoryCondition(category);
  const sql = `SELECT COUNT(*) as cnt
    FROM attachments a
    JOIN messages m ON a.message_id = m.id AND a.account_id = m.account_id
    WHERE a.account_id = $1
      AND ${ATTACHMENT_LIBRARY_FILTER}
    ${whereExtra}
    AND (${catSql})`;
  const rows = await db.select<{ cnt: number }[]>(sql, params);
  return rows[0]?.cnt ?? 0;
}
