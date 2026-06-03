import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbScheduledEmail } from "../db/scheduledEmails";

const mocks = vi.hoisted(() => ({
  getPendingScheduledEmails: vi.fn(),
  updateScheduledEmailStatus: vi.fn(),
  getGmailClient: vi.fn(),
  sendMessage: vi.fn(),
  buildRawEmail: vi.fn(),
  buildReplyHeadersForMessageId: vi.fn(),
  getAccount: vi.fn(),
}));

vi.mock("../db/scheduledEmails", () => ({
  getPendingScheduledEmails: mocks.getPendingScheduledEmails,
  updateScheduledEmailStatus: mocks.updateScheduledEmailStatus,
}));

vi.mock("../gmail/tokenManager", () => ({
  getGmailClient: mocks.getGmailClient,
}));

vi.mock("@/utils/emailBuilder", () => ({
  buildRawEmail: mocks.buildRawEmail,
}));

vi.mock("@/utils/replyHeaders", () => ({
  buildReplyHeadersForMessageId: mocks.buildReplyHeadersForMessageId,
}));

vi.mock("../db/accounts", () => ({
  getAccount: mocks.getAccount,
}));

vi.mock("../backgroundCheckers", () => ({
  createBackgroundChecker: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}));

import { checkScheduledEmails } from "./scheduledSendManager";

function makeScheduledEmail(overrides: Partial<DbScheduledEmail> = {}): DbScheduledEmail {
  return {
    id: "scheduled-1",
    account_id: "acct-1",
    to_addresses: "to@example.com",
    cc_addresses: null,
    bcc_addresses: null,
    subject: "Scheduled",
    body_html: "<p>Hello</p>",
    reply_to_message_id: null,
    thread_id: null,
    scheduled_at: 1,
    signature_id: null,
    attachment_paths: null,
    status: "pending",
    created_at: 1,
    ...overrides,
  };
}

describe("scheduledSendManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPendingScheduledEmails.mockResolvedValue([]);
    mocks.updateScheduledEmailStatus.mockResolvedValue(undefined);
    mocks.getAccount.mockResolvedValue({ id: "acct-1", email: "sender@example.com" });
    mocks.getGmailClient.mockResolvedValue({ sendMessage: mocks.sendMessage });
    mocks.sendMessage.mockResolvedValue({ id: "sent-1" });
    mocks.buildRawEmail.mockReturnValue("raw-built");
    mocks.buildReplyHeadersForMessageId.mockResolvedValue({
      inReplyTo: undefined,
      references: undefined,
    });
  });

  it("moves pending scheduled email through sending to sent", async () => {
    const attachment = { filename: "file.txt", mimeType: "text/plain", content: "Zm9v" };
    mocks.getPendingScheduledEmails.mockResolvedValue([
      makeScheduledEmail({
        cc_addresses: "cc@example.com",
        bcc_addresses: "bcc@example.com",
        thread_id: "thread-1",
        attachment_paths: JSON.stringify([attachment]),
      }),
    ]);

    await checkScheduledEmails();

    expect(mocks.updateScheduledEmailStatus).toHaveBeenNthCalledWith(1, "scheduled-1", "sending");
    expect(mocks.updateScheduledEmailStatus).toHaveBeenNthCalledWith(2, "scheduled-1", "sent");
    expect(mocks.buildRawEmail).toHaveBeenCalledWith(expect.objectContaining({
      from: "sender@example.com",
      to: ["to@example.com"],
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
      threadId: "thread-1",
      attachments: [attachment],
    }));
    expect(mocks.sendMessage).toHaveBeenCalledWith("raw-built", "thread-1");
  });

  it("marks scheduled email failed when account is missing", async () => {
    mocks.getPendingScheduledEmails.mockResolvedValue([makeScheduledEmail()]);
    mocks.getAccount.mockResolvedValue(null);

    await checkScheduledEmails();

    expect(mocks.updateScheduledEmailStatus).toHaveBeenCalledWith("scheduled-1", "failed");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("returns transient scheduled send failures to pending", async () => {
    mocks.getPendingScheduledEmails.mockResolvedValue([makeScheduledEmail()]);
    mocks.sendMessage.mockRejectedValue(new Error("network timeout"));

    await checkScheduledEmails();

    expect(mocks.updateScheduledEmailStatus).toHaveBeenNthCalledWith(1, "scheduled-1", "sending");
    expect(mocks.updateScheduledEmailStatus).toHaveBeenNthCalledWith(2, "scheduled-1", "pending");
  });

  it("marks permanent scheduled send failures as failed", async () => {
    mocks.getPendingScheduledEmails.mockResolvedValue([makeScheduledEmail()]);
    mocks.sendMessage.mockRejectedValue(new Error("SMTP 550 rejected"));

    await checkScheduledEmails();

    expect(mocks.updateScheduledEmailStatus).toHaveBeenNthCalledWith(1, "scheduled-1", "sending");
    expect(mocks.updateScheduledEmailStatus).toHaveBeenNthCalledWith(2, "scheduled-1", "failed");
  });
});
