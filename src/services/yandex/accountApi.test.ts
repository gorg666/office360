import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizeYandexServices,
  DEFAULT_YANDEX_SERVICE_CLIENT_ID,
  getYandexServiceClientId,
  getYandexServiceContext,
  resolveYandexAccount,
} from "./accountApi";
import { getAccount, getAllAccounts } from "@/services/db/accounts";
import { authorizeYandexGrant, getYandexGrantAccessToken } from "@/services/oauth/yandexUnifiedAuth";

vi.mock("@/services/db/accounts", () => ({
  getAccount: vi.fn(),
  getAllAccounts: vi.fn(),
  updateAccountAllTokens: vi.fn(),
  updateAccountOAuthClient: vi.fn(),
}));
vi.mock("@/services/db/settings", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }));
vi.mock("@/services/oauth/oauthTokenManager", () => ({ ensureFreshToken: vi.fn() }));
vi.mock("@/services/oauth/providers", () => ({ getOAuthProvider: vi.fn() }));
vi.mock("@/services/oauth/oauthFlow", () => ({ startProviderOAuthFlow: vi.fn() }));
vi.mock("@/services/oauth/yandexUnifiedAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/oauth/yandexUnifiedAuth")>();
  return {
    ...actual,
    authorizeYandexGrant: vi.fn(),
    getYandexGrantAccessToken: vi.fn(),
  };
});

const yandexAccount = {
  id: "account-id",
  email: "user@yandex.ru",
  oauth_provider: "yandex",
  auth_method: "oauth2",
} as const;

describe("Yandex service credentials", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the bundled Work client without asking the user for Client ID", async () => {
    vi.mocked(getAccount).mockResolvedValue(yandexAccount as never);
    await expect(getYandexServiceClientId(yandexAccount.id)).resolves.toBe(DEFAULT_YANDEX_SERVICE_CLIENT_ID);
  });

  it("authorizes the Work grant", async () => {
    await authorizeYandexServices(yandexAccount.id);
    expect(authorizeYandexGrant).toHaveBeenCalledWith(yandexAccount.id, "work");
  });

  it("routes Disk and Tracker through the Work token", async () => {
    vi.mocked(getAccount).mockResolvedValue(yandexAccount as never);
    vi.mocked(getYandexGrantAccessToken).mockResolvedValue("work-token");

    await expect(getYandexServiceContext(yandexAccount.id)).resolves.toEqual({
      account: yandexAccount,
      token: "work-token",
    });
    expect(getYandexGrantAccessToken).toHaveBeenCalledWith(yandexAccount.id, "work");
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
});
