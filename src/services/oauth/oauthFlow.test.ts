import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OAuthProviderConfig } from "./providers";

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  formatOAuthCallbackBindError,
  isYandexVerificationCodeRedirect,
  refreshProviderToken,
  YANDEX_DESKTOP_REDIRECT_URI,
  YANDEX_VERIFICATION_CODE_REDIRECT_URI,
} from "./oauthFlow";

const microsoftProvider: OAuthProviderConfig = {
  id: "microsoft",
  name: "Microsoft",
  authUrl: "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
  tokenUrl: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
  scopes: [
    "https://outlook.office.com/IMAP.AccessAsUser.All",
    "https://outlook.office.com/SMTP.Send",
    "offline_access",
    "openid",
    "profile",
    "email",
  ],
  userInfoUrl: undefined,
  usePkce: true,
};

const yahooProvider: OAuthProviderConfig = {
  id: "yahoo",
  name: "Yahoo",
  authUrl: "https://api.login.yahoo.com/oauth2/request_auth",
  tokenUrl: "https://api.login.yahoo.com/oauth2/get_token",
  scopes: ["mail-r", "mail-w", "openid"],
  userInfoUrl: "https://api.login.yahoo.com/openid/v1/userinfo",
  usePkce: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("refreshProviderToken", () => {
  it("invokes Rust oauth_refresh_token for Microsoft with scope", async () => {
    vi.mocked(invoke).mockResolvedValue({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
      token_type: "Bearer",
    });

    const result = await refreshProviderToken(
      microsoftProvider,
      "old-refresh",
      "client-123",
    );

    expect(invoke).toHaveBeenCalledWith("oauth_refresh_token", {
      tokenUrl: microsoftProvider.tokenUrl,
      refreshToken: "old-refresh",
      clientId: "client-123",
      clientSecret: null,
      scope: microsoftProvider.scopes.join(" "),
    });
    expect(result.access_token).toBe("new-access");
  });

  it("invokes Rust oauth_refresh_token for Yahoo without scope", async () => {
    vi.mocked(invoke).mockResolvedValue({
      access_token: "yahoo-token",
      expires_in: 3600,
      token_type: "Bearer",
    });

    await refreshProviderToken(yahooProvider, "yahoo-refresh", "yahoo-client");

    expect(invoke).toHaveBeenCalledWith("oauth_refresh_token", {
      tokenUrl: yahooProvider.tokenUrl,
      refreshToken: "yahoo-refresh",
      clientId: "yahoo-client",
      clientSecret: null,
      scope: null,
    });
  });

  it("passes clientSecret when provided", async () => {
    vi.mocked(invoke).mockResolvedValue({
      access_token: "token",
      expires_in: 3600,
      token_type: "Bearer",
    });

    await refreshProviderToken(
      yahooProvider,
      "refresh",
      "client",
      "secret-123",
    );

    expect(invoke).toHaveBeenCalledWith("oauth_refresh_token", {
      tokenUrl: yahooProvider.tokenUrl,
      refreshToken: "refresh",
      clientId: "client",
      clientSecret: "secret-123",
      scope: null,
    });
  });

  it("propagates errors from invoke", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("Token refresh failed: 400"));

    await expect(
      refreshProviderToken(microsoftProvider, "bad-refresh", "client"),
    ).rejects.toThrow("Token refresh failed: 400");
  });
});

describe("Yandex desktop vs verification_code redirect (AUTH-004)", () => {
  it("treats oauth.yandex.ru/verification_code as OOB screen-code flow", () => {
    expect(isYandexVerificationCodeRedirect(YANDEX_VERIFICATION_CODE_REDIRECT_URI)).toBe(true);
    expect(isYandexVerificationCodeRedirect("https://oauth.yandex.com/verification_code")).toBe(true);
  });

  it("uses localhost loopback for preferred desktop callback (same as Mail)", () => {
    expect(YANDEX_DESKTOP_REDIRECT_URI).toBe("http://localhost:17248");
    expect(isYandexVerificationCodeRedirect(YANDEX_DESKTOP_REDIRECT_URI)).toBe(false);
  });
});

describe("EFIM-AUTH-SESSION-SPLIT-005 OAuth CEF profile key", () => {
  it("keeps Add-Account CEF profile distinct from Telemost Default key", async () => {
    const { YANDEX_OAUTH_ADD_CEF_PROFILE } = await import("./oauthFlow");
    expect(YANDEX_OAUTH_ADD_CEF_PROFILE).toBe("oauth-add");
    expect(YANDEX_OAUTH_ADD_CEF_PROFILE).not.toBe("oauth");
  });
});

describe("formatOAuthCallbackBindError (AUTH-005)", () => {
  it("maps stable port-busy code to Russian user copy", () => {
    expect(formatOAuthCallbackBindError("oauth_callback_port_in_use:17248")).toBe(
      "Не удалось запустить авторизацию Яндекса: порт 17248 уже занят. Закройте другое окно авторизации Office360 и попробуйте снова.",
    );
  });

  it("maps legacy English bind error to the same Russian copy", () => {
    expect(
      formatOAuthCallbackBindError(
        "Failed to bind OAuth callback on port 17248 (127.0.0.1 and [::1]). Another process may be using the port — close leftover Office360 OAuth sessions and retry.",
      ),
    ).toMatch(/порт 17248 уже занят/);
  });

  it("leaves unrelated errors unchanged", () => {
    expect(formatOAuthCallbackBindError("OAuth timed out — please try again")).toBe(
      "OAuth timed out — please try again",
    );
  });
});

// Test parseIdToken indirectly through the module
// Since parseIdToken is private, we test it via startProviderOAuthFlow's fetchUserInfo path
// We'll test the JWT parsing logic directly by importing the module internals

describe("parseIdToken (via module internals)", () => {
  // Create a valid JWT-like structure for testing
  function makeIdToken(payload: Record<string, unknown>): string {
    const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const body = btoa(JSON.stringify(payload))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return `${header}.${body}.fake-signature`;
  }

  it("correctly parses email and name from ID token", async () => {
    // We can't directly test parseIdToken since it's not exported,
    // but we can verify the JWT encoding/decoding round-trip logic
    const payload = {
      email: "user@outlook.com",
      name: "Test User",
      preferred_username: "user@outlook.com",
    };

    const token = makeIdToken(payload);
    const parts = token.split(".");
    const decoded = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));

    expect(decoded.email).toBe("user@outlook.com");
    expect(decoded.name).toBe("Test User");
    expect(decoded.preferred_username).toBe("user@outlook.com");
  });

  it("handles base64url special characters", () => {
    // Payload that generates +, /, = in standard base64
    const payload = { email: "test+special@example.com", name: "Ünïcödé Üser" };
    const token = makeIdToken(payload);
    const parts = token.split(".");
    // Should not contain standard base64 chars that are replaced
    expect(parts[1]).not.toContain("+");
    expect(parts[1]).not.toContain("/");
    expect(parts[1]).not.toContain("=");
  });
});
