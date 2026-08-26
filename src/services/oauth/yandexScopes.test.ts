import { describe, expect, it } from "vitest";
import { parseOAuthScopes, resolveYandexGrantedScopeValue } from "./yandexScopes";

describe("Yandex OAuth scopes", () => {
  it("uses configured scopes when Yandex omits scope from the token response", () => {
    expect(resolveYandexGrantedScopeValue(undefined, ["mail:imap_full", "mail:smtp"]))
      .toBe("mail:imap_full mail:smtp");
  });

  it("preserves explicitly reported scopes", () => {
    expect(resolveYandexGrantedScopeValue("mail:imap_full", ["mail:smtp"]))
      .toBe("mail:imap_full");
  });

  it("parses comma and whitespace separated values", () => {
    expect([...parseOAuthScopes("mail:imap_full, mail:smtp calendar:all")])
      .toEqual(["mail:imap_full", "mail:smtp", "calendar:all"]);
  });
});
