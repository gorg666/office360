import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveYandexMessengerSession } from "./yandexMessengerSession";
import { getAllAccounts } from "@/services/db/accounts";
import { ensureFreshToken } from "@/services/oauth/oauthTokenManager";
import { loadMessengerCredentials } from "./credentials";

vi.mock("@/services/db/accounts", () => ({ getAllAccounts: vi.fn() }));
vi.mock("@/services/oauth/oauthTokenManager", () => ({ ensureFreshToken: vi.fn() }));
vi.mock("./credentials", () => ({ loadMessengerCredentials: vi.fn() }));

const yandexAccount = {
  id: "active-yandex",
  email: "user@yandex.ru",
  provider: "imap",
  auth_method: "oauth2",
  oauth_provider: "yandex",
  access_token: "stale-access-token",
};

describe("resolveYandexMessengerSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prefers OAuth of the active Yandex account over a saved bot token", async () => {
    vi.mocked(getAllAccounts).mockResolvedValue([yandexAccount] as never);
    vi.mocked(loadMessengerCredentials).mockReturnValue({ providerId: "yandex", token: "bot-token", savedAt: 1 });
    vi.mocked(ensureFreshToken).mockResolvedValue("fresh-oauth-token");

    await expect(resolveYandexMessengerSession("active-yandex")).resolves.toEqual({
      token: "fresh-oauth-token",
      manual: false,
      accountId: "active-yandex",
      accountEmail: "user@yandex.ru",
    });
    expect(loadMessengerCredentials).not.toHaveBeenCalled();
  });

  it("uses the saved bot token only when no Yandex OAuth account exists", async () => {
    vi.mocked(getAllAccounts).mockResolvedValue([]);
    vi.mocked(loadMessengerCredentials).mockReturnValue({ providerId: "yandex", token: "bot-token", savedAt: 1 });

    await expect(resolveYandexMessengerSession(null)).resolves.toEqual({
      token: "bot-token",
      manual: true,
    });
  });
});
