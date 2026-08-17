import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const getAccountByEmail = vi.fn();
const getDesktopPlatform = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@/services/db/accounts", () => ({
  getAccountByEmail: (...args: unknown[]) => getAccountByEmail(...args),
}));
vi.mock("@/utils/desktopPlatform", () => ({
  getDesktopPlatform: () => getDesktopPlatform(),
}));

import {
  assertYandexOAuthMatchesAccount,
  bootstrapYandexPassportSession,
  cleanupProvisionalYandexWkStore,
  requireYandexWkAccountKey,
  resolveYandexWkAccountKey,
  YANDEX_PASSPORT_BOOTSTRAP_URL,
} from "./yandexAuthSession";

describe("yandexAuthSession", () => {
  beforeEach(() => {
    invoke.mockReset();
    getAccountByEmail.mockReset();
    getDesktopPlatform.mockReset();
    invoke.mockResolvedValue(undefined);
    getDesktopPlatform.mockResolvedValue("macos");
  });

  it("requires a non-empty account session key", () => {
    expect(() => requireYandexWkAccountKey("")).toThrow("account session key");
    expect(requireYandexWkAccountKey(" acc-1 ")).toBe("acc-1");
  });

  it("reuses an existing account id and marks new ids as provisional", async () => {
    getAccountByEmail.mockResolvedValueOnce({ id: "existing-id" });
    await expect(resolveYandexWkAccountKey("user@yandex.ru")).resolves.toEqual({
      accountKey: "existing-id",
      provisional: false,
    });

    getAccountByEmail.mockResolvedValueOnce(null);
    const created = await resolveYandexWkAccountKey("new@yandex.ru");
    expect(created.provisional).toBe(true);
    expect(created.accountKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("rejects a different Yandex identity for an existing account", () => {
    expect(() => assertYandexOAuthMatchesAccount("a@yandex.ru", "b@yandex.ru")).toThrow(
      "В Яндекс ID выбран другой аккаунт",
    );
    expect(() => assertYandexOAuthMatchesAccount("a@yandex.ru", "A@yandex.ru")).not.toThrow();
  });

  it("cleans only provisional macOS WK stores", async () => {
    await cleanupProvisionalYandexWkStore("temp-id", false);
    expect(invoke).not.toHaveBeenCalled();

    await cleanupProvisionalYandexWkStore("temp-id", true);
    expect(invoke).toHaveBeenCalledWith("reset_telemost_macos_profile", { accountKey: "temp-id" });

    invoke.mockClear();
    getDesktopPlatform.mockResolvedValueOnce("windows");
    await cleanupProvisionalYandexWkStore("temp-id", true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("opens official Passport login in the account WK store without OAuth regrant", async () => {
    await bootstrapYandexPassportSession("acc-1");
    expect(invoke).toHaveBeenCalledWith("open_oauth_login_window", {
      url: YANDEX_PASSPORT_BOOTSTRAP_URL,
      accountKey: "acc-1",
      purpose: "passport-bootstrap",
    });
    expect(YANDEX_PASSPORT_BOOTSTRAP_URL).toContain("passport.yandex.ru");
    expect(YANDEX_PASSPORT_BOOTSTRAP_URL).not.toContain("oauth.yandex");
  });
});
