import type { EmailProvider, EmailFolder, EmailFolderQuota, SyncResult } from "./types";
import type { ParsedMessage } from "../gmail/messageParser";
import { IMAP_CAPABILITIES } from "./providerCapabilities";
import { buildImapConfig, buildSmtpConfig } from "../imap/imapConfigBuilder";
import { imapInitialSync, imapDeltaSync, imapMessageToParsedMessage } from "../imap/imapSync";
import { mapFolderToLabel, getSyncableFolders } from "../imap/folderMapper";
import {
  imapListFolders,
  imapCreateFolder,
  imapDeleteFolder,
  imapRenameFolder,
  imapSetFolderSubscription,
  imapGetFolderQuota,
  imapSetFlags,
  imapMoveMessages,
  imapDeleteMessages,
  imapFetchMessageBody,
  imapFetchAttachment,
  imapFetchRawMessage,
  imapTestConnection,
  imapAppendMessage,
  smtpSendEmail,
  smtpTestConnection,
  type ImapConfig,
  type SmtpConfig,
} from "../imap/tauriCommands";
import { getAccount, type DbAccount } from "../db/accounts";
import { extractTextAndHtmlFromRawEmail } from "@/utils/rawEmailBodies";
import { parseSingleEmailAddress } from "@/utils/emailAddressParse";
import { decodeMimeWords } from "@/utils/mimeHeaderDecode";
import { normalizeEmail } from "@/utils/emailUtils";
import { findSpecialFolder } from "../imap/messageHelper";
import { ensureFreshToken } from "../oauth/oauthTokenManager";
import { getDb } from "../db/connection";
import { getMessagesForThread, upsertMessage } from "../db/messages";
import { upsertThread, setThreadLabels, getThreadLabelIds, getThreadById } from "../db/threads";
import { markSmartFoldersMissingReference, rewriteSmartFolderReference } from "../db/smartFolders";

/**
 * Decode base64url (Gmail/RFC 4648 URL-safe, no padding) to a UTF-8 string.
 */
function base64UrlDecode(input: string): string {
  // Convert base64url to standard base64
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding if needed
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Parse basic RFC 2822 headers from a raw email string.
 * Returns a map of header name (lowercase) → header value.
 */
function parseBasicHeaders(raw: string): Map<string, string> {
  const headers = new Map<string, string>();
  // Headers end at the first blank line
  const headerEnd = raw.indexOf("\r\n\r\n");
  const headerSection = headerEnd !== -1 ? raw.slice(0, headerEnd) : raw;

  // Unfold continuation lines (lines starting with space/tab are continuations)
  const unfolded = headerSection.replace(/\r\n([ \t])/g, " ");

  for (const line of unfolded.split("\r\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const name = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();
    headers.set(name, value);
  }

  return headers;
}

/**
 * Extract a plain-text snippet from a raw RFC 2822 email body.
 */
function extractSnippet(raw: string, maxLen = 200): string {
  const bodyStart = raw.indexOf("\r\n\r\n");
  if (bodyStart === -1) return "";

  let body = raw.slice(bodyStart + 4);

  // For multipart messages, try to find the text/plain part
  const contentType = parseBasicHeaders(raw).get("content-type") ?? "";
  const boundaryMatch = contentType.match(/boundary="?([^";\s]+)"?/);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1]!;
    const parts = body.split(`--${boundary}`);
    for (const part of parts) {
      if (part.toLowerCase().includes("content-type: text/plain")) {
        const partBodyStart = part.indexOf("\r\n\r\n");
        if (partBodyStart !== -1) {
          body = part.slice(partBodyStart + 4);
          break;
        }
      }
    }
  }

  // Strip HTML tags if present, trim, and truncate
  return body
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

const PROTECTED_SPECIAL_USES = new Set([
  "\\Inbox",
  "\\Sent",
  "\\Drafts",
  "\\Trash",
  "\\Junk",
  "\\Archive",
  "\\All",
]);

function isProtectedFolderPath(path: string): boolean {
  return path.toUpperCase() === "INBOX";
}

function ensureMutableFolder(path: string, specialUse?: string | null): void {
  if (isProtectedFolderPath(path) || (specialUse && PROTECTED_SPECIAL_USES.has(specialUse))) {
    throw new Error("System and special-use folders cannot be renamed or deleted.");
  }
}

function mapQuota(quota: Awaited<ReturnType<typeof imapGetFolderQuota>>): EmailFolderQuota {
  return {
    folder: quota.folder,
    quotaRoots: quota.quota_roots,
    resources: quota.resources.map((resource) => ({
      name: resource.name,
      usage: resource.usage,
      limit: resource.limit,
      percentUsed: resource.percent_used,
    })),
    supported: quota.supported,
    reason: quota.reason ?? undefined,
  };
}

/**
 * EmailProvider adapter for IMAP/SMTP accounts.
 * Delegates to Tauri IMAP/SMTP commands via the imapSync engine.
 */
export class ImapSmtpProvider implements EmailProvider {
  readonly accountId: string;
  readonly type = "imap" as const;
  readonly capabilities = IMAP_CAPABILITIES;

  private _imapConfig: ImapConfig | null = null;
  private _smtpConfig: SmtpConfig | null = null;

  constructor(accountId: string) {
    this.accountId = accountId;
  }

  private async getAccount(): Promise<DbAccount> {
    const account = await getAccount(this.accountId);
    if (!account) {
      throw new Error(`Account ${this.accountId} not found`);
    }
    return account;
  }

  private async getImapConfig(): Promise<ImapConfig> {
    const account = await this.getAccount();
    if (account.auth_method === "oauth2") {
      // OAuth accounts need a fresh token every time
      const token = await ensureFreshToken(account);
      return buildImapConfig(account, token);
    }
    if (!this._imapConfig) {
      this._imapConfig = buildImapConfig(account);
    }
    return this._imapConfig;
  }

  private async getSmtpConfig(forceRefresh = false): Promise<SmtpConfig> {
    const account = await this.getAccount();
    if (account.auth_method === "oauth2") {
      const token = await ensureFreshToken(account, {
        forceRefresh,
      });
      return buildSmtpConfig(account, token);
    }
    if (!this._smtpConfig) {
      this._smtpConfig = buildSmtpConfig(account);
    }
    return this._smtpConfig;
  }

  private isOAuthAuthFailure(err: unknown): boolean {
    const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return (
      message.includes("authentication") ||
      message.includes("xoauth") ||
      message.includes("unauthorized") ||
      message.includes("invalid_token") ||
      message.includes("expired_token") ||
      message.includes("invalid_grant") ||
      message.includes("535") ||
      message.includes("534")
    );
  }

  /**
   * Invalidate cached configs (e.g., after password change).
   */
  clearConfigCache(): void {
    this._imapConfig = null;
    this._smtpConfig = null;
  }

  // ---- Folder/Label operations ----

  async listFolders(): Promise<EmailFolder[]> {
    const config = await this.getImapConfig();
    const imapFolders = await imapListFolders(config);
    const syncable = getSyncableFolders(imapFolders);

    return syncable.map((f) => {
      const mapping = mapFolderToLabel(f);
      return {
        id: mapping.labelId,
        name: mapping.labelName,
        path: f.path,
        rawPath: f.raw_path,
        type: mapping.type as "system" | "user",
        specialUse: f.special_use,
        delimiter: f.delimiter,
        subscribed: f.subscribed,
        selectable: f.selectable,
        hasChildren: f.has_children,
        quota: null,
        retention: this.capabilities.folders.retention,
        messageCount: f.exists,
        unreadCount: f.unseen,
      };
    });
  }

  async createFolder(
    name: string,
    parentPath?: string,
  ): Promise<EmailFolder> {
    const config = await this.getImapConfig();
    await imapCreateFolder(config, name, parentPath);
    const folders = await this.listFolders();
    const created = folders.find((folder) =>
      folder.rawPath === name ||
      folder.path === name ||
      folder.name === name ||
      (parentPath ? folder.rawPath === `${parentPath}/${name}` || folder.path === `${parentPath}/${name}` : false)
    );
    if (created) return created;
    return {
      id: `folder-${parentPath ? `${parentPath}/${name}` : name}`,
      name,
      path: parentPath ? `${parentPath}/${name}` : name,
      rawPath: parentPath ? `${parentPath}/${name}` : name,
      type: "user",
      specialUse: null,
      delimiter: "/",
      subscribed: true,
      selectable: true,
      hasChildren: false,
      quota: null,
      retention: this.capabilities.folders.retention,
      messageCount: 0,
      unreadCount: 0,
    };
  }

  async deleteFolder(path: string): Promise<void> {
    const folder = (await this.listFolders()).find((f) => f.rawPath === path || f.path === path);
    ensureMutableFolder(path, folder?.specialUse);
    const config = await this.getImapConfig();
    await imapDeleteFolder(config, folder?.rawPath ?? path);
    await markSmartFoldersMissingReference(
      this.accountId,
      "folderpath",
      folder?.rawPath ?? path,
      `Folder ${folder?.name ?? path} was deleted.`,
    );
  }

  async renameFolder(path: string, newName: string): Promise<void> {
    const folder = (await this.listFolders()).find((f) => f.rawPath === path || f.path === path);
    ensureMutableFolder(path, folder?.specialUse);
    const config = await this.getImapConfig();
    const nextRawPath = await imapRenameFolder(config, folder?.rawPath ?? path, newName);
    await rewriteSmartFolderReference(this.accountId, "folderpath", folder?.rawPath ?? path, nextRawPath);
  }

  async setFolderSubscription(path: string, subscribed: boolean): Promise<void> {
    const config = await this.getImapConfig();
    await imapSetFolderSubscription(config, path, subscribed);
  }

  async getFolderQuota(path: string): Promise<EmailFolderQuota> {
    const config = await this.getImapConfig();
    const quota = await imapGetFolderQuota(config, path);
    return mapQuota(quota);
  }

  // ---- Sync operations ----

  async initialSync(
    daysBack: number,
    onProgress?: (phase: string, current: number, total: number) => void,
  ): Promise<SyncResult> {
    return imapInitialSync(this.accountId, daysBack, onProgress ? (p) => {
      onProgress(p.phase, p.current, p.total);
    } : undefined);
  }

  async deltaSync(_syncToken: string): Promise<SyncResult> {
    return imapDeltaSync(this.accountId);
  }

  // ---- Message operations ----

  async fetchMessage(messageId: string): Promise<ParsedMessage> {
    const { folder, uid } = this.parseImapMessageId(messageId);

    if (uid === null || !folder) {
      throw new Error(`Invalid IMAP message ID format: ${messageId}`);
    }

    const config = await this.getImapConfig();
    const imapMsg = await imapFetchMessageBody(config, folder, uid);

    const { parsed } = imapMessageToParsedMessage(
      imapMsg,
      this.accountId,
      folder,
    );
    parsed.id = messageId;

    return parsed;
  }

  async fetchAttachment(
    messageId: string,
    attachmentId: string,
  ): Promise<{ data: string; size: number }> {
    const { folder, uid } = this.parseImapMessageId(messageId);

    if (uid === null || !folder) {
      throw new Error(`Invalid IMAP message ID format: ${messageId}`);
    }

    const config = await this.getImapConfig();
    const data = await imapFetchAttachment(config, folder, uid, attachmentId);
    return { data, size: data.length };
  }

  async fetchRawMessage(messageId: string): Promise<string> {
    const { folder, uid } = this.parseImapMessageId(messageId);

    if (uid === null || !folder) {
      throw new Error(`Invalid IMAP message ID format: ${messageId}`);
    }

    const config = await this.getImapConfig();
    return imapFetchRawMessage(config, folder, uid);
  }

  // ---- Actions ----

  async archive(
    _threadId: string,
    _messageIds: string[],
  ): Promise<void> {
    const config = await this.getImapConfig();
    const ids = await this.resolveMessageIdsForThread(_threadId, _messageIds);
    const grouped = this.groupByFolder(ids);
    const archiveFolder =
      (await findSpecialFolder(this.accountId, "\\Archive")) ?? "Archive";

    for (const [folder, uids] of grouped) {
      if (folder === archiveFolder) continue;
      await imapMoveMessages(config, folder, uids, archiveFolder);
    }
  }

  async trash(
    _threadId: string,
    _messageIds: string[],
  ): Promise<void> {
    const config = await this.getImapConfig();
    const ids = await this.resolveMessageIdsForThread(_threadId, _messageIds);
    const grouped = this.groupByFolder(ids);
    const trashFolder =
      (await findSpecialFolder(this.accountId, "\\Trash")) ?? "Trash";

    for (const [folder, uids] of grouped) {
      if (folder === trashFolder) continue;
      await imapMoveMessages(config, folder, uids, trashFolder);
    }
  }

  async permanentDelete(
    _threadId: string,
    _messageIds: string[],
  ): Promise<void> {
    const config = await this.getImapConfig();
    const ids = await this.resolveMessageIdsForThread(_threadId, _messageIds);
    const grouped = this.groupByFolder(ids);

    for (const [folder, uids] of grouped) {
      await imapDeleteMessages(config, folder, uids);
    }
  }

  async markRead(
    _threadId: string,
    _messageIds: string[],
    read: boolean,
  ): Promise<void> {
    const config = await this.getImapConfig();
    const ids = await this.resolveMessageIdsForThread(_threadId, _messageIds);
    const grouped = this.groupByFolder(ids);

    for (const [folder, uids] of grouped) {
      await imapSetFlags(config, folder, uids, ["Seen"], read);
    }
  }

  async star(
    _threadId: string,
    _messageIds: string[],
    starred: boolean,
  ): Promise<void> {
    const config = await this.getImapConfig();
    const ids = await this.resolveMessageIdsForThread(_threadId, _messageIds);
    const grouped = this.groupByFolder(ids);

    for (const [folder, uids] of grouped) {
      await imapSetFlags(config, folder, uids, ["Flagged"], starred);
    }
  }

  async spam(
    _threadId: string,
    _messageIds: string[],
    isSpam: boolean,
  ): Promise<void> {
    const config = await this.getImapConfig();
    const ids = await this.resolveMessageIdsForThread(_threadId, _messageIds);
    const grouped = this.groupByFolder(ids);
    const junkFolder =
      (await findSpecialFolder(this.accountId, "\\Junk")) ?? "Junk";
    const destination = isSpam ? junkFolder : "INBOX";

    for (const [folder, uids] of grouped) {
      if (folder === destination) continue;
      await imapMoveMessages(config, folder, uids, destination);
    }
  }

  async moveToFolder(
    _threadId: string,
    _messageIds: string[],
    folderPath: string,
  ): Promise<void> {
    const config = await this.getImapConfig();
    const ids = await this.resolveMessageIdsForThread(_threadId, _messageIds);
    const grouped = this.groupByFolder(ids);

    for (const [folder, uids] of grouped) {
      if (folder === folderPath) continue;
      await imapMoveMessages(config, folder, uids, folderPath);
    }
  }

  async addLabel(
    _threadId: string,
    _labelId: string,
  ): Promise<void> {
    // IMAP doesn't have native labels — this would require COPY to another folder
    // or using IMAP keywords (if server supports them).
    // For now, this is a no-op with a warning.
    console.warn(
      "IMAP does not natively support labels. " +
        "Use moveToFolder() to move messages between folders instead.",
    );
  }

  async removeLabel(
    _threadId: string,
    _labelId: string,
  ): Promise<void> {
    // IMAP doesn't have native labels.
    console.warn(
      "IMAP does not natively support labels. " +
        "Use moveToFolder() to move messages between folders instead.",
    );
  }

  // ---- Send/Draft operations ----

  async sendMessage(
    rawBase64Url: string,
    _threadId?: string,
  ): Promise<{
    id: string;
    smtpAccepted?: boolean;
    appendedToSent?: boolean;
    localPersisted?: boolean;
  }> {
    const sendOnce = async (forceRefresh: boolean) => {
      const smtpConfig = await this.getSmtpConfig(forceRefresh);
      const result = await smtpSendEmail(smtpConfig, rawBase64Url);
      if (!result.success) {
        throw new Error(`SMTP send failed: ${result.message}`);
      }
    };

    try {
      await sendOnce(false);
    } catch (err) {
      const account = await this.getAccount();
      if (account.auth_method === "oauth2" && this.isOAuthAuthFailure(err)) {
        console.warn(
          "[SMTP] auth failure with cached OAuth token — forcing refresh and retry once",
        );
        this.clearConfigCache();
        await sendOnce(true);
      } else {
        throw err;
      }
    }

    const messageId = `imap-sent-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Copy to server Sent. Always also keep a local SENT placeholder so UI
    // shows the message immediately; IMAP sync dedupes via Message-ID header.
    let appendedToSent = false;
    try {
      const imapConfig = await this.getImapConfig();
      const sentFolder =
        (await findSpecialFolder(this.accountId, "\\Sent")) ?? "Sent";
      await imapAppendMessage(imapConfig, sentFolder, rawBase64Url, "(\\Seen)");
      appendedToSent = true;
    } catch (err) {
      console.error(
        "[IMAP] Failed to copy sent message to Sent folder on server:",
        err,
      );
    }

    let localPersisted = false;
    try {
      await this.saveSentMessageLocally(rawBase64Url, messageId, _threadId);
      localPersisted = true;
    } catch (err) {
      console.warn("[IMAP] Failed to save sent message to local DB:", err);
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("velo-sync-done"));
    }

    return {
      id: messageId,
      smtpAccepted: true,
      appendedToSent,
      localPersisted,
    };
  }

  /**
   * Persist a local SENT copy for immediate UI (and APPEND fallback).
   */
  private async saveSentMessageLocally(
    rawBase64Url: string,
    messageId: string,
    threadId?: string,
  ): Promise<void> {
    const raw = base64UrlDecode(rawBase64Url);
    const headers = parseBasicHeaders(raw);
    const fallbackSnippet = extractSnippet(raw);

    const from = headers.get("from") ?? "";
    const to = headers.get("to") ?? "";
    const cc = headers.get("cc") ?? null;
    const subjectRaw = headers.get("subject") ?? null;
    const subject = subjectRaw ? decodeMimeWords(subjectRaw) ?? subjectRaw : null;
    const messageIdHeader = headers.get("message-id") ?? null;
    const inReplyTo = headers.get("in-reply-to") ?? null;
    const references = headers.get("references") ?? null;
    const now = Date.now();

    const bodies = extractTextAndHtmlFromRawEmail(raw);
    const maxBody = 50000;
    const bodyHtml = bodies.html ? bodies.html.slice(0, maxBody) : null;
    const bodyText = bodies.text ? bodies.text.slice(0, maxBody) : null;
    const snippetFromBodies =
      bodyText?.trim()
        ? bodyText.replace(/\s+/g, " ").trim().slice(0, 200)
        : bodyHtml
          ? bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)
          : "";
    const effectiveSnippet = snippetFromBodies || fallbackSnippet;
    const hasAttachments = /content-disposition:\s*attachment\b/i.test(raw);

    // For replies, add the SENT label to the existing thread.
    // For new compositions, create a new thread.
    const effectiveThreadId = threadId ?? messageId;

    if (threadId) {
      // Reply: add SENT label to existing thread
      const existingLabels = await getThreadLabelIds(this.accountId, threadId);
      if (!existingLabels.includes("SENT")) {
        await setThreadLabels(this.accountId, threadId, [...existingLabels, "SENT"]);
      }
    } else {
      // New thread: create thread record
      await upsertThread({
        id: effectiveThreadId,
        accountId: this.accountId,
        subject,
        snippet: effectiveSnippet,
        lastMessageAt: now,
        messageCount: 1,
        isRead: true,
        isStarred: false,
        isImportant: false,
        hasAttachments,
      });
      await setThreadLabels(this.accountId, effectiveThreadId, ["SENT"]);
    }

    const { name: parsedFromName, address: fromAddressRaw } = parseSingleEmailAddress(from);
    let fromName = parsedFromName;
    const fromAddress = fromAddressRaw ?? "";
    if (!fromName && fromAddress) {
      const acc = await this.getAccount();
      if (acc && normalizeEmail(acc.email) === normalizeEmail(fromAddress)) {
        const dn = acc.display_name?.trim();
        fromName = dn || null;
      }
    }

    await upsertMessage({
      id: messageId,
      accountId: this.accountId,
      threadId: effectiveThreadId,
      fromAddress: fromAddress || null,
      fromName,
      toAddresses: to,
      ccAddresses: cc,
      bccAddresses: null, // BCC is intentionally omitted from stored messages
      replyTo: null,
      subject,
      snippet: effectiveSnippet,
      date: now,
      isRead: true,
      isStarred: false,
      bodyHtml,
      bodyText,
      rawSize: raw.length,
      internalDate: now,
      messageIdHeader,
      referencesHeader: references,
      inReplyToHeader: inReplyTo,
    });

    if (threadId) {
      const existing = await getThreadById(this.accountId, threadId);
      const db = await getDb();
      const countRows = await db.select<{ c: number }[]>(
        "SELECT COUNT(*) as c FROM messages WHERE account_id = $1 AND thread_id = $2",
        [this.accountId, threadId],
      );
      const messageCount = countRows[0]?.c ?? 1;
      await upsertThread({
        id: threadId,
        accountId: this.accountId,
        subject: existing?.subject ?? subject,
        snippet: effectiveSnippet,
        lastMessageAt: now,
        messageCount,
        isRead: existing?.is_read === 1,
        isStarred: existing?.is_starred === 1,
        isImportant: existing?.is_important === 1,
        hasAttachments: existing?.has_attachments === 1 || hasAttachments,
      });
    }
  }

  async createDraft(
    rawBase64Url: string,
    _threadId?: string,
  ): Promise<{ draftId: string }> {
    const config = await this.getImapConfig();
    const draftsFolder =
      (await findSpecialFolder(this.accountId, "\\Drafts")) ?? "Drafts";

    await imapAppendMessage(config, draftsFolder, rawBase64Url, "(\\Draft)");

    // IMAP APPEND does not return the new UID, so generate a pseudo draft ID
    const draftId = `imap-draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return { draftId };
  }

  async updateDraft(
    draftId: string,
    rawBase64Url: string,
    _threadId?: string,
  ): Promise<{ draftId: string }> {
    // Delete the old draft first, then create a new one
    try {
      await this.deleteDraft(draftId);
    } catch {
      // Old draft may already be gone; continue with creating the new one
    }

    return this.createDraft(rawBase64Url, _threadId);
  }

  async deleteDraft(draftId: string): Promise<void> {
    // Try to parse draft ID to get folder + UID info
    // Draft IDs from IMAP are in message ID format: imap-{accountId}-{folder}-{uid}
    const { folder, uid } = this.parseImapMessageId(draftId);

    if (uid !== null && folder) {
      const config = await this.getImapConfig();
      await imapDeleteMessages(config, folder, [uid]);
    } else {
      // Generated draft IDs (imap-draft-...) can't be mapped back to a server UID
      console.warn(
        `Draft ${draftId} has a generated ID and cannot be deleted from server. ` +
          "It will be cleaned up on next sync.",
      );
    }
  }

  // ---- Connection ----

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const imapConfig = await this.getImapConfig();
      const imapResult = await imapTestConnection(imapConfig);

      // Also test SMTP connectivity
      try {
        const smtpConfig = await this.getSmtpConfig();
        const smtpResult = await smtpTestConnection(smtpConfig);
        if (!smtpResult.success) {
          return {
            success: false,
            message: `IMAP OK, but SMTP failed: ${smtpResult.message}`,
          };
        }
      } catch (err) {
        return {
          success: false,
          message: `IMAP OK, but SMTP failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      return { success: true, message: `Connected: ${imapResult}` };
    } catch (err) {
      return {
        success: false,
        message: `IMAP connection failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async getProfile(): Promise<{ email: string; name?: string }> {
    const account = await this.getAccount();
    return {
      email: account.email,
      name: account.display_name ?? undefined,
    };
  }

  // ---- Helpers ----

  /**
   * UI often passes an empty `messageIds` (thread-level actions). Gmail uses threadId on the API;
   * IMAP needs concrete messages — load from the local DB.
   */
  private async resolveMessageIdsForThread(
    threadId: string,
    messageIds: string[],
  ): Promise<string[]> {
    if (messageIds.length > 0) {
      return messageIds;
    }
    const rows = await getMessagesForThread(this.accountId, threadId);
    return rows.map((m) => m.id);
  }

  /**
   * Parse IMAP message IDs and group UIDs by folder.
   * Message ID format: imap-{accountId}-{folder}-{uid}
   * Since accountId can contain hyphens, we strip the known prefix
   * "imap-{this.accountId}-" and then parse the remaining "{folder}-{uid}".
   */
  private groupByFolder(messageIds: string[]): Map<string, number[]> {
    const grouped = new Map<string, number[]>();
    const prefix = `imap-${this.accountId}-`;

    for (const messageId of messageIds) {
      const { folder, uid } = this.parseImapMessageId(messageId, prefix);

      if (uid === null || !folder) {
        console.warn(`Skipping invalid IMAP message ID: ${messageId}`);
        continue;
      }

      const existing = grouped.get(folder);
      if (existing) {
        existing.push(uid);
      } else {
        grouped.set(folder, [uid]);
      }
    }

    return grouped;
  }

  /**
   * Parse an IMAP message ID into folder and uid.
   * Returns { folder, uid } or { folder: null, uid: null } if invalid.
   */
  private parseImapMessageId(
    messageId: string,
    prefix?: string,
  ): { folder: string | null; uid: number | null } {
    const p = prefix ?? `imap-${this.accountId}-`;

    if (!messageId.startsWith(p)) {
      return { folder: null, uid: null };
    }

    // After stripping prefix, remainder is "{folder}-{uid}"
    const remainder = messageId.slice(p.length);
    const lastDash = remainder.lastIndexOf("-");
    if (lastDash === -1) {
      return { folder: null, uid: null };
    }

    const folder = remainder.slice(0, lastDash);
    const uid = parseInt(remainder.slice(lastDash + 1), 10);

    if (!folder || isNaN(uid)) {
      return { folder: null, uid: null };
    }

    return { folder, uid };
  }
}
