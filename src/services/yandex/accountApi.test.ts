import { beforeEach, describe, expect, it, vi } from "vitest";
import { getYandexServiceClientId, getYandexServiceContext } from "./accountApi";
import { getAccount, getAllAccounts } from "@/services/db/accounts";
import { resolveYandexAccount } from "./accountApi";
import { getAllSettings, getSecureSetting, getSetting, setSecureSetting, setSetting } from "@/services/db/settings";

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
