import { describe, expect, it } from "vitest";
import {
  classifyMailProtocolError,
  isYandexMailHost,
  resolveMailboxUsername,
  resolveMailboxEmail,
} from "./mailErrorClassification";

describe("isYandexMailHost", () => {
  it("accepts official IMAP/SMTP aliases", () => {
    expect(isYandexMailHost("imap.yandex.com")).toBe(true);
    expect(isYandexMailHost("imap.yandex.ru")).toBe(true);
    expect(isYandexMailHost("smtp.yandex.com")).toBe(true);
    expect(isYandexMailHost("SMTP.YANDEX.RU")).toBe(true);
  });

  it("rejects unrelated hosts", () => {
    expect(isYandexMailHost("imap.office-360.ru")).toBe(false);
    expect(isYandexMailHost("imap.gmail.com")).toBe(false);
  });
});

describe("resolveMailboxEmail", () => {
  it("prefers the OAuth mailbox when it is a full email", () => {
    expect(
      resolveMailboxEmail("korotkov.g@office-360.ru", "korotkov.g@office-360.ru"),
    ).toBe("korotkov.g@office-360.ru");
  });

  it("keeps the typed corporate mailbox if OAuth subject has no @", () => {
    expect(resolveMailboxEmail("korotkov.g@office-360.ru", "uid-login")).toBe(
      "korotkov.g@office-360.ru",
    );
  });
});

describe("resolveMailboxUsername", () => {
  it("uses the full corporate mailbox, not the local-part", () => {
    expect(
      resolveMailboxUsername("korotkov.g@office-360.ru", "korotkov.g", {
        preferFullEmail: true,
      }),
    ).toBe("korotkov.g@office-360.ru");
  });

  it("keeps an explicit full-email IMAP username", () => {
    expect(
      resolveMailboxUsername("user@yandex.ru", "korotkov.g@office-360.ru", {
        preferFullEmail: true,
      }),
    ).toBe("korotkov.g@office-360.ru");
  });

  it("does not override a custom non-Yandex username", () => {
    expect(resolveMailboxUsername("user@example.com", "custom-user")).toBe("custom-user");
  });
});

describe("classifyMailProtocolError", () => {
  it("classifies IMAP TCP timeout as network, not missing mail scopes", () => {
    const result = classifyMailProtocolError(
      "TCP connect to imap.yandex.ru:993 timed out after 30s — check your server settings or network connection",
      "imap",
      "imap.yandex.ru",
    );
    expect(result.class).toBe("IMAP_NETWORK_TIMEOUT");
    expect(result.message).toBe("Could not connect to Yandex Mail server");
    expect(result.authReached).toBe(false);
  });

  it("classifies SMTP verification timeout as network", () => {
    const result = classifyMailProtocolError(
      "SMTP test timed out after 35 seconds. Check server, port, SSL/TLS, and sign-in method.",
      "smtp",
      "smtp.yandex.ru",
    );
    expect(result.class).toBe("SMTP_NETWORK_TIMEOUT");
    expect(result.authReached).toBe(false);
    expect(result.message).not.toMatch(/mail permissions are missing/i);
  });

  it("classifies auth rejection separately from scope missing", () => {
    const result = classifyMailProtocolError(
      "XOAUTH2 authentication failed: AUTHENTICATIONFAILED",
      "imap",
      "imap.yandex.com",
    );
    expect(result.class).toBe("AUTH_REJECTED");
    expect(result.message).toBe("Yandex rejected the mail client sign-in");
    expect(result.authReached).toBe(true);
  });

  it("classifies IMAP-disabled server errors", () => {
    const result = classifyMailProtocolError(
      "MAIL_PROTOCOL_DISABLED: IMAP is disabled for this mailbox",
      "imap",
      "imap.yandex.com",
    );
    expect(result.class).toBe("MAIL_PROTOCOL_DISABLED");
    expect(result.message).toBe("Enable IMAP and OAuth tokens in Yandex Mail settings");
  });

  it("classifies explicit missing OAuth scopes", () => {
    const result = classifyMailProtocolError(
      "Yandex ID connected, but mail permissions are missing.",
      "imap",
    );
    expect(result.class).toBe("OAUTH_SCOPE_MISSING");
    expect(result.message).toBe("OAuth token is missing the required mail permissions");
  });

  it("classifies expired tokens", () => {
    const result = classifyMailProtocolError("invalid_token: token expired", "imap");
    expect(result.class).toBe("TOKEN_EXPIRED");
  });
});
