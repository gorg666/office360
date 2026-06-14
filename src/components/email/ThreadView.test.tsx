import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ThreadView } from "./ThreadView";
import { useAccountStore } from "@/stores/accountStore";
import { useUIStore } from "@/stores/uiStore";
import type { Thread } from "@/stores/threadStore";
import type { DbMessage } from "@/services/db/messages";

const mocks = vi.hoisted(() => ({
  detectInvitationsInMessage: vi.fn(),
}));

vi.mock("./MessageItem", () => ({
  MessageItem: () => <div data-testid="message-item" />,
}));

vi.mock("./ActionBar", () => ({
  ActionBar: () => <div data-testid="action-bar" />,
}));

vi.mock("./ThreadSummary", () => ({
  ThreadSummary: () => <div data-testid="thread-summary" />,
}));

vi.mock("./SmartReplySuggestions", () => ({
  SmartReplySuggestions: () => <div data-testid="smart-replies" />,
}));

vi.mock("./InlineReply", () => ({
  InlineReply: () => <div data-testid="inline-reply" />,
}));

vi.mock("./ContactSidebar", () => ({
  ContactSidebar: () => <div data-testid="contact-sidebar" />,
}));

vi.mock("@/components/tasks/TaskSidebar", () => ({
  TaskSidebar: () => <div data-testid="task-sidebar" />,
}));

vi.mock("@/components/tasks/AiTaskExtractDialog", () => ({
  AiTaskExtractDialog: () => <div data-testid="task-dialog" />,
}));

vi.mock("./RawMessageModal", () => ({
  RawMessageModal: () => <div data-testid="raw-message-modal" />,
}));

vi.mock("@/services/db/messages", () => ({
  getMessagesForThread: vi.fn(() => Promise.resolve([
    {
      id: "msg-1",
      account_id: "acc-1",
      thread_id: "message-owned-thread",
      from_address: "qa@example.test",
      from_name: "QA",
      to_addresses: "user@example.test",
      cc_addresses: null,
      bcc_addresses: null,
      reply_to: null,
      subject: "Invite",
      snippet: "Invite",
      date: 1781447000000,
      is_read: 1,
      is_starred: 0,
      body_html: null,
      body_text: "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:invite-1\nEND:VEVENT\nEND:VCALENDAR",
      body_cached: 1,
      raw_size: null,
      internal_date: null,
      list_unsubscribe: null,
      list_unsubscribe_post: null,
      auth_results: null,
      message_id_header: null,
      references_header: null,
      in_reply_to_header: null,
      imap_uid: null,
      imap_folder: null,
    } satisfies DbMessage,
  ])),
  upsertMessage: vi.fn(),
}));

vi.mock("@/services/db/attachments", () => ({
  getAttachmentsForMessage: vi.fn(() => Promise.resolve([])),
  upsertAttachment: vi.fn(),
}));

vi.mock("@/services/email/providerFactory", () => ({
  getEmailProvider: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@/services/emailActions", () => ({
  markThreadRead: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/services/db/settings", () => ({
  getSetting: vi.fn(() => Promise.resolve("true")),
  setSetting: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/services/db/imageAllowlist", () => ({
  getAllowlistedSenders: vi.fn(() => Promise.resolve(new Set())),
}));

vi.mock("@/services/db/contacts", () => ({
  getContactDisplayNameMap: vi.fn(() => Promise.resolve(new Map())),
}));

vi.mock("@/services/db/calendarInvitations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/db/calendarInvitations")>();
  return {
    ...actual,
    listInvitationsForThread: vi.fn(() => Promise.resolve([])),
  };
});

vi.mock("@/services/calendar/invitations", () => ({
  detectInvitationsInMessage: mocks.detectInvitationsInMessage,
  detectInvitationsFromAttachments: vi.fn(() => Promise.resolve([])),
  respondToCalendarInvitation: vi.fn(),
}));

const thread: Thread = {
  id: "visible-thread",
  accountId: "acc-1",
  subject: "Invite",
  snippet: "Invite",
  lastMessageAt: 1781447000000,
  messageCount: 1,
  isRead: true,
  isStarred: false,
  isPinned: false,
  isMuted: false,
  hasAttachments: false,
  labelIds: ["INBOX"],
  fromName: "QA",
  fromAddress: "qa@example.test",
};

describe("ThreadView calendar invitations", () => {
  beforeEach(() => {
    mocks.detectInvitationsInMessage.mockResolvedValue([]);
    useAccountStore.setState({
      activeAccountId: "acc-1",
      accounts: [{
        id: "acc-1",
        email: "user@example.test",
        displayName: null,
        avatarUrl: null,
        isActive: true,
      }],
    });
    useUIStore.setState({ markAsReadBehavior: "manual" });
  });

  it("detects invitations using the message thread id", async () => {
    render(<ThreadView thread={thread} renderTaskSidebar={false} />);

    await waitFor(() => {
      expect(mocks.detectInvitationsInMessage).toHaveBeenCalledWith(expect.objectContaining({
        threadId: "message-owned-thread",
        messageId: "msg-1",
      }));
    });
  });
});
