import { describe, expect, it } from "vitest";
import { getOAuthProvider } from "./providers";

describe("OAuth providers", () => {
  it("registers Yandex ID with minimal login scopes by default", () => {
    const provider = getOAuthProvider("yandex");

    expect(provider).not.toBeNull();
    expect(provider!.authUrl).toBe("https://oauth.yandex.ru/authorize");
    expect(provider!.tokenUrl).toBe("https://oauth.yandex.ru/token");
    expect(provider!.userInfoAuthScheme).toBe("OAuth");
    expect(provider!.publicClientId).toBe("3a2cf9ad4e854c5ab83fc126d1a89ad4");
    expect(provider!.scopes).toContain("login:email");
    expect(provider!.scopes).toContain("login:info");
    expect(provider!.scopes).toContain("login:avatar");
    expect(provider!.scopes).not.toContain("mail:imap_full");
    expect(provider!.scopes).not.toContain("mail:smtp");
    expect(provider!.scopes).not.toContain("directory:read_users");
    expect(provider!.scopes).not.toContain("ya360_admin:mail_write_organization_settings");
    expect(provider!.scopes).not.toContain("ya360_security:read_auditlog");
  });
});
import { describe, it, expect } from "vitest";
import { getOAuthProvider, getAllOAuthProviders } from "./providers";

describe("getOAuthProvider", () => {
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
    expect(provider!.userInfoUrl).toBeUndefined();
    expect(provider!.usePkce).toBe(true);
  });

  it("returns yahoo provider config", () => {
    const provider = getOAuthProvider("yahoo");
    expect(provider).not.toBeNull();
    expect(provider!.id).toBe("yahoo");
    expect(provider!.name).toBe("Yahoo");
    expect(provider!.authUrl).toContain("login.yahoo.com");
    expect(provider!.scopes).toContain("mail-r");
    expect(provider!.scopes).toContain("mail-w");
    expect(provider!.usePkce).toBe(true);
  });

  it("returns null for unknown provider", () => {
    expect(getOAuthProvider("unknown")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(getOAuthProvider("")).toBeNull();
  });
});

describe("getAllOAuthProviders", () => {
  it("returns all registered providers", () => {
    const providers = getAllOAuthProviders();
    expect(providers.length).toBeGreaterThanOrEqual(2);
    const ids = providers.map((p) => p.id);
    expect(ids).toContain("microsoft");
    expect(ids).toContain("yahoo");
  });
});
