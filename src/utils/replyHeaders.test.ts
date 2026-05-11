import { buildReplyHeadersForMessage } from "./replyHeaders";
import type { DbMessage } from "@/services/db/messages";

function createMessage(overrides: Partial<DbMessage> = {}): DbMessage {
  return {
    id: "imap-account-INBOX-42",
    account_id: "account-1",
    thread_id: "thread-1",
    from_address: "sender@example.com",
    from_name: null,
    to_addresses: "me@example.com",
    cc_addresses: null,
    bcc_addresses: null,
    reply_to: null,
    subject: "Hello",
    snippet: "Hello",
    date: Date.now(),
    is_read: 1,
    is_starred: 0,
    body_html: null,
    body_text: null,
    body_cached: 1,
    raw_size: null,
    internal_date: null,
    list_unsubscribe: null,
    list_unsubscribe_post: null,
    auth_results: null,
    message_id_header: "<parent@example.com>",
    references_header: "<root@example.com>",
    in_reply_to_header: null,
    imap_uid: 42,
    imap_folder: "INBOX",
    ...overrides,
  };
}

describe("buildReplyHeadersForMessage", () => {
  it("uses the RFC Message-ID instead of the local message id", () => {
    const headers = buildReplyHeadersForMessage(createMessage());

    expect(headers).toEqual({
      inReplyTo: "<parent@example.com>",
      references: "<root@example.com> <parent@example.com>",
    });
  });

  it("omits reply headers when the source message has no RFC Message-ID", () => {
    const headers = buildReplyHeadersForMessage(createMessage({ message_id_header: null }));

    expect(headers).toEqual({});
  });

  it("normalizes bare Message-ID values from IMAP parsers", () => {
    const headers = buildReplyHeadersForMessage(createMessage({
      message_id_header: "parent@example.com",
      references_header: "root@example.com",
    }));

    expect(headers).toEqual({
      inReplyTo: "<parent@example.com>",
      references: "<root@example.com> <parent@example.com>",
    });
  });
});
