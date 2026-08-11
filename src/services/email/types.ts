import type { ParsedMessage } from "../gmail/messageParser";

export type AccountProvider = "gmail_api" | "imap" | "caldav" | "exchange";

export interface CapabilitySupport {
  supported: boolean;
  reason?: string;
}

export interface ProviderCapabilities {
  provider: AccountProvider;
  folders: {
    list: CapabilitySupport;
    create: CapabilitySupport;
    rename: CapabilitySupport;
    delete: CapabilitySupport;
    subscribe: CapabilitySupport;
    quota: CapabilitySupport;
    retention: CapabilitySupport;
  };
  labels: {
    native: CapabilitySupport;
    create: CapabilitySupport;
    rename: CapabilitySupport;
    delete: CapabilitySupport;
    add: CapabilitySupport;
    remove: CapabilitySupport;
    color: CapabilitySupport;
  };
  messages: {
    archive: CapabilitySupport;
    trash: CapabilitySupport;
    permanentDelete: CapabilitySupport;
    move: CapabilitySupport;
    markRead: CapabilitySupport;
    star: CapabilitySupport;
    spam: CapabilitySupport;
    rawFetch: CapabilitySupport;
  };
  compose: {
    send: CapabilitySupport;
    remoteDrafts: CapabilitySupport;
    appendSent: CapabilitySupport;
    aliases: CapabilitySupport;
  };
  diagnostics: {
    testIncoming: CapabilitySupport;
    testOutgoing: CapabilitySupport;
    testOAuth: CapabilitySupport;
    exportDebug: CapabilitySupport;
  };
}

export interface EmailFolder {
  id: string;
  name: string;
  path: string;
  rawPath: string;
  type: "system" | "user";
  specialUse: string | null;
  delimiter: string;
  subscribed: boolean;
  selectable: boolean;
  hasChildren: boolean;
  quota: EmailFolderQuota | null;
  retention: CapabilitySupport;
  messageCount: number;
  unreadCount: number;
}

export interface EmailFolderQuotaResource {
  name: string;
  usage: number;
  limit: number;
  percentUsed: number;
}

export interface EmailFolderQuota {
  folder: string;
  quotaRoots: string[];
  resources: EmailFolderQuotaResource[];
  supported: boolean;
  reason?: string;
}

export interface SyncResult {
  messages: ParsedMessage[];
  folderStatus?: {
    uidvalidity: number;
    lastUid: number;
    modseq?: number;
  };
  latestSyncToken?: string;
}

export interface EmailProvider {
  readonly accountId: string;
  readonly type: AccountProvider;
  readonly capabilities: ProviderCapabilities;

  // Folder/Label operations
  listFolders(): Promise<EmailFolder[]>;
  createFolder(name: string, parentPath?: string): Promise<EmailFolder>;
  deleteFolder(path: string): Promise<void>;
  renameFolder(path: string, newName: string): Promise<void>;
  setFolderSubscription(path: string, subscribed: boolean): Promise<void>;
  getFolderQuota(path: string): Promise<EmailFolderQuota>;

  // Sync operations
  initialSync(
    daysBack: number,
    onProgress?: (phase: string, current: number, total: number) => void,
  ): Promise<SyncResult>;
  deltaSync(syncToken: string): Promise<SyncResult>;

  // Message operations
  fetchMessage(messageId: string): Promise<ParsedMessage>;
  fetchAttachment(
    messageId: string,
    attachmentId: string,
  ): Promise<{ data: string; size: number }>;
  fetchRawMessage(messageId: string): Promise<string>;

  // Actions (operate on thread/message level)
  archive(threadId: string, messageIds: string[]): Promise<void>;
  trash(threadId: string, messageIds: string[]): Promise<void>;
  permanentDelete(threadId: string, messageIds: string[]): Promise<void>;
  markRead(
    threadId: string,
    messageIds: string[],
    read: boolean,
  ): Promise<void>;
  star(
    threadId: string,
    messageIds: string[],
    starred: boolean,
  ): Promise<void>;
  spam(
    threadId: string,
    messageIds: string[],
    isSpam: boolean,
  ): Promise<void>;
  moveToFolder(
    threadId: string,
    messageIds: string[],
    folderPath: string,
  ): Promise<void>;
  addLabel(threadId: string, labelId: string): Promise<void>;
  removeLabel(threadId: string, labelId: string): Promise<void>;

  // Send/Draft operations
  sendMessage(
    rawBase64Url: string,
    threadId?: string,
  ): Promise<{
    id: string;
    smtpAccepted?: boolean;
    appendedToSent?: boolean;
    localPersisted?: boolean;
  }>;
  createDraft(
    rawBase64Url: string,
    threadId?: string,
  ): Promise<{ draftId: string }>;
  updateDraft(
    draftId: string,
    rawBase64Url: string,
    threadId?: string,
  ): Promise<{ draftId: string }>;
  deleteDraft(draftId: string): Promise<void>;

  // Connection
  testConnection(): Promise<{ success: boolean; message: string }>;
  getProfile(): Promise<{ email: string; name?: string }>;
}
