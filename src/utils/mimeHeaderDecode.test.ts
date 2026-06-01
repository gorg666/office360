import { describe, it, expect } from "vitest";
import { decodeMimeWords } from "./mimeHeaderDecode";

describe("decodeMimeWords", () => {
  it("returns null for null", () => {
    expect(decodeMimeWords(null)).toBeNull();
  });

  it("leaves plain text unchanged", () => {
    expect(decodeMimeWords("Hello")).toBe("Hello");
  });

  it("decodes UTF-8 B encoding", () => {
    expect(decodeMimeWords("=?UTF-8?B?Sm9obiBEb2U=?=")).toBe("John Doe");
  });

  it("decodes UTF-8 Q encoding (Cyrillic)", () => {
    expect(decodeMimeWords("=?UTF-8?Q?=D0=BA=D0=B5=D0=BA?=")).toBe("кек");
  });

  it("decodes multiple adjacent encoded words (keeps separating space)", () => {
    expect(
      decodeMimeWords("=?UTF-8?B?QQ==?= =?UTF-8?B?Qg==?="),
    ).toBe("A B");
  });

  it("repairs UTF-8 mojibake from previously malformed raw headers", () => {
    const mojibakeOnce = (text: string) => {
      const bytes = new TextEncoder().encode(text);
      return Array.from(bytes, (b) => String.fromCharCode(b)).join("");
    };

    const broken = mojibakeOnce(mojibakeOnce("кек чек чебурек"));

    expect(decodeMimeWords(broken)).toBe("кек чек чебурек");
  });
});
