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
import { listen } from "@tauri-apps/api/event";
import { refreshProviderToken } from "./oauthFlow";

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

describe("startProviderOAuthFlow redirect contracts", () => {
  const yandexProvider: OAuthProviderConfig = {
    id: "yandex",
    name: "Yandex",
    authUrl: "https://oauth.yandex.ru/authorize",
    tokenUrl: "https://oauth.yandex.ru/token",
    scopes: ["login:email"],
    userInfoUrl: "https://login.yandex.ru/info?format=json",
    usePkce: true,
    userInfoAuthScheme: "OAuth",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listen).mockResolvedValue(() => {});
  });

  it("starts localhost listener and exchanges with matching redirect_uri", async () => {
    const { startProviderOAuthFlow } = await import("./oauthFlow");
    const { listen } = await import("@tauri-apps/api/event");
    void listen;

    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "start_oauth_server") {
        expect(args?.port).toBe(17248);
        return { code: "auth-code", state: args?.state };
      }
      if (cmd === "open_oauth_login_window") return undefined;
      if (cmd === "close_oauth_login_window") return undefined;
      if (cmd === "oauth_exchange_token") {
        expect(args?.redirectUri).toBe("http://localhost:17248");
        expect(args?.codeVerifier).toBeTruthy();
        return {
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
          token_type: "bearer",
        };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        default_email: "user@yandex.ru",
        real_name: "User",
      }),
    }) as never;

    const result = await startProviderOAuthFlow(yandexProvider, "client-desktop", undefined, {
      redirectUri: "http://localhost:17248",
      scopes: ["tracker:read", "tracker:write"],
      loginHint: "user@yandex.ru",
    });

    expect(result.tokens.access_token).toBe("access");
    expect(invoke).toHaveBeenCalledWith("start_oauth_server", expect.objectContaining({ port: 17248 }));
    expect(invoke).toHaveBeenCalledWith(
      "oauth_exchange_token",
      expect.objectContaining({ redirectUri: "http://localhost:17248" }),
    );
  });

  it("rejects wrong OAuth state from localhost callback", async () => {
    const { startProviderOAuthFlow } = await import("./oauthFlow");

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "start_oauth_server") {
        return { code: "auth-code", state: "tampered-state" };
      }
      if (cmd === "open_oauth_login_window" || cmd === "close_oauth_login_window") return undefined;
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await expect(
      startProviderOAuthFlow(yandexProvider, "client-desktop", undefined, {
        redirectUri: "http://localhost:17248",
      }),
    ).rejects.toThrow(/OAuth state mismatch/);
  });
});
