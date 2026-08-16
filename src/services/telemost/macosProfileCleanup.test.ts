import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopPlatform } from "@/utils/desktopPlatform";

const mocks = vi.hoisted(() => ({
  platform: "macos" as DesktopPlatform,
  invoke: vi.fn(),
  getAccount: vi.fn(),
}));

vi.mock("@/utils/desktopPlatform", () => ({
  getDesktopPlatform: vi.fn(async () => mocks.platform),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/services/db/accounts", () => ({
  getAccount: mocks.getAccount,
}));

import {
  isYandexTelemostAccount,
  resetTelemostMacosProfileForRemovedAccount,
} from "./macosProfileCleanup";

function yandexAccount(id: string) {
  return { id, oauth_provider: "yandex", auth_method: "oauth2" };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.platform = "macos";
  mocks.invoke.mockResolvedValue(undefined);
  mocks.getAccount.mockImplementation(async (id: string) => yandexAccount(id));
});

describe("resetTelemostMacosProfileForRemovedAccount", () => {
  it("invokes reset_telemost_macos_profile with the removed Yandex account id on macOS", async () => {
    await expect(resetTelemostMacosProfileForRemovedAccount("account-b")).resolves.toEqual({ status: "ok" });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("reset_telemost_macos_profile", {
      accountKey: "account-b",
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith("cef_reset_account_profile", expect.anything());
    expect(mocks.invoke).not.toHaveBeenCalledWith("reset_telemost_macos_profile", {
      accountKey: "account-a",
    });
  });

  it("does not invoke on Windows even for a Yandex account", async () => {
    mocks.platform = "windows";
    await expect(resetTelemostMacosProfileForRemovedAccount("account-b")).resolves.toEqual({
      status: "skipped",
      reason: "not-macos",
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("does not invoke for a non-Yandex account on macOS", async () => {
    mocks.getAccount.mockResolvedValue({ id: "account-b", oauth_provider: "google", auth_method: "oauth2" });
    await expect(resetTelemostMacosProfileForRemovedAccount("account-b")).resolves.toEqual({
      status: "skipped",
      reason: "not-yandex",
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("does not invoke an empty or whitespace account key", async () => {
    await expect(resetTelemostMacosProfileForRemovedAccount("   ")).resolves.toEqual({
      status: "skipped",
      reason: "invalid-account",
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("returns a failed diagnostic without throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.invoke.mockRejectedValue(Object.assign(new Error("store missing"), { name: "DataStoreInUse" }));
    await expect(resetTelemostMacosProfileForRemovedAccount("account-b")).resolves.toEqual({
      status: "failed",
      errorClass: "DataStoreInUse",
    });
    expect(warn).toHaveBeenCalledWith("telemost profile cleanup failed", {
      accountId: "account-b",
      errorClass: "DataStoreInUse",
    });
    warn.mockRestore();
  });
});

describe("isYandexTelemostAccount", () => {
  it("requires Yandex OAuth metadata, not email domain", () => {
    expect(isYandexTelemostAccount({ oauth_provider: "yandex", auth_method: "oauth2" })).toBe(true);
    expect(isYandexTelemostAccount({ oauth_provider: "google", auth_method: "oauth2" })).toBe(false);
    expect(isYandexTelemostAccount({ oauth_provider: "yandex", auth_method: "password" })).toBe(false);
  });
});
