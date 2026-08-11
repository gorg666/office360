import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getOAuthProvider, getAllOAuthProviders } from "./providers";

describe("OAuth providers", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_YANDEX_OAUTH_SCOPES", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("registers Yandex ID with minimal login scopes by default", async () => {
    vi.resetModules();
    const { getOAuthProvider: getProvider } = await import("./providers");
    const provider = getProvider("yandex");

    expect(provider).not.toBeNull();
    expect(provider!.authUrl).toBe("https://oauth.yandex.ru/authorize");
    expect(provider!.tokenUrl).toBe("https://oauth.yandex.ru/token");
    expect(provider!.userInfoAuthScheme).toBe("OAuth");
    expect(provider!.publicClientId).toBe("3a2cf9ad4e854c5ab83fc126d1a89ad4");
    expect(provider!.scopes).toEqual(["login:email", "login:info", "login:avatar"]);
  });

  it("returns microsoft provider config", () => {
    const provider = getOAuthProvider("microsoft");
    expect(provider).not.toBeNull();
    expect(provider!.id).toBe("microsoft");
    expect(provider!.name).toBe("Microsoft");
    expect(provider!.authUrl).toContain("login.microsoftonline.com");
    expect(provider!.tokenUrl).toContain("login.microsoftonline.com");
    expect(provider!.scopes).toContain("https://outlook.office.com/IMAP.AccessAsUser.All");
    expect(provider!.scopes).toContain("https://outlook.office.com/SMTP.Send");
    expect(provider!.scopes).toContain("offline_access");
    expect(provider!.scopes).toContain("openid");
    expect(provider!.scopes).toContain("profile");
    expect(provider!.scopes).toContain("email");
    expect(provider!.scopes).not.toContain("Mail.Read");
    expect(provider!.scopes).not.toContain("Mail.ReadWrite");
    expect(provider!.userInfoUrl).toBeUndefined();
    expect(provider!.usePkce).toBe(true);
  });

  it("returns yahoo provider config", () => {
    const provider = getOAuthProvider("yahoo");
    expect(provider).not.toBeNull();
    expect(provider!.id).toBe("yahoo");
    expect(provider!.name).toBe("Yahoo");
    expect(provider!.scopes).toContain("mail-r");
    expect(provider!.scopes).toContain("mail-w");
  });

  it("lists all providers", () => {
    const all = getAllOAuthProviders();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });
});
