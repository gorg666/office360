import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "./connection";
import { insertScheduledEmail } from "./scheduledEmails";
import { createMockDb } from "@/test/mocks";

const mockDb = createMockDb();

describe("scheduledEmails DB service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue(
      mockDb as unknown as Awaited<ReturnType<typeof getDb>>,
    );
  });

  it("inserts scheduled email attachment payload with the created row", async () => {
    const attachmentPaths = JSON.stringify([
      { filename: "file.txt", mimeType: "text/plain", content: "Zm9v" },
    ]);

    const id = await insertScheduledEmail({
      accountId: "acct-1",
      toAddresses: "to@example.com",
      ccAddresses: null,
      bccAddresses: null,
      subject: "Scheduled",
      bodyHtml: "<p>Hello</p>",
      replyToMessageId: null,
      threadId: null,
      scheduledAt: 1_717_171_717,
      signatureId: null,
      attachmentPaths,
    });

    expect(id).toBeTruthy();
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining("attachment_paths"),
      expect.arrayContaining([id, "acct-1", attachmentPaths]),
    );
  });
});
