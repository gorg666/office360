import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizeYandexServices,
  getYandexServiceClientId,
  getYandexServiceContext,
  resolveYandexAccount,
  resolveYandexServiceRedirectUri,
  resolveYandexServiceScopes,
  YANDEX_SERVICE_REDIRECT_LOCALHOST,
  YANDEX_SERVICE_REDIRECT_VERIFICATION_CODE,
} from "./accountApi";
import { getAccount, getAllAccounts } from "@/services/db/accounts";
import { getAllSettings, getSecureSetting, getSetting, setSecureSetting, setSetting } from "@/services/db/settings";
import { getOAuthProvider } from "@/services/oauth/providers";
import { startProviderOAuthFlow } from "@/services/oauth/oauthFlow";
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
});

describe("resolveYandexServiceRedirectUri", () => {
  it("maps Office360 desktop callback to localhost:17248", () => {
    expect(resolveYandexServiceRedirectUri({ callback: "http://localhost:17248" }))
      .toBe(YANDEX_SERVICE_REDIRECT_LOCALHOST);
    expect(resolveYandexServiceRedirectUri({ callback: "http://127.0.0.1:17248" }))
      .toBe(YANDEX_SERVICE_REDIRECT_LOCALHOST);
  });

  it("keeps verification_code for DEFAULT services client callback", () => {
    expect(resolveYandexServiceRedirectUri({
      callback: "https://oauth.yandex.ru/verification_code",
    })).toBe(YANDEX_SERVICE_REDIRECT_VERIFICATION_CODE);
  });

  it("defaults missing callback to verification_code", () => {
    expect(resolveYandexServiceRedirectUri({})).toBe(YANDEX_SERVICE_REDIRECT_VERIFICATION_CODE);
  });

  it("rejects unsupported callbacks", () => {
    expect(() => resolveYandexServiceRedirectUri({ callback: "https://example.com/cb" }))
      .toThrow(/Неподдерживаемый Callback URL/);
  });
});

describe("resolveYandexServiceScopes", () => {
  const base = [
    "cloud_api:disk.read",
    "cloud_api:disk.write",
    "tracker:read",
    "tracker:write",
  ];

  it("requires tracker+disk and intersects preferred directory scopes", () => {
    expect(resolveYandexServiceScopes([
      ...base,
      "directory:read_organization",
    ])).toEqual([
      ...base,
      "directory:read_organization",
    ]);
  });

  it("includes optional departments when enabled", () => {
    expect(resolveYandexServiceScopes([
      ...base,
      "directory:read_users",
      "directory:read_departments",
    ])).toContain("directory:read_departments");
  });

  it("fails when required tracker scopes missing", () => {
    expect(() => resolveYandexServiceScopes(["cloud_api:disk.read", "cloud_api:disk.write"]))
      .toThrow(/tracker:read/);
  });
});

describe("authorizeYandexServices redirect policy", () => {
  const primary = {
    id: "4ae2b615-9991-40ef-a9bb-f3e6d788b9c7",
    email: "korotkov@office-360.ru",
    oauth_provider: "yandex",
    auth_method: "oauth2",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAccount).mockResolvedValue(primary as never);
    vi.mocked(getOAuthProvider).mockReturnValue({ id: "yandex" } as never);
    vi.mocked(getAllSettings).mockResolvedValue({});
    vi.mocked(getSetting).mockResolvedValue(null);
    vi.mocked(startProviderOAuthFlow).mockResolvedValue({
      tokens: {
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
        token_type: "bearer",
        scope: "tracker:read tracker:write",
      },
      userInfo: { email: "korotkov@office-360.ru", name: "Primary" },
    });
  });

  it("uses localhost callback for client registered with localhost:17248", async () => {
    vi.mocked(tauriFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        callback: "http://localhost:17248",
        scope: [
          "cloud_api:disk.read",
          "cloud_api:disk.write",
          "tracker:read",
          "tracker:write",
          "directory:read_organization",
        ],
      }),
    } as never);

    await authorizeYandexServices(primary.id, "9a7396c327984bd6afc75debf275850f");

    expect(startProviderOAuthFlow).toHaveBeenCalledWith(
      expect.anything(),
      "9a7396c327984bd6afc75debf275850f",
      undefined,
      expect.objectContaining({
        redirectUri: YANDEX_SERVICE_REDIRECT_LOCALHOST,
        loginHint: "korotkov@office-360.ru",
        scopes: expect.arrayContaining([
          "tracker:read",
          "tracker:write",
          "directory:read_organization",
        ]),
      }),
    );
    expect(setSetting).toHaveBeenCalledWith(
      "yandex_services_client_id:email:korotkov@office-360.ru",
      "9a7396c327984bd6afc75debf275850f",
    );
    expect(setSecureSetting).toHaveBeenCalledWith(
      "yandex_services_access_token:email:korotkov@office-360.ru",
      "access",
    );
  });

  it("keeps verification_code for DEFAULT services client", async () => {
    vi.mocked(tauriFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        callback: "https://oauth.yandex.ru/verification_code",
        scope: [
          "cloud_api:disk.read",
          "cloud_api:disk.write",
          "tracker:read",
          "tracker:write",
          "directory:read_users",
        ],
      }),
    } as never);

    await authorizeYandexServices(primary.id, "69e59ec6dcfe4be3a085006d49678056");

    expect(startProviderOAuthFlow).toHaveBeenCalledWith(
      expect.anything(),
      "69e59ec6dcfe4be3a085006d49678056",
      undefined,
      expect.objectContaining({
        redirectUri: YANDEX_SERVICE_REDIRECT_VERIFICATION_CODE,
      }),
    );
  });

  it("maps port-in-use to a typed Russian error", async () => {
    vi.mocked(tauriFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        callback: "http://localhost:17248",
        scope: [
          "cloud_api:disk.read",
          "cloud_api:disk.write",
          "tracker:read",
          "tracker:write",
        ],
      }),
    } as never);
    vi.mocked(startProviderOAuthFlow).mockRejectedValue(
      new Error("Failed to bind OAuth callback on port 17248 (127.0.0.1 and [::1]). Another process may be using the port"),
    );

    await expect(authorizeYandexServices(primary.id, "9a7396c327984bd6afc75debf275850f"))
      .rejects.toThrow(/Порт OAuth callback 17248 занят/);
  });
});
