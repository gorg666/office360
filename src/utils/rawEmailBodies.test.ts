import { describe, expect, it } from "vitest";
import { extractTextAndHtmlFromRawEmail } from "./rawEmailBodies";

describe("extractTextAndHtmlFromRawEmail", () => {
  it("extracts plain and html from multipart/alternative", () => {
    const raw = [
      "From: me@test.com",
      "To: you@test.com",
      "Subject: Hi",
      "MIME-Version: 1.0",
      'Content-Type: multipart/alternative; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "Hello plain",
      "--b1",
      "Content-Type: text/html; charset=UTF-8",
      "",
      "<p>Hello html</p>",
      "--b1--",
    ].join("\r\n");

    const { text, html } = extractTextAndHtmlFromRawEmail(raw);
    expect(text?.trim()).toBe("Hello plain");
    expect(html?.trim()).toBe("<p>Hello html</p>");
  });

  it("does not return raw MIME boundaries as html", () => {
    const boundary = "----=_Part_123_abc";
    const raw = [
      "From: a@b.c",
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "Текст",
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "",
      "<div>X</div>",
      `--${boundary}--`,
    ].join("\r\n");

    const { html } = extractTextAndHtmlFromRawEmail(raw);
    expect(html).toBeTruthy();
    expect(html).not.toContain("Content-Type:");
    expect(html).not.toContain(boundary);
  });
});
