import { describe, it, expect, vi, beforeEach } from "vitest";
import { ImapSmtpProvider } from "./imapSmtpProvider";

// Mock all external dependencies
vi.mock("../db/accounts", () => ({
  getAccount: vi.fn(),
}));

vi.mock("../imap/imapConfigBuilder", () => ({
  buildImapConfig: vi.fn(),
  buildSmtpConfig: vi.fn(),
}));

vi.mock("../imap/imapSync", () => ({
  imapInitialSync: vi.fn(),
  imapDeltaSync: vi.fn(),
  imapMessageToParsedMessage: vi.fn(),
}));

vi.mock("../imap/folderMapper", () => ({
  mapFolderToLabel: vi.fn(),
  getSyncableFolders: vi.fn(),
}));

vi.mock("../imap/tauriCommands", () => ({
  imapListFolders: vi.fn(),
  imapCreateFolder: vi.fn(),
  imapDeleteFolder: vi.fn(),
  imapRenameFolder: vi.fn(),
  imapSetFolderSubscription: vi.fn(),
  imapGetFolderQuota: vi.fn(),
  imapSetFlags: vi.fn(),
  imapMoveMessages: vi.fn(),
  imapDeleteMessages: vi.fn(),
  imapFetchMessageBody: vi.fn(),
  imapFetchAttachment: vi.fn(),
  imapFetchRawMessage: vi.fn(),
  imapTestConnection: vi.fn(),
  imapAppendMessage: vi.fn(),
  smtpSendEmail: vi.fn(),
  smtpTestConnection: vi.fn(),
}));

vi.mock("../imap/messageHelper", () => ({
  findSpecialFolder: vi.fn(),
}));

vi.mock("../db/smartFolders", () => ({
  markSmartFoldersMissingReference: vi.fn(),
  rewriteSmartFolderReference: vi.fn(),
}));

vi.mock("../db/messages", () => ({
  upsertMessage: vi.fn(),
  getMessagesForThread: vi.fn().mockResolvedValue([]),
}));

vi.mock("../db/connection", () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn().mockResolvedValue([{ c: 2 }]),
  }),
}));

vi.mock("../db/threads", () => ({
  upsertThread: vi.fn(),
  setThreadLabels: vi.fn(),
  getThreadLabelIds: vi.fn().mockResolvedValue([]),
  getThreadById: vi.fn().mockResolvedValue({
    subject: "Re: Hello",
    is_starred: 0,
    is_important: 0,
    has_attachments: 0,
    is_read: 1,
  }),
}));

import { getAccount } from "../db/accounts";
import { buildImapConfig, buildSmtpConfig } from "../imap/imapConfigBuilder";
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
  imapTestConnection,
  imapAppendMessage,
  smtpSendEmail,
  smtpTestConnection,
} from "../imap/tauriCommands";
import { findSpecialFolder } from "../imap/messageHelper";
import { getMessagesForThread, upsertMessage } from "../db/messages";
import { upsertThread, setThreadLabels, getThreadLabelIds } from "../db/threads";

const mockImapConfig = {
  host: "imap.example.com",
  port: 993,
  security: "tls" as const,
  username: "user@example.com",
  password: "secret",
  auth_method: "password" as const,
};

const mockSmtpConfig = {
  host: "smtp.example.com",
  port: 587,
  security: "starttls" as const,
  username: "user@example.com",
  password: "secret",
  auth_method: "password" as const,
};

const mockAccount = {
  id: "acc-1",
  email: "user@example.com",
  display_name: "Test User",
  imap_host: "imap.example.com",
  imap_port: 993,
  imap_security: "ssl",
  smtp_host: "smtp.example.com",
  smtp_port: 587,
  smtp_security: "starttls",
  auth_method: "password",
  imap_password: "secret",
  oauth_provider: null,
  oauth_client_id: null,
  oauth_client_secret: null,
};

describe("ImapSmtpProvider", () => {
  let provider: ImapSmtpProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new ImapSmtpProvider("acc-1");

    vi.mocked(getAccount).mockResolvedValue(mockAccount as never);
    vi.mocked(buildImapConfig).mockReturnValue(mockImapConfig);
    vi.mocked(buildSmtpConfig).mockReturnValue(mockSmtpConfig);
  });

  it("has correct accountId and type", () => {
    expect(provider.accountId).toBe("acc-1");
    expect(provider.type).toBe("imap");
    expect(provider.capabilities.folders.create.supported).toBe(true);
    expect(provider.capabilities.folders.rename.supported).toBe(true);
    expect(provider.capabilities.folders.delete.supported).toBe(true);
  });

  // ---------- Folder operations ----------

  describe("listFolders", () => {
    it("calls imapListFolders and maps results", async () => {
      const rawFolders = [
        {
          path: "INBOX",
          raw_path: "INBOX",
          name: "INBOX",
          delimiter: "/",
          special_use: "\\Inbox",
          subscribed: true,
          selectable: true,
          has_children: false,
          exists: 42,
          unseen: 5,
        },
        {
          path: "Sent",
          raw_path: "Sent",
          name: "Sent",
          delimiter: "/",
          special_use: "\\Sent",
          subscribed: true,
          selectable: true,
          has_children: false,
          exists: 100,
          unseen: 0,
        },
      ];

      vi.mocked(imapListFolders).mockResolvedValue(rawFolders);
      vi.mocked(getSyncableFolders).mockReturnValue(rawFolders);
      vi.mocked(mapFolderToLabel).mockImplementation((f) => ({
        labelId: f.path,
        labelName: f.name,
        type: f.special_use ? "system" : "user",
      }));

      const folders = await provider.listFolders();

      expect(imapListFolders).toHaveBeenCalledWith(mockImapConfig);
      expect(folders).toHaveLength(2);
      expect(folders[0]).toEqual({
        id: "INBOX",
        name: "INBOX",
        path: "INBOX",
        rawPath: "INBOX",
        type: "system",
        specialUse: "\\Inbox",
        delimiter: "/",
        subscribed: true,
        selectable: true,
        hasChildren: false,
        quota: null,
        retention: provider.capabilities.folders.retention,
        messageCount: 42,
        unreadCount: 5,
      });
    });
  });

  describe("createFolder", () => {
    it("creates an IMAP folder and returns the listed folder", async () => {
      vi.mocked(imapCreateFolder).mockResolvedValue(undefined);
      vi.mocked(imapListFolders).mockResolvedValue([
        {
          path: "Projects",
          raw_path: "Projects",
          name: "Projects",
          delimiter: "/",
          special_use: null,
          subscribed: true,
          selectable: true,
          has_children: false,
          exists: 0,
          unseen: 0,
        },
      ]);
      vi.mocked(getSyncableFolders).mockImplementation((folders) => folders);
      vi.mocked(mapFolderToLabel).mockImplementation((f) => ({
        labelId: `folder-${f.path}`,
        labelName: f.name,
        type: "user",
      }));

      const result = await provider.createFolder("Projects");

      expect(imapCreateFolder).toHaveBeenCalledWith(mockImapConfig, "Projects", undefined);
      expect(result.rawPath).toBe("Projects");
    });
  });

  describe("deleteFolder", () => {
    it("deletes a mutable IMAP folder", async () => {
      vi.mocked(imapListFolders).mockResolvedValue([
        {
          path: "Projects",
          raw_path: "Projects",
          name: "Projects",
          delimiter: "/",
          special_use: null,
          subscribed: true,
          selectable: true,
          has_children: false,
          exists: 0,
          unseen: 0,
        },
      ]);
      vi.mocked(getSyncableFolders).mockImplementation((folders) => folders);
      vi.mocked(mapFolderToLabel).mockImplementation((f) => ({
        labelId: `folder-${f.path}`,
        labelName: f.name,
        type: "user",
      }));
      vi.mocked(imapDeleteFolder).mockResolvedValue(undefined);

      await provider.deleteFolder("Projects");

      expect(imapDeleteFolder).toHaveBeenCalledWith(mockImapConfig, "Projects");
    });
  });

  describe("renameFolder", () => {
    it("renames a mutable IMAP folder", async () => {
      vi.mocked(imapListFolders).mockResolvedValue([
        {
          path: "Projects",
          raw_path: "Projects",
          name: "Projects",
          delimiter: "/",
          special_use: null,
          subscribed: true,
          selectable: true,
          has_children: false,
          exists: 0,
          unseen: 0,
        },
      ]);
      vi.mocked(getSyncableFolders).mockImplementation((folders) => folders);
      vi.mocked(mapFolderToLabel).mockImplementation((f) => ({
        labelId: `folder-${f.path}`,
        labelName: f.name,
        type: "user",
      }));
      vi.mocked(imapRenameFolder).mockResolvedValue("Renamed");

      await provider.renameFolder("Projects", "Renamed");

      expect(imapRenameFolder).toHaveBeenCalledWith(mockImapConfig, "Projects", "Renamed");
    });
  });

  describe("setFolderSubscription", () => {
    it("toggles folder subscription", async () => {
      vi.mocked(imapSetFolderSubscription).mockResolvedValue(undefined);

      await provider.setFolderSubscription("Projects", false);

      expect(imapSetFolderSubscription).toHaveBeenCalledWith(mockImapConfig, "Projects", false);
    });
  });

  describe("getFolderQuota", () => {
    it("maps quota response", async () => {
      vi.mocked(imapGetFolderQuota).mockResolvedValue({
        folder: "INBOX",
        quota_roots: ["Userquota"],
        resources: [{ name: "STORAGE", usage: 10, limit: 100, percent_used: 10 }],
        supported: true,
        reason: null,
      });

      const quota = await provider.getFolderQuota("INBOX");

      expect(quota.resources[0]?.percentUsed).toBe(10);
      expect(quota.quotaRoots).toEqual(["Userquota"]);
    });
  });

  // ---------- Raw message ----------

  describe("fetchRawMessage", () => {
    it("parses IMAP message ID and calls imapFetchRawMessage", async () => {
      const { imapFetchRawMessage } = await import("../imap/tauriCommands");
      vi.mocked(imapFetchRawMessage).mockResolvedValue("From: test@example.com\r\nSubject: Hello\r\n\r\nBody");

      const result = await provider.fetchRawMessage("imap-acc-1-INBOX-42");

      expect(imapFetchRawMessage).toHaveBeenCalledWith(mockImapConfig, "INBOX", 42);
      expect(result).toBe("From: test@example.com\r\nSubject: Hello\r\n\r\nBody");
    });

    it("throws for invalid message ID format", async () => {
      await expect(provider.fetchRawMessage("invalid-id")).rejects.toThrow(
        "Invalid IMAP message ID format",
      );
    });
  });

  // ---------- Actions ----------

  describe("archive", () => {
    it("moves messages to Archive folder", async () => {
      vi.mocked(findSpecialFolder).mockResolvedValue("Archive");
      vi.mocked(imapMoveMessages).mockResolvedValue(undefined);

      await provider.archive("thread-1", [
        "imap-acc-1-INBOX-100",
        "imap-acc-1-INBOX-200",
      ]);

      expect(findSpecialFolder).toHaveBeenCalledWith("acc-1", "\\Archive");
      expect(imapMoveMessages).toHaveBeenCalledWith(
        mockImapConfig,
        "INBOX",
        [100, 200],
        "Archive",
      );
    });

    it("skips messages already in Archive", async () => {
      vi.mocked(findSpecialFolder).mockResolvedValue("Archive");
      vi.mocked(imapMoveMessages).mockResolvedValue(undefined);

      await provider.archive("thread-1", ["imap-acc-1-Archive-100"]);

      expect(imapMoveMessages).not.toHaveBeenCalled();
    });

    it("falls back to 'Archive' when special folder not found", async () => {
      vi.mocked(findSpecialFolder).mockResolvedValue(null);
      vi.mocked(imapMoveMessages).mockResolvedValue(undefined);

      await provider.archive("thread-1", ["imap-acc-1-INBOX-100"]);

      expect(imapMoveMessages).toHaveBeenCalledWith(
        mockImapConfig,
        "INBOX",
        [100],
        "Archive",
      );
    });
  });

  describe("trash", () => {
    it("moves messages to Trash folder", async () => {
      vi.mocked(findSpecialFolder).mockResolvedValue("Deleted Items");
      vi.mocked(imapMoveMessages).mockResolvedValue(undefined);

      await provider.trash("thread-1", ["imap-acc-1-INBOX-100"]);

      expect(findSpecialFolder).toHaveBeenCalledWith("acc-1", "\\Trash");
      expect(imapMoveMessages).toHaveBeenCalledWith(
        mockImapConfig,
        "INBOX",
        [100],
        "Deleted Items",
      );
    });
  });

  describe("permanentDelete", () => {
    it("calls imapDeleteMessages for each folder group", async () => {
      vi.mocked(imapDeleteMessages).mockResolvedValue(undefined);

      await provider.permanentDelete("thread-1", [
        "imap-acc-1-INBOX-100",
        "imap-acc-1-Sent-200",
      ]);

      expect(imapDeleteMessages).toHaveBeenCalledTimes(2);
      expect(imapDeleteMessages).toHaveBeenCalledWith(
        mockImapConfig,
        "INBOX",
        [100],
      );
      expect(imapDeleteMessages).toHaveBeenCalledWith(
        mockImapConfig,
        "Sent",
        [200],
      );
    });
  });

  describe("markRead", () => {
    it("sets Seen flag when read=true", async () => {
      vi.mocked(imapSetFlags).mockResolvedValue(undefined);

      await provider.markRead("thread-1", ["imap-acc-1-INBOX-100"], true);

      expect(imapSetFlags).toHaveBeenCalledWith(
        mockImapConfig,
        "INBOX",
        [100],
        ["Seen"],
        true,
      );
    });

    it("removes Seen flag when read=false", async () => {
      vi.mocked(imapSetFlags).mockResolvedValue(undefined);

      await provider.markRead("thread-1", ["imap-acc-1-INBOX-100"], false);

      expect(imapSetFlags).toHaveBeenCalledWith(
        mockImapConfig,
        "INBOX",
        [100],
        ["Seen"],
        false,
      );
    });

    it("loads message IDs from DB when messageIds is empty (thread-level mark read)", async () => {
      vi.mocked(imapSetFlags).mockResolvedValue(undefined);
      vi.mocked(getMessagesForThread).mockResolvedValueOnce([
        { id: "imap-acc-1-INBOX-50" } as never,
        { id: "imap-acc-1-INBOX-51" } as never,
      ]);

      await provider.markRead("thread-xyz", [], true);

      expect(getMessagesForThread).toHaveBeenCalledWith("acc-1", "thread-xyz");
      expect(imapSetFlags).toHaveBeenCalledWith(
        mockImapConfig,
        "INBOX",
        [50, 51],
        ["Seen"],
        true,
      );
    });
  });

  describe("star", () => {
    it("sets Flagged flag when starred=true", async () => {
      vi.mocked(imapSetFlags).mockResolvedValue(undefined);

      await provider.star("thread-1", ["imap-acc-1-INBOX-100"], true);

      expect(imapSetFlags).toHaveBeenCalledWith(
        mockImapConfig,
        "INBOX",
        [100],
        ["Flagged"],
        true,
      );
    });
  });

  describe("spam", () => {
    it("moves to Junk when isSpam=true", async () => {
      vi.mocked(findSpecialFolder).mockResolvedValue("Junk E-Mail");
      vi.mocked(imapMoveMessages).mockResolvedValue(undefined);

      await provider.spam("thread-1", ["imap-acc-1-INBOX-100"], true);

      expect(imapMoveMessages).toHaveBeenCalledWith(
        mockImapConfig,
        "INBOX",
        [100],
        "Junk E-Mail",
      );
    });

    it("moves to INBOX when isSpam=false", async () => {
      vi.mocked(findSpecialFolder).mockResolvedValue("Junk");
      vi.mocked(imapMoveMessages).mockResolvedValue(undefined);

      await provider.spam("thread-1", ["imap-acc-1-Junk-100"], false);

      expect(imapMoveMessages).toHaveBeenCalledWith(
        mockImapConfig,
        "Junk",
        [100],
        "INBOX",
      );
    });
  });

  describe("moveToFolder", () => {
    it("moves messages to specified folder", async () => {
      vi.mocked(imapMoveMessages).mockResolvedValue(undefined);

      await provider.moveToFolder("thread-1", ["imap-acc-1-INBOX-100"], "Work");

      expect(imapMoveMessages).toHaveBeenCalledWith(
        mockImapConfig,
        "INBOX",
        [100],
        "Work",
      );
    });

    it("skips messages already in target folder", async () => {
      vi.mocked(imapMoveMessages).mockResolvedValue(undefined);

      await provider.moveToFolder(
        "thread-1",
        ["imap-acc-1-Work-100"],
        "Work",
      );

      expect(imapMoveMessages).not.toHaveBeenCalled();
    });
  });

  describe("addLabel / removeLabel", () => {
    it("addLabel does not throw (warns instead)", async () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await provider.addLabel("thread-1", "Label_1");
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("removeLabel does not throw (warns instead)", async () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await provider.removeLabel("thread-1", "Label_1");
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  // ---------- Send / Draft operations ----------

  describe("sendMessage", () => {
    // A valid base64url-encoded RFC 2822 email for testing
    const rawEmail = "From: user@example.com\r\nTo: bob@example.com\r\nSubject: Test\r\nDate: Thu, 20 Feb 2025 12:00:00 GMT\r\nMessage-ID: <test123@example.com>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nHello World";
    const rawBase64Url = btoa(rawEmail).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    it("sends via SMTP, copies to Sent on server, skips local row (sync adds server UID)", async () => {
      vi.mocked(smtpSendEmail).mockResolvedValue({
        success: true,
        message: "OK",
      });
      vi.mocked(findSpecialFolder).mockResolvedValue("Sent Items");
      vi.mocked(imapAppendMessage).mockResolvedValue(undefined);

      const result = await provider.sendMessage(rawBase64Url);

      expect(smtpSendEmail).toHaveBeenCalledWith(mockSmtpConfig, rawBase64Url);
      expect(imapAppendMessage).toHaveBeenCalledWith(
        mockImapConfig,
        "Sent Items",
        rawBase64Url,
        "(\\Seen)",
      );
      expect(upsertThread).not.toHaveBeenCalled();
      expect(setThreadLabels).not.toHaveBeenCalled();
      expect(upsertMessage).not.toHaveBeenCalled();
      expect(result.id).toMatch(/^imap-sent-/);
    });

    it("reply: APPEND succeeds — no local duplicate; sync will merge by headers", async () => {
      vi.mocked(smtpSendEmail).mockResolvedValue({
        success: true,
        message: "OK",
      });
      vi.mocked(findSpecialFolder).mockResolvedValue("Sent");
      vi.mocked(imapAppendMessage).mockResolvedValue(undefined);
      vi.mocked(getThreadLabelIds).mockResolvedValue(["INBOX"]);

      const result = await provider.sendMessage(rawBase64Url, "existing-thread-1");

      expect(imapAppendMessage).toHaveBeenCalled();
      expect(setThreadLabels).not.toHaveBeenCalled();
      expect(upsertThread).not.toHaveBeenCalled();
      expect(upsertMessage).not.toHaveBeenCalled();
      expect(result.id).toMatch(/^imap-sent-/);
    });

    it("throws if SMTP send fails", async () => {
      vi.mocked(smtpSendEmail).mockResolvedValue({
        success: false,
        message: "Authentication failed",
      });

      await expect(provider.sendMessage(rawBase64Url)).rejects.toThrow(
        "SMTP send failed: Authentication failed",
      );
    });

    it("succeeds even if Sent folder copy fails", async () => {
      vi.mocked(smtpSendEmail).mockResolvedValue({
        success: true,
        message: "OK",
      });
      vi.mocked(findSpecialFolder).mockResolvedValue("Sent");
      vi.mocked(imapAppendMessage).mockRejectedValue(
        new Error("APPEND failed"),
      );

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await provider.sendMessage(rawBase64Url);
      expect(result.id).toMatch(/^imap-sent-/);
      // Should still have saved locally
      expect(upsertMessage).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("createDraft", () => {
    it("appends to Drafts folder with Draft flag", async () => {
      vi.mocked(findSpecialFolder).mockResolvedValue("INBOX.Drafts");
      vi.mocked(imapAppendMessage).mockResolvedValue(undefined);

      const result = await provider.createDraft("base64data");

      expect(imapAppendMessage).toHaveBeenCalledWith(
        mockImapConfig,
        "INBOX.Drafts",
        "base64data",
        "(\\Draft)",
      );
      expect(result.draftId).toMatch(/^imap-draft-/);
    });

    it("falls back to 'Drafts' when special folder not found", async () => {
      vi.mocked(findSpecialFolder).mockResolvedValue(null);
      vi.mocked(imapAppendMessage).mockResolvedValue(undefined);

      await provider.createDraft("base64data");

      expect(imapAppendMessage).toHaveBeenCalledWith(
        mockImapConfig,
        "Drafts",
        "base64data",
        "(\\Draft)",
      );
    });
  });

  describe("updateDraft", () => {
    it("deletes old draft and creates new one", async () => {
      vi.mocked(findSpecialFolder).mockResolvedValue("Drafts");
      vi.mocked(imapDeleteMessages).mockResolvedValue(undefined);
      vi.mocked(imapAppendMessage).mockResolvedValue(undefined);

      const result = await provider.updateDraft(
        "imap-acc-1-Drafts-500",
        "newBase64data",
      );

      // Should delete old draft
      expect(imapDeleteMessages).toHaveBeenCalledWith(
        mockImapConfig,
        "Drafts",
        [500],
      );
      // Should create new draft
      expect(imapAppendMessage).toHaveBeenCalledWith(
        mockImapConfig,
        "Drafts",
        "newBase64data",
        "(\\Draft)",
      );
      expect(result.draftId).toMatch(/^imap-draft-/);
    });
  });

  describe("deleteDraft", () => {
    it("deletes draft by parsed message ID", async () => {
      vi.mocked(imapDeleteMessages).mockResolvedValue(undefined);

      await provider.deleteDraft("imap-acc-1-Drafts-500");

      expect(imapDeleteMessages).toHaveBeenCalledWith(
        mockImapConfig,
        "Drafts",
        [500],
      );
    });

    it("warns for generated draft IDs that cannot be deleted", async () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await provider.deleteDraft("imap-draft-1234567890-abc");

      expect(imapDeleteMessages).not.toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  // ---------- Connection / Profile ----------

  describe("testConnection", () => {
    it("tests both IMAP and SMTP", async () => {
      vi.mocked(imapTestConnection).mockResolvedValue("OK");
      vi.mocked(smtpTestConnection).mockResolvedValue({
        success: true,
        message: "OK",
      });

      const result = await provider.testConnection();

      expect(result.success).toBe(true);
      expect(result.message).toContain("Connected");
      expect(imapTestConnection).toHaveBeenCalledWith(mockImapConfig);
      expect(smtpTestConnection).toHaveBeenCalledWith(mockSmtpConfig);
    });

    it("reports SMTP failure even if IMAP succeeds", async () => {
      vi.mocked(imapTestConnection).mockResolvedValue("OK");
      vi.mocked(smtpTestConnection).mockResolvedValue({
        success: false,
        message: "Auth failed",
      });

      const result = await provider.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain("SMTP failed");
    });

    it("reports IMAP failure", async () => {
      vi.mocked(imapTestConnection).mockRejectedValue(
        new Error("Connection refused"),
      );

      const result = await provider.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain("IMAP connection failed");
    });
  });

  describe("getProfile", () => {
    it("returns email and name from DB account", async () => {
      const profile = await provider.getProfile();

      expect(profile.email).toBe("user@example.com");
      expect(profile.name).toBe("Test User");
    });

    it("throws if account not found", async () => {
      vi.mocked(getAccount).mockResolvedValue(null);

      await expect(provider.getProfile()).rejects.toThrow("not found");
    });
  });

  // ---------- Config caching ----------

  describe("config caching", () => {
    it("caches IMAP config after first call", async () => {
      vi.mocked(imapSetFlags).mockResolvedValue(undefined);

      await provider.markRead("t1", ["imap-acc-1-INBOX-100"], true);
      await provider.markRead("t1", ["imap-acc-1-INBOX-200"], true);

      // buildImapConfig should be called once (cached after first call)
      expect(buildImapConfig).toHaveBeenCalledTimes(1);
    });

    it("clearConfigCache forces re-fetch", async () => {
      vi.mocked(imapSetFlags).mockResolvedValue(undefined);

      await provider.markRead("t1", ["imap-acc-1-INBOX-100"], true);
      provider.clearConfigCache();
      await provider.markRead("t1", ["imap-acc-1-INBOX-200"], true);

      expect(buildImapConfig).toHaveBeenCalledTimes(2);
    });
  });

  // ---------- Message ID parsing ----------

  describe("groupByFolder (via actions)", () => {
    it("groups messages from different folders", async () => {
      vi.mocked(imapDeleteMessages).mockResolvedValue(undefined);

      await provider.permanentDelete("thread-1", [
        "imap-acc-1-INBOX-100",
        "imap-acc-1-INBOX-200",
        "imap-acc-1-Sent-300",
      ]);

      expect(imapDeleteMessages).toHaveBeenCalledTimes(2);
      expect(imapDeleteMessages).toHaveBeenCalledWith(
        mockImapConfig,
        "INBOX",
        [100, 200],
      );
      expect(imapDeleteMessages).toHaveBeenCalledWith(
        mockImapConfig,
        "Sent",
        [300],
      );
    });

    it("handles folder names with hyphens", async () => {
      vi.mocked(imapDeleteMessages).mockResolvedValue(undefined);

      await provider.permanentDelete("thread-1", [
        "imap-acc-1-INBOX.Sub-Folder-100",
      ]);

      expect(imapDeleteMessages).toHaveBeenCalledWith(
        mockImapConfig,
        "INBOX.Sub-Folder",
        [100],
      );
    });

    it("skips invalid message IDs", async () => {
      vi.mocked(imapDeleteMessages).mockResolvedValue(undefined);
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await provider.permanentDelete("thread-1", ["invalid-id"]);

      expect(imapDeleteMessages).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
