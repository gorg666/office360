import type { Task, TaskSource } from "./domain";
import { getMessageById } from "@/services/db/messages";
import { navigateToLabel } from "@/router/navigate";
import { useAccountStore } from "@/stores/accountStore";

export type OpenTaskSourceMailResult =
  | { ok: true; threadId: string; accountId: string }
  | { ok: false; reason: "no-source" | "missing" | "permission-denied" };

export const OPEN_SOURCE_MAIL_COPY = {
  missing: "Исходное письмо недоступно",
  "permission-denied": "Исходное письмо недоступно",
  "no-source": "Исходное письмо недоступно",
} as const;

export interface OpenTaskSourceMailDeps {
  getMessageById?: typeof getMessageById;
  findMessageByRfc?: (accountId: string, rfcMessageId: string) => Promise<{ thread_id: string } | null>;
  getAccounts?: () => Array<{ id: string; isActive: boolean }>;
  setActiveAccount?: (id: string) => void;
  navigateToLabel?: typeof navigateToLabel;
}

async function defaultFindByRfc(
  accountId: string,
  rfcMessageId: string,
): Promise<{ thread_id: string } | null> {
  const { getDb } = await import("@/services/db/connection");
  const db = await getDb();
  const needle = rfcMessageId.trim();
  if (!needle) return null;
  const rows = await db.select<Array<{ thread_id: string }>>(
    `SELECT thread_id FROM messages
     WHERE account_id = $1
       AND (
         message_id_header = $2
         OR lower(message_id_header) = lower($2)
         OR message_id_header = $3
         OR lower(message_id_header) = lower($3)
       )
     LIMIT 1`,
    [accountId, needle, needle.replace(/^<|>$/g, "")],
  );
  return rows[0] ?? null;
}

export function pickMailSource(task: Pick<Task, "source">): TaskSource | null {
  return task.source.find((source) => source.type === "mail") ?? null;
}

/**
 * Open the mail message that originated a task using canonical TaskSource refs.
 * Does not expand mailbox permissions — account must already exist locally.
 */
export async function openTaskSourceMail(
  task: Pick<Task, "source">,
  deps: OpenTaskSourceMailDeps = {},
): Promise<OpenTaskSourceMailResult> {
  const source = pickMailSource(task);
  if (!source) return { ok: false, reason: "no-source" };

  const accountId = source.accountId?.trim() ?? "";
  if (!accountId) return { ok: false, reason: "missing" };

  const getAccounts = deps.getAccounts
    ?? (() => useAccountStore.getState().accounts);
  const accounts = getAccounts();
  const account = accounts.find((item) => item.id === accountId);
  if (!account) return { ok: false, reason: "permission-denied" };

  const getMessage = deps.getMessageById ?? getMessageById;
  const findByRfc = deps.findMessageByRfc ?? defaultFindByRfc;
  const navigate = deps.navigateToLabel ?? navigateToLabel;
  const setActive = deps.setActiveAccount
    ?? ((id: string) => useAccountStore.getState().setActiveAccount(id));

  let threadId = source.threadId?.trim() || null;

  if (source.messageId?.trim()) {
    const message = await getMessage(accountId, source.messageId.trim());
    if (message?.thread_id) {
      threadId = message.thread_id;
    } else if (!threadId) {
      // messageId present but row gone — try RFC fallback before failing
      if (source.rfcMessageId?.trim()) {
        const byRfc = await findByRfc(accountId, source.rfcMessageId.trim());
        threadId = byRfc?.thread_id ?? null;
      }
      if (!threadId) return { ok: false, reason: "missing" };
    }
  } else if (!threadId && source.rfcMessageId?.trim()) {
    const byRfc = await findByRfc(accountId, source.rfcMessageId.trim());
    threadId = byRfc?.thread_id ?? null;
  }

  if (!threadId) return { ok: false, reason: "missing" };

  if (!account.isActive) setActive(accountId);
  navigate("all", { threadId });
  return { ok: true, threadId, accountId };
}
