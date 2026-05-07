import { describe, it, expect } from "vitest";
import { isValidGoogleOAuthClientIdFormat } from "./googleCredentials";

describe("isValidGoogleOAuthClientIdFormat", () => {
  it("accepts a typical Desktop client id", () => {
    expect(
      isValidGoogleOAuthClientIdFormat(
        "123456789012-abcdefghijklmnopqrstuvwxyz123456.apps.googleusercontent.com",
      ),
    ).toBe(true);
  });

  it("rejects garbage pasted from URLs or codes", () => {
    expect(
      isValidGoogleOAuthClientIdFormat(
        "4/6E3B70417/-bbv/mpv.Elugbkog3lm.lekj83kjsD3.apps.googleusercontent.com",
      ),
    ).toBe(false);
  });

  it("rejects empty", () => {
    expect(isValidGoogleOAuthClientIdFormat("")).toBe(false);
    expect(isValidGoogleOAuthClientIdFormat("   ")).toBe(false);
  });
});
