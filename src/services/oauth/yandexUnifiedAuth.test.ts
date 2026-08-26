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
import { refreshProviderToken, startProviderOAuthFlow, YANDEX_DESKTOP_REDIRECT_URI } from "./oauthFlow";
import { ensureFreshToken } from "./oauthTokenManager";
import { fetchYandexLoginProfile } from "./yandexProfile";
import {
  authorizeYandexServices,
  clearYandexServiceAuth,
  DEFAULT_YANDEX_SERVICE_CLIENT_ID,
  getYandexServiceContext,
  hasYandexServiceAuth,
} from "@/services/yandex/accountApi";

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
  YANDEX_DESKTOP_REDIRECT_URI: "http://localhost:17248",
}));
vi.mock("./oauthTokenManager", () => ({ ensureFreshToken: vi.fn() }));
vi.mock("./yandexProfile", () => ({ fetchYandexLoginProfile: vi.fn() }));
vi.mock("@/services/yandex/accountApi", () => ({
  authorizeYandexServices: vi.fn(() => Promise.resolve()),
  clearYandexServiceAuth: vi.fn(() => Promise.resolve()),
  getYandexServiceContext: vi.fn(),
  hasYandexServiceAuth: vi.fn(),
  DEFAULT_YANDEX_SERVICE_CLIENT_ID: "9a7396c327984bd6afc75debf275850f",
  YANDEX_SERVICE_SCOPES: [
    "cloud_api:disk.read",
    "cloud_api:disk.write",
    "tracker:read",
    "tracker:write",
    "directory:read_organization",
  ],
}));

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
    vi.mocked(hasYandexServiceAuth).mockResolvedValue(false);
    vi.mocked(getYandexServiceContext).mockResolvedValue({
      account: account as never,
      token: "work-service-token",
    });
  });

  it("delegates work grant to GORGDEV2 service auth client 9a7396", async () => {
    expect(YANDEX_OAUTH_GRANTS.work.clientId).toBe(DEFAULT_YANDEX_SERVICE_CLIENT_ID);
    expect(YANDEX_OAUTH_GRANTS.work.clientId).toBe("9a7396c327984bd6afc75debf275850f");
    expect(YANDEX_OAUTH_GRANTS.work.label).toBe("Диск и Трекер");

    await authorizeYandexGrant(account.id, "work");

    expect(authorizeYandexServices).toHaveBeenCalledWith(account.id);
    expect(startProviderOAuthFlow).not.toHaveBeenCalled();
  });

  it("stores communications grant via desktop loopback PKCE", async () => {
    vi.mocked(startProviderOAuthFlow).mockResolvedValue({
      tokens: {
        access_token: "comms-access",
        refresh_token: "comms-refresh",
        expires_in: 3600,
        token_type: "bearer",
        scope: YANDEX_OAUTH_GRANTS.communications.scopes.join(" "),
      },
      userInfo: { email: "", name: "User", login: "user", subjectId: "core-uid" },
    });

    await authorizeYandexGrant(account.id, "communications");

    expect(startProviderOAuthFlow).toHaveBeenCalledWith(
      expect.anything(),
      YANDEX_OAUTH_GRANTS.communications.clientId,
      undefined,
      expect.objectContaining({
        loginHint: account.email,
        scopes: [...YANDEX_OAUTH_GRANTS.communications.scopes],
        redirectUri: YANDEX_DESKTOP_REDIRECT_URI,
      }),
    );
    expect(setSecureSetting).toHaveBeenCalledWith(
      "yandex_oauth_communications_refresh_token:email:user@yandex.ru",
      "comms-refresh",
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

  it("continues the standard suite when one optional grant is cancelled", async () => {
    vi.mocked(authorizeYandexServices).mockRejectedValueOnce(new Error("cancelled"));
    vi.mocked(startProviderOAuthFlow).mockResolvedValueOnce({
      tokens: { access_token: "c", refresh_token: "cr", expires_in: 3600, token_type: "bearer" },
      userInfo: { email: "", name: "User", login: "user", subjectId: "core-uid" },
    });

    const result = await authorizeYandexSuite(account.id, { continueOnError: true });

    expect(result.map((item) => item.state)).toEqual(["failed", "connected"]);
  });

  it("reads work token from service context and refreshes communications grant", async () => {
    await expect(getYandexGrantAccessToken(account.id, "work")).resolves.toBe("work-service-token");
    expect(getYandexServiceContext).toHaveBeenCalledWith(account.id);

    vi.mocked(getSecureSetting).mockImplementation(async (key) =>
      key.includes("access_token") ? "old-access" : "refresh-token",
    );
    vi.mocked(getSetting).mockImplementation(async (key) => {
      if (key.includes("owner_email")) return "user@yandex.ru";
      if (key.includes("owner_uid")) return "core-uid";
      if (key.includes("expires_at")) return "1";
      if (key.includes("core_owner_uid")) return "core-uid";
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

  it("reports hybrid statuses with work from hasYandexServiceAuth", async () => {
    vi.mocked(hasYandexServiceAuth).mockResolvedValue(true);
    vi.mocked(getSecureSetting).mockResolvedValue(null);
    vi.mocked(getSetting).mockResolvedValue(null);

    const statuses = await getYandexUnifiedAuthStatus(account.id);

    expect(statuses.map((status) => [status.id, status.connected, status.statusLabel])).toEqual([
      ["core", true, "CONNECTED"],
      ["work", true, "CONNECTED"],
      ["communications", false, "NEEDS ACCESS"],
      ["admin", false, "NEEDS ACCESS"],
    ]);
    expect(clearYandexServiceAuth).not.toHaveBeenCalled();
  });
});
