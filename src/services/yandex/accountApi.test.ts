import { beforeEach, describe, expect, it, vi } from "vitest";
import { getYandexServiceClientId } from "./accountApi";
import { getAccount } from "@/services/db/accounts";
import { getAllSettings, getSetting, setSetting } from "@/services/db/settings";

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

  it("moves legacy service settings to a stable email identity after account recreation", async () => {
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
    expect(setSetting).toHaveBeenCalledWith(
      "yandex_services_refresh_token:email:turbobarsuk@yandex.ru",
      "encrypted-refresh",
    );
    expect(setSetting).toHaveBeenCalledTimes(5);
  });
});
