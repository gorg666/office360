import { describe, it, expect } from "vitest";
import { buildRawEmail } from "./emailBuilder";
import { parseOutboxSendPreview } from "./outboxSendPreview";

describe("parseOutboxSendPreview", () => {
  it("extracts recipient and subject from queued sendMessage params", () => {
    const raw = buildRawEmail({
      from: "sender@example.com",
      to: ["user@example.com"],
      subject: "Hello Outbox",
      htmlBody: "<p>Hi</p>",
    });
    const params = JSON.stringify({ rawBase64Url: raw, threadId: "t-1" });
    expect(parseOutboxSendPreview(params)).toEqual({
      recipient: "user@example.com",
      subject: "Hello Outbox",
    });
  });

  it("uses explicit metadata when present", () => {
    const params = JSON.stringify({
      to: "a@b.com",
      subject: "Direct meta",
      rawBase64Url: "ignored",
    });
    expect(parseOutboxSendPreview(params)).toEqual({
      recipient: "a@b.com",
      subject: "Direct meta",
    });
  });
});
