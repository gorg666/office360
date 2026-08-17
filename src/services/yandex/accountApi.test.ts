import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizeYandexServices,
  clearYandexServiceAuth,
  DEFAULT_YANDEX_SERVICE_CLIENT_ID,
  LEGACY_YANDEX_SERVICE_CLIENT_ID,
  YANDEX_SERVICE_SCOPES,
  getYandexServiceClientId,
  getYandexServiceContext,
  hasYandexServiceAuth,
  isYandexServiceAuthRequiredError,
  resolveYandexAccount,
  resolveYandexOrgForTracker,
  setStoredYandexOrgId,
} from "./accountApi";
import { getAccount, getAllAccounts } from "@/services/db/accounts";
import { getAllSettings, getSecureSetting, getSetting, setSecureSetting, setSetting } from "@/services/db/settings";
import { getOAuthProvider } from "@/services/oauth/providers";
import { refreshProviderToken, startProviderOAuthFlow } from "@/services/oauth/oauthFlow";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

vi.mock("@/services/db/accounts", () => ({
  getAccount: vi.fn(),
  getAllAccounts: vi.fn(),
  updateAccountAllTokens: vi.fn(),
}));
vi.mock("@/services/db/settings", () => ({
  getAllSettings: vi.fn(),
  getSecureSetting: vi.fn(),
  getSetting: vi.fn(),
  setSecureSetting: vi.fn(),
  setSetting: vi.fn(),
}));
vi.mock("@/services/oauth/oauthTokenManager", () => ({ ensureFreshToken: vi.fn() }));
vi.mock("@/services/oauth/providers", () => ({ getOAuthProvider: vi.fn() }));
vi.mock("@/services/oauth/oauthFlow", () => ({
  refreshProviderToken: vi.fn(),
  startProviderOAuthFlow: vi.fn(),
  YANDEX_DESKTOP_REDIRECT_URI: "http://localhost:17248",
  YANDEX_VERIFICATION_CODE_REDIRECT_URI: "https://oauth.yandex.ru/verification_code",
  OAUTH_CALLBACK_PORT: 17248,
  isYandexVerificationCodeRedirect: (uri: string) =>
    uri === "https://oauth.yandex.ru/verification_code"
    || uri === "https://oauth.yandex.com/verification_code",
}));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

describe("Yandex service credentials", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not assign another account's legacy service token after account recreation", async () => {
    vi.mocked(getAccount).mockResolvedValue({
      id: "new-account-id",
      email: "TurboBarsuk@Yandex.ru",
      oauth_provider: "yandex",
      auth_method: "oauth2",
    } as never);
    vi.mocked(getSetting).mockImplementation(async (key) => {
      if (key === "yandex_services_client_id:email:turbobarsuk@yandex.ru") return "client-id";
      return null;
    });
    vi.mocked(getAllSettings).mockResolvedValue({
      "yandex_services_client_id:old-account-id": "client-id",
      "yandex_services_access_token:old-account-id": "encrypted-access",
      "yandex_services_refresh_token:old-account-id": "encrypted-refresh",
      "yandex_services_expires_at:old-account-id": "123",
      "yandex_services_scopes:old-account-id": "cloud_api:disk.read cloud_api:disk.write",
    });

    await expect(getYandexServiceClientId("new-account-id")).resolves.toBe("client-id");
    expect(setSetting).not.toHaveBeenCalled();
  });

  it("moves legacy settings only when they belong to the same account id", async () => {
    vi.mocked(getAccount).mockResolvedValue({
      id: "same-account-id",
      email: "TurboBarsuk@Yandex.ru",
      oauth_provider: "yandex",
      auth_method: "oauth2",
    } as never);
    vi.mocked(getSetting).mockImplementation(async (key) => key.endsWith("client_id:email:turbobarsuk@yandex.ru") ? "client-id" : null);
    vi.mocked(getAllSettings).mockResolvedValue({
      "yandex_services_client_id:same-account-id": "client-id",
      "yandex_services_access_token:same-account-id": "encrypted-access",
      "yandex_services_refresh_token:same-account-id": "encrypted-refresh",
      "yandex_services_expires_at:same-account-id": "123",
      "yandex_services_scopes:same-account-id": "cloud_api:disk.read cloud_api:disk.write",
    });

    await expect(getYandexServiceClientId("same-account-id")).resolves.toBe("client-id");
    expect(setSetting).toHaveBeenCalledWith("yandex_services_refresh_token:email:turbobarsuk@yandex.ru", "encrypted-refresh");
  });

  it("does not fall back to another Yandex identity for a preferred account", async () => {
    vi.mocked(getAccount).mockResolvedValue({
      id: "imap-account",
      email: "info@example.com",
      oauth_provider: null,
      auth_method: "password",
    } as never);

    await expect(resolveYandexAccount("imap-account")).rejects.toThrow(
      "Активный аккаунт не подключён через Яндекс ID.",
    );
    expect(getAllAccounts).not.toHaveBeenCalled();
  });

  it("rejects and clears a service token owned by another Yandex account", async () => {
    vi.mocked(getAccount).mockResolvedValue({
      id: "selected-account",
      email: "info@timingweb.com",
      oauth_provider: "yandex",
      auth_method: "oauth2",
    } as never);
    vi.mocked(getSetting).mockImplementation(async (key) => {
      if (key.endsWith("client_id:email:info@timingweb.com")) return "client-id";
      if (key.endsWith("expires_at:email:info@timingweb.com")) return String(Date.now() + 60_000);
      if (key.endsWith("owner_email:email:info@timingweb.com")) return "turbobarsuk@yandex.ru";
      return null;
    });
    vi.mocked(getSecureSetting).mockResolvedValue("service-access-token");

    await expect(getYandexServiceContext("selected-account")).rejects.toThrow(
      "turbobarsuk@yandex.ru",
    );
    expect(setSecureSetting).toHaveBeenCalledWith(
      "yandex_services_access_token:email:info@timingweb.com",
      "",
    );
    expect(setSecureSetting).toHaveBeenCalledWith(
      "yandex_services_refresh_token:email:info@timingweb.com",
      "",
    );
  });

  it("uses managed Office360 service client id without user-provided Client ID", async () => {
    vi.mocked(getAccount).mockResolvedValue({
      id: "acc-1",
      email: "user@yandex.ru",
      oauth_provider: "yandex",
      auth_method: "oauth2",
    } as never);
    vi.mocked(getSetting).mockResolvedValue(null);
    vi.mocked(getAllSettings).mockResolvedValue({});
    vi.mocked(getOAuthProvider).mockReturnValue({
      id: "yandex",
      name: "Яндекс ID",
      authUrl: "https://oauth.yandex.ru/authorize",
      tokenUrl: "https://oauth.yandex.ru/token",
      scopes: ["login:email"],
      usePkce: true,
    } as never);
    vi.mocked(tauriFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        scope: [
          "cloud_api:disk.read",
          "cloud_api:disk.write",
          "tracker:read",
          "tracker:write",
          "directory:read_organization",
        ],
        callback: "http://localhost:17248",
      }),
    } as never);
    vi.mocked(startProviderOAuthFlow).mockResolvedValue({
      tokens: {
        access_token: "svc-access",
        refresh_token: "svc-refresh",
        expires_in: 3600,
        scope:
          "cloud_api:disk.read cloud_api:disk.write tracker:read tracker:write directory:read_organization",
      },
      userInfo: { email: "user@yandex.ru" },
    } as never);

    await authorizeYandexServices("acc-1");

    expect(DEFAULT_YANDEX_SERVICE_CLIENT_ID).toBe("9a7396c327984bd6afc75debf275850f");
    expect(startProviderOAuthFlow).toHaveBeenCalledWith(
      expect.anything(),
      DEFAULT_YANDEX_SERVICE_CLIENT_ID,
      undefined,
      expect.objectContaining({
        scopes: expect.arrayContaining([
          "cloud_api:disk.read",
          "tracker:read",
          "directory:read_organization",
        ]),
        redirectUri: "http://localhost:17248",
        accountKey: "acc-1",
      }),
    );
    const oauthOptions = vi.mocked(startProviderOAuthFlow).mock.calls[0]?.[3] as
      | { redirectUri?: string }
      | undefined;
    expect(oauthOptions?.redirectUri).not.toBe("https://oauth.yandex.ru/verification_code");
    expect(setSecureSetting).toHaveBeenCalledWith(
      "yandex_services_access_token:email:user@yandex.ru",
      "svc-access",
    );
  });

  it("migrates away from legacy диск тест client id 69e59…", async () => {
    vi.mocked(getAccount).mockResolvedValue({
      id: "acc-legacy",
      email: "user@yandex.ru",
      oauth_provider: "yandex",
      auth_method: "oauth2",
    } as never);
    vi.mocked(getSetting).mockImplementation(async (key) => {
      if (key.endsWith("client_id:email:user@yandex.ru")) return LEGACY_YANDEX_SERVICE_CLIENT_ID;
      return null;
    });
    vi.mocked(getAllSettings).mockResolvedValue({});

    await expect(getYandexServiceClientId("acc-legacy")).resolves.toBe(DEFAULT_YANDEX_SERVICE_CLIENT_ID);
    expect(setSetting).toHaveBeenCalledWith("yandex_services_client_id:email:user@yandex.ru", "");
    expect(setSecureSetting).toHaveBeenCalledWith("yandex_services_access_token:email:user@yandex.ru", "");
  });

  it("reports missing service auth and detects managed consent errors", async () => {
    vi.mocked(getAccount).mockResolvedValue({
      id: "acc-2",
      email: "user@yandex.ru",
      oauth_provider: "yandex",
      auth_method: "oauth2",
    } as never);
    vi.mocked(getSetting).mockResolvedValue(null);
    vi.mocked(getAllSettings).mockResolvedValue({});
    vi.mocked(getSecureSetting).mockResolvedValue(null);

    await expect(hasYandexServiceAuth("acc-2")).resolves.toBe(false);
    await expect(getYandexServiceContext("acc-2")).rejects.toThrow(/разрешите Office360 доступ/i);
    expect(isYandexServiceAuthRequiredError(
      new Error("Для работы с Диском и Трекером разрешите Office360 доступ к Яндекс Диску и Трекеру."),
    )).toBe(true);
  });

  it("clears service tokens on logout cleanup", async () => {
    vi.mocked(getAccount).mockResolvedValue({
      id: "acc-3",
      email: "user@yandex.ru",
      oauth_provider: "yandex",
      auth_method: "oauth2",
    } as never);
    vi.mocked(getSetting).mockResolvedValue(null);
    vi.mocked(getAllSettings).mockResolvedValue({});

    await clearYandexServiceAuth("acc-3");

    expect(setSecureSetting).toHaveBeenCalledWith(
      "yandex_services_access_token:email:user@yandex.ru",
      "",
    );
    expect(setSecureSetting).toHaveBeenCalledWith(
      "yandex_services_refresh_token:email:user@yandex.ru",
      "",
    );
  });

  it("persists rotated refresh token when service token is refreshed", async () => {
    vi.mocked(getAccount).mockResolvedValue({
      id: "acc-4",
      email: "user@yandex.ru",
      oauth_provider: "yandex",
      auth_method: "oauth2",
    } as never);
    vi.mocked(getSetting).mockImplementation(async (key) => {
      if (key.endsWith("client_id:email:user@yandex.ru")) return DEFAULT_YANDEX_SERVICE_CLIENT_ID;
      if (key.endsWith("expires_at:email:user@yandex.ru")) return "1";
      if (key.endsWith("owner_email:email:user@yandex.ru")) return "user@yandex.ru";
      return null;
    });
    vi.mocked(getSecureSetting).mockImplementation(async (key) => {
      if (key.includes("access_token")) return "old-access";
      if (key.includes("refresh_token")) return "old-refresh";
      return null;
    });
    vi.mocked(getOAuthProvider).mockReturnValue({ id: "yandex", usePkce: true } as never);
    vi.mocked(refreshProviderToken).mockResolvedValue({
      access_token: "new-access",
      refresh_token: "rotated-refresh",
      expires_in: 3600,
    } as never);

    await expect(getYandexServiceContext("acc-4")).resolves.toEqual({
      account: expect.objectContaining({ id: "acc-4" }),
      token: "new-access",
    });
    expect(setSecureSetting).toHaveBeenCalledWith(
      "yandex_services_refresh_token:email:user@yandex.ru",
      "rotated-refresh",
    );
  });
});

describe("Yandex org resolve for Tracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests directory:read_organization in managed service scopes", () => {
    expect(YANDEX_SERVICE_SCOPES).toContain("directory:read_organization");
  });

  it("auto-saves when Directory returns exactly one organization", async () => {
    vi.mocked(getAccount).mockResolvedValue({
      id: "acc-org-1",
      email: "user@yandex.ru",
      oauth_provider: "yandex",
      auth_method: "oauth2",
    } as never);
    vi.mocked(getSetting).mockResolvedValue(null);
    vi.mocked(getAllSettings).mockResolvedValue({});
    vi.mocked(getSecureSetting).mockImplementation(async (key) => {
      if (key.includes("access_token")) return "svc-access";
      if (key.includes("refresh_token")) return "svc-refresh";
      return null;
    });
    vi.mocked(getSetting).mockImplementation(async (key) => {
      if (key.endsWith("client_id:email:user@yandex.ru")) return DEFAULT_YANDEX_SERVICE_CLIENT_ID;
      if (key.endsWith("expires_at:email:user@yandex.ru")) return String(Math.floor(Date.now() / 1000) + 3600);
      if (key.endsWith("owner_email:email:user@yandex.ru")) return "user@yandex.ru";
      if (key.startsWith("yandex_org_id:")) return null;
      return null;
    });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ organizations: [{ id: 42, name: "Acme" }] }),
    } as never);

    await expect(resolveYandexOrgForTracker("acc-org-1")).resolves.toEqual({
      status: "ready",
      orgId: "42",
      source: "auto",
    });
    expect(setSetting).toHaveBeenCalledWith("yandex_org_id:acc-org-1", "42");
  });

  it("returns picker when multiple organizations are available", async () => {
    vi.mocked(getAccount).mockResolvedValue({
      id: "acc-org-2",
      email: "user@yandex.ru",
      oauth_provider: "yandex",
      auth_method: "oauth2",
    } as never);
    vi.mocked(getAllSettings).mockResolvedValue({});
    vi.mocked(getSecureSetting).mockImplementation(async (key) => {
      if (key.includes("access_token")) return "svc-access";
      if (key.includes("refresh_token")) return "svc-refresh";
      return null;
    });
    vi.mocked(getSetting).mockImplementation(async (key) => {
      if (key.endsWith("client_id:email:user@yandex.ru")) return DEFAULT_YANDEX_SERVICE_CLIENT_ID;
      if (key.endsWith("expires_at:email:user@yandex.ru")) return String(Math.floor(Date.now() / 1000) + 3600);
      if (key.endsWith("owner_email:email:user@yandex.ru")) return "user@yandex.ru";
      return null;
    });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        organizations: [
          { id: 1, name: "One" },
          { id: 2, name: "Two" },
        ],
      }),
    } as never);

    await expect(resolveYandexOrgForTracker("acc-org-2")).resolves.toEqual({
      status: "pick",
      organizations: [
        { id: 1, name: "One" },
        { id: 2, name: "Two" },
      ],
    });
  });

  it("falls back to manual when Directory returns zero organizations", async () => {
    vi.mocked(getAccount).mockResolvedValue({
      id: "acc-org-0",
      email: "user@yandex.ru",
      oauth_provider: "yandex",
      auth_method: "oauth2",
    } as never);
    vi.mocked(getAllSettings).mockResolvedValue({});
    vi.mocked(getSecureSetting).mockImplementation(async (key) => {
      if (key.includes("access_token")) return "svc-access";
      if (key.includes("refresh_token")) return "svc-refresh";
      return null;
    });
    vi.mocked(getSetting).mockImplementation(async (key) => {
      if (key.endsWith("client_id:email:user@yandex.ru")) return DEFAULT_YANDEX_SERVICE_CLIENT_ID;
      if (key.endsWith("expires_at:email:user@yandex.ru")) return String(Math.floor(Date.now() / 1000) + 3600);
      if (key.endsWith("owner_email:email:user@yandex.ru")) return "user@yandex.ru";
      return null;
    });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ organizations: [] }),
    } as never);

    const result = await resolveYandexOrgForTracker("acc-org-0");
    expect(result).toMatchObject({ status: "manual", reason: "empty", needsReconsent: false });
    expect(result.status === "manual" && result.message).not.toMatch(/X-Org-ID/i);
  });

  it("marks directory 403 as re-consent and avoids raw forbidden dump", async () => {
    vi.mocked(getAccount).mockResolvedValue({
      id: "acc-org-403",
      email: "user@yandex.ru",
      oauth_provider: "yandex",
      auth_method: "oauth2",
    } as never);
    vi.mocked(getAllSettings).mockResolvedValue({});
    vi.mocked(getSecureSetting).mockImplementation(async (key) => {
      if (key.includes("access_token")) return "svc-access";
      if (key.includes("refresh_token")) return "svc-refresh";
      return null;
    });
    vi.mocked(getSetting).mockImplementation(async (key) => {
      if (key.endsWith("client_id:email:user@yandex.ru")) return DEFAULT_YANDEX_SERVICE_CLIENT_ID;
      if (key.endsWith("expires_at:email:user@yandex.ru")) return String(Math.floor(Date.now() / 1000) + 3600);
      if (key.endsWith("owner_email:email:user@yandex.ru")) return "user@yandex.ru";
      return null;
    });
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: "Доступ запрещён. Возможно, у приложения недостаточно прав для данного действия." }),
    } as never);

    const result = await resolveYandexOrgForTracker("acc-org-403");
    expect(result).toMatchObject({
      status: "manual",
      reason: "directory_forbidden",
      needsReconsent: true,
    });
    expect(result.status === "manual" && result.message).toMatch(/обновить доступ/i);
    expect(result.status === "manual" && result.message).not.toMatch(/^Доступ запрещён/i);
  });

  it("saves manual organization id account-scoped", async () => {
    await setStoredYandexOrgId("acc-manual", "998877");
    expect(setSetting).toHaveBeenCalledWith("yandex_org_id:acc-manual", "998877");
  });
});
