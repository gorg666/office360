import { describe, it, expect } from "vitest";
import { buildRawEmail } from "./emailBuilder";
import { decodeMimeWords } from "./mimeHeaderDecode";

describe("emailBuilder", () => {
  it("builds a basic email", () => {
    const raw = buildRawEmail({
      from: "sender@example.com",
      to: ["recipient@example.com"],
      subject: "Test Subject",
      htmlBody: "<p>Hello World</p>",
    });

    // Should be base64url encoded
    expect(raw).toBeTruthy();
    expect(raw).not.toContain("+");
    expect(raw).not.toContain("/");
    expect(raw).not.toContain("=");

    // Decode to verify structure
    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain("From: sender@example.com");
    expect(decoded).toContain("To: recipient@example.com");
    expect(decoded).toContain("Subject: Test Subject");
    expect(decoded).toContain("MIME-Version: 1.0");
    expect(decoded).toContain("multipart/alternative");
    expect(decoded).toContain("<p>Hello World</p>");
  });

  it("includes Date and Message-ID headers", () => {
    const raw = buildRawEmail({
      from: "sender@example.com",
      to: ["to@example.com"],
      subject: "Test",
      htmlBody: "<p>Hi</p>",
    });

    const decoded = decodeBase64Url(raw);
    expect(decoded).toMatch(/Date: .+/);
    expect(decoded).toMatch(/Message-ID: <.+@example\.com>/);
  });

  it("includes CC and BCC headers", () => {
    const raw = buildRawEmail({
      from: "sender@example.com",
      to: ["to@example.com"],
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
      subject: "Test",
      htmlBody: "<p>Hi</p>",
    });

    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain("Cc: cc@example.com");
    expect(decoded).toContain("Bcc: bcc@example.com");
  });

  it("includes In-Reply-To header", () => {
    const raw = buildRawEmail({
      from: "sender@example.com",
      to: ["to@example.com"],
      subject: "Re: Test",
      htmlBody: "<p>Reply</p>",
      inReplyTo: "<msg-id@gmail.com>",
      references: "<msg-id@gmail.com>",
    });

    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain("In-Reply-To: <msg-id@gmail.com>");
    expect(decoded).toContain("References: <msg-id@gmail.com>");
  });

  it("generates plain text from HTML", () => {
    const raw = buildRawEmail({
      from: "sender@example.com",
      to: ["to@example.com"],
      subject: "Test",
      htmlBody: "<p>Hello</p><br><p>World</p>",
    });

    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain("text/plain");
    expect(decoded).toContain("text/html");
  });

  it("handles multiple recipients", () => {
    const raw = buildRawEmail({
      from: "sender@example.com",
      to: ["a@example.com", "b@example.com"],
      subject: "Test",
      htmlBody: "<p>Hi</p>",
    });

    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain("To: a@example.com, b@example.com");
  });

  it("builds email with attachments using multipart/mixed", () => {
    const raw = buildRawEmail({
      from: "sender@example.com",
      to: ["to@example.com"],
      subject: "With attachment",
      htmlBody: "<p>See attached</p>",
      attachments: [
        {
          filename: "test.txt",
          mimeType: "text/plain",
          content: btoa("Hello file content"),
        },
      ],
    });

    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain("multipart/mixed");
    expect(decoded).toContain("multipart/alternative");
    expect(decoded).toContain('Content-Disposition: attachment; filename="test.txt"');
    expect(decoded).toContain("Content-Transfer-Encoding: base64");
    expect(decoded).toContain("<p>See attached</p>");
    expect(decoded).toContain("text/plain");
    expect(decoded).toContain("text/html");
  });

  it("builds email with multiple attachments", () => {
    const raw = buildRawEmail({
      from: "sender@example.com",
      to: ["to@example.com"],
      subject: "Multi attach",
      htmlBody: "<p>Files</p>",
      attachments: [
        { filename: "a.txt", mimeType: "text/plain", content: btoa("aaa") },
        { filename: "b.pdf", mimeType: "application/pdf", content: btoa("bbb") },
      ],
    });

    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain('filename="a.txt"');
    expect(decoded).toContain('filename="b.pdf"');
    expect(decoded).toContain("application/pdf");
  });

  it("keeps multipart/alternative when no attachments", () => {
    const raw = buildRawEmail({
      from: "sender@example.com",
      to: ["to@example.com"],
      subject: "No attach",
      htmlBody: "<p>Plain</p>",
      attachments: [],
    });

    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain("multipart/alternative");
    expect(decoded).not.toContain("multipart/mixed");
  });

  it("encodes non-ASCII subject as RFC 2047 encoded-word", () => {
    const raw = buildRawEmail({
      from: "sender@example.com",
      to: ["recipient@example.com"],
      subject: "кек чек чебурек",
      htmlBody: "<p>Привет</p>",
    });

    const decoded = decodeBase64Url(raw);
    const subjectHeader = decoded.match(/^Subject: (.+)$/m)?.[1];
    expect(subjectHeader).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    expect(subjectHeader).not.toContain("кек");
    expect(decodeMimeWords(subjectHeader)).toBe("кек чек чебурек");
  });

  it("encodes non-ASCII address display names", () => {
    const raw = buildRawEmail({
      from: "Ефим Подоляк <sender@example.com>",
      to: ["Получатель <recipient@example.com>"],
      subject: "Test",
      htmlBody: "<p>Hello</p>",
    });

    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain("From: =?UTF-8?B?");
    expect(decoded).toContain("<sender@example.com>");
    expect(decoded).toContain("To: =?UTF-8?B?");
    expect(decoded).toContain("<recipient@example.com>");
  });

  it("neutralizes CRLF header injection in headers and MIME filename parameters", () => {
    const raw = buildRawEmail({
      from: 'Alice\r\nX-Injected-From: yes <sender@example.com>',
      to: ["recipient@example.com\r\nX-Injected-To: yes"],
      subject: "Hello\r\nX-Injected-Subject: yes",
      htmlBody: "<p>Hello</p>",
      inReplyTo: "<original@example.com>\r\nX-Injected-Reply: yes",
      references: "<root@example.com>\r\nX-Injected-References: yes",
      attachments: [
        {
          filename: "report.txt\r\nX-Injected-Attachment: yes",
          mimeType: "text/plain",
          content: btoa("report"),
        },
      ],
    });

    const decoded = decodeBase64Url(raw);
    expect(decoded).not.toMatch(/^X-Injected-/m);
    expect(decoded).toContain("Subject: Hello X-Injected-Subject: yes");
    expect(decoded).toContain("In-Reply-To: <original@example.com> X-Injected-Reply: yes");
    expect(decoded).toContain('filename="report.txt X-Injected-Attachment: yes"');
  });

  it("round-trips long Unicode headers and non-ASCII display names", () => {
    const subject = "Очень длинная тема письма с кириллицей и emoji ✅ повторяется несколько раз";
    const raw = buildRawEmail({
      from: "Ефим Подоляк <sender@example.com>",
      to: ["Получатель <recipient@example.com>"],
      cc: ["Копия <copy@example.com>"],
      bcc: ["Скрытый <hidden@example.com>"],
      subject,
      htmlBody: "<p>Hello</p>",
    });

    const decoded = decodeBase64Url(raw);
    const subjectHeader = decoded.match(/^Subject: (.+)$/m)?.[1];
    const fromHeader = decoded.match(/^From: (.+)$/m)?.[1];
    const toHeader = decoded.match(/^To: (.+)$/m)?.[1];
    const ccHeader = decoded.match(/^Cc: (.+)$/m)?.[1];
    const bccHeader = decoded.match(/^Bcc: (.+)$/m)?.[1];

    expect(subjectHeader).not.toContain("Очень");
    expect(decodeMimeWords(subjectHeader)).toBe(subject);
    expect(decodeMimeWords(fromHeader)).toContain("Ефим Подоляк <sender@example.com>");
    expect(decodeMimeWords(toHeader)).toContain("Получатель <recipient@example.com>");
    expect(decodeMimeWords(ccHeader)).toContain("Копия <copy@example.com>");
    expect(decodeMimeWords(bccHeader)).toContain("Скрытый <hidden@example.com>");
  });

  it("keeps IDN domains and plus addressing in address headers", () => {
    const raw = buildRawEmail({
      from: "sender@example.com",
      to: ["User <user+tag@пример.рф>"],
      subject: "IDN",
      htmlBody: "<p>Hello</p>",
    });

    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain("To: User <user+tag@пример.рф>");
  });

  it("encodes non-ASCII attachment filenames without raw header text", () => {
    const raw = buildRawEmail({
      from: "sender@example.com",
      to: ["to@example.com"],
      subject: "Attachment",
      htmlBody: "<p>File</p>",
      attachments: [
        {
          filename: "отчет.txt",
          mimeType: "text/plain",
          content: btoa("report"),
        },
      ],
    });

    const decoded = decodeBase64Url(raw);
    expect(decoded).not.toContain('filename="отчет.txt"');
    expect(decoded).not.toContain('name="отчет.txt"');
    expect(decoded).toContain("filename*=UTF-8''%D0%BE%D1%82%D1%87%D0%B5%D1%82.txt");
    expect(decoded).toContain("name*=UTF-8''%D0%BE%D1%82%D1%87%D0%B5%D1%82.txt");
  });

  it("wraps attachment base64 lines at 76 characters and supports empty attachments", () => {
    const raw = buildRawEmail({
      from: "sender@example.com",
      to: ["to@example.com"],
      subject: "Attachment wrapping",
      htmlBody: "<p>Files</p>",
      attachments: [
        { filename: "large.bin", mimeType: "application/octet-stream", content: "A".repeat(180) },
        { filename: "empty.txt", mimeType: "text/plain", content: "" },
      ],
    });

    const decoded = decodeBase64Url(raw);
    const largePayload = decoded.match(/filename="large\.bin"\r\n\r\n([A\r\n]+)\r\n--/)?.[1];
    expect(largePayload).toBeTruthy();
    for (const line of largePayload!.split("\r\n").filter(Boolean)) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
    expect(decoded).toMatch(/filename="empty\.txt"\r\n(?:\r\n)+--/);
  });

  it("keeps attachments plus inline images nested as mixed related alternative with valid CID references", () => {
    const inlineImage = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    const raw = buildRawEmail({
      from: "sender@example.com",
      to: ["to@example.com"],
      subject: "Inline",
      htmlBody: `<p>Hello</p><img alt="logo" src="data:image/png;base64,${inlineImage}">`,
      attachments: [
        { filename: "file.txt", mimeType: "text/plain", content: btoa("file") },
      ],
    });

    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain("Content-Type: multipart/mixed;");
    expect(decoded).toContain("Content-Type: multipart/related;");
    expect(decoded).toContain("Content-Type: multipart/alternative;");
    expect(decoded.indexOf("multipart/mixed")).toBeLessThan(decoded.indexOf("multipart/related"));
    expect(decoded.indexOf("multipart/related")).toBeLessThan(decoded.indexOf("multipart/alternative"));

    const cid = decoded.match(/src="cid:([^"]+)"/)?.[1];
    expect(cid).toBeTruthy();
    expect(decoded).toContain(`Content-ID: <${cid}>`);
    expect(decoded).toContain("Content-Disposition: inline");

    const boundaryMatches = [...decoded.matchAll(/boundary="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(boundaryMatches).size).toBe(boundaryMatches.length);
  });
});

function decodeBase64Url(encoded: string): string {
  // Add back padding
  let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
