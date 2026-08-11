import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizeYandexGrant,
  authorizeYandexSuite,
  getYandexGrantAccessToken,
  getYandexUnifiedAuthStatus,
  YANDEX_OAUTH_GRANTS,
} from "./yandexUnifiedAuth";
import { getAccount } from "@/services/db/accounts";
import { getSecureSetting, getSetting, setSecureSetting, setSetting } from "@/services/db/settings";
import { getOAuthProvider } from "./providers";
import { refreshProviderToken, startProviderOAuthFlow } from "./oauthFlow";
import { ensureFreshToken } from "./oauthTokenManager";
import { fetchYandexLoginProfile } from "./yandexProfile";

vi.mock("@/services/db/accounts", () => ({ getAccount: vi.fn() }));
vi.mock("@/services/db/settings", () => ({
  getSecureSetting: vi.fn(),
  getSetting: vi.fn(),
  setSecureSetting: vi.fn(() => Promise.resolve()),
  setSetting: vi.fn(() => Promise.resolve()),
}));
vi.mock("./providers", () => ({ getOAuthProvider: vi.fn() }));
vi.mock("./oauthFlow", () => ({
  refreshProviderToken: vi.fn(),
  startProviderOAuthFlow: vi.fn(),
}));
vi.mock("./oauthTokenManager", () => ({ ensureFreshToken: vi.fn() }));
vi.mock("./yandexProfile", () => ({ fetchYandexLoginProfile: vi.fn() }));

const account = {
  id: "account-id",
  email: "User@Yandex.ru",
  oauth_provider: "yandex",
  auth_method: "oauth2",
  refresh_token: "core-refresh",
  oauth_granted_scopes: "mail:imap_full mail:smtp calendar:all",
} as const;

describe("Yandex unified OAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAccount).mockResolvedValue(account as never);
    vi.mocked(getOAuthProvider).mockReturnValue({ id: "yandex" } as never);
    vi.mocked(getSetting).mockImplementation(async (key) =>
      key.includes("core_owner_uid") ? "core-uid" : null,
    );
    vi.mocked(ensureFreshToken).mockResolvedValue("core-access");
    vi.mocked(fetchYandexLoginProfile).mockResolvedValue({
      email: "user@yandex.ru",
      name: "User",
      subjectId: "core-uid",
    });
  });

  it("uses a fixed client and scope set for every grant", async () => {
    vi.mocked(startProviderOAuthFlow).mockResolvedValue({
      tokens: {
        access_token: "work-access",
        refresh_token: "work-refresh",
        expires_in: 3600,
        token_type: "bearer",
        scope: YANDEX_OAUTH_GRANTS.work.scopes.join(" "),
      },
      userInfo: { email: "", name: "User", login: "user", subjectId: "core-uid" },
    });

    await authorizeYandexGrant(account.id, "work");

    expect(startProviderOAuthFlow).toHaveBeenCalledWith(
      expect.anything(),
      YANDEX_OAUTH_GRANTS.work.clientId,
      undefined,
      expect.objectContaining({
        loginHint: account.email,
        scopes: [...YANDEX_OAUTH_GRANTS.work.scopes],
      }),
    );
    expect(setSecureSetting).toHaveBeenCalledWith(
      "yandex_oauth_work_refresh_token:email:user@yandex.ru",
      "work-refresh",
    );
    expect(setSetting).toHaveBeenCalledWith(
      "yandex_oauth_work_owner_uid:email:user@yandex.ru",
      "core-uid",
    );
  });

  it("rejects a grant issued for another Yandex identity", async () => {
    vi.mocked(startProviderOAuthFlow).mockResolvedValue({
      tokens: { access_token: "x", refresh_token: "r", expires_in: 3600, token_type: "bearer" },
      userInfo: { email: "", name: "Other", login: "other", subjectId: "other-uid" },
    });

    await expect(authorizeYandexGrant(account.id, "communications")).rejects.toThrow(
      "другой Яндекс ID",
    );
    expect(setSecureSetting).not.toHaveBeenCalled();
  });

  it("bootstraps the immutable core UID and accepts a domain alias for the same identity", async () => {
    vi.mocked(getSetting).mockResolvedValue(null);
    vi.mocked(startProviderOAuthFlow).mockResolvedValue({
      tokens: { access_token: "x", refresh_token: "r", expires_in: 3600, token_type: "bearer" },
      userInfo: { email: "alias@company.ru", name: "User", subjectId: "core-uid" },
    });

    await authorizeYandexGrant(account.id, "work");

    expect(ensureFreshToken).toHaveBeenCalledWith(account);
    expect(fetchYandexLoginProfile).toHaveBeenCalledWith("core-access");
    expect(setSetting).toHaveBeenCalledWith(
      "yandex_oauth_core_owner_uid:email:user@yandex.ru",
      "core-uid",
    );
  });

  it("continues the standard suite when one optional grant is cancelled", async () => {
    vi.mocked(startProviderOAuthFlow)
      .mockRejectedValueOnce(new Error("cancelled"))
      .mockResolvedValueOnce({
        tokens: { access_token: "c", refresh_token: "cr", expires_in: 3600, token_type: "bearer" },
        userInfo: { email: "", name: "User", login: "user", subjectId: "core-uid" },
      });

    const result = await authorizeYandexSuite(account.id, { continueOnError: true });

    expect(result.map((item) => item.state)).toEqual(["failed", "connected"]);
  });

  it("refreshes only the requested grant", async () => {
    vi.mocked(getSecureSetting).mockImplementation(async (key) =>
      key.includes("access_token") ? "old-access" : "refresh-token",
    );
    vi.mocked(getSetting).mockImplementation(async (key) => {
      if (key.includes("owner_email")) return "user@yandex.ru";
      if (key.includes("owner_uid")) return "core-uid";
      if (key.includes("expires_at")) return "1";
      return null;
    });
    vi.mocked(refreshProviderToken).mockResolvedValue({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
      token_type: "bearer",
    });

    await expect(getYandexGrantAccessToken(account.id, "communications")).resolves.toBe("new-access");
    expect(refreshProviderToken).toHaveBeenCalledWith(
      expect.anything(),
      "refresh-token",
      YANDEX_OAUTH_GRANTS.communications.clientId,
    );
  });

  it("reports four independent grant statuses", async () => {
    vi.mocked(getSecureSetting).mockImplementation(async (key) => key.includes("work_refresh_token") ? "token" : null);
    vi.mocked(getSetting).mockResolvedValue(null);

    const statuses = await getYandexUnifiedAuthStatus(account.id);

    expect(statuses.map((status) => [status.id, status.connected])).toEqual([
      ["core", true],
      ["work", true],
      ["communications", false],
      ["admin", false],
    ]);
  });
});
