import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopPlatform } from "@/utils/desktopPlatform";
import { useAccountStore } from "@/stores/accountStore";

const mocks = vi.hoisted(() => ({
  platform: "macos" as DesktopPlatform,
  invoke: vi.fn(),
  deleteAccount: vi.fn(),
  removeClient: vi.fn(),
  clearYandexServiceAuth: vi.fn(),
  getSetting: vi.fn(),
  getSecureSetting: vi.fn(),
  setSetting: vi.fn(),
  getAliasesForAccount: vi.fn(),
  getAccount: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ tab: "accounts" }),
}));
vi.mock("@/router/navigate", () => ({
  navigateBackFromSettings: vi.fn(),
  navigateToRepairCenter: vi.fn(),
  navigateToSettings: vi.fn(),
}));
vi.mock("@/utils/desktopPlatform", () => ({
  getDesktopPlatform: vi.fn(async () => mocks.platform),
  resetDesktopPlatformCacheForTests: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/services/db/settings", () => ({
  getSetting: mocks.getSetting,
  getSecureSetting: mocks.getSecureSetting,
  setSetting: mocks.setSetting,
}));
vi.mock("@/services/db/accounts", () => ({
  deleteAccount: mocks.deleteAccount,
  getAccount: mocks.getAccount,
}));
vi.mock("@/services/gmail/tokenManager", () => ({
  removeClient: mocks.removeClient,
  reauthorizeAccount: vi.fn(),
}));
vi.mock("@/services/gmail/syncManager", () => ({
  triggerSync: vi.fn(),
  forceFullSync: vi.fn(),
  resyncAccount: vi.fn(),
}));
vi.mock("@/services/db/sendAsAliases", () => ({
  getAliasesForAccount: mocks.getAliasesForAccount,
  setDefaultAlias: vi.fn(),
  mapDbAlias: vi.fn(),
}));
vi.mock("@/services/yandex/accountApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/yandex/accountApi")>();
  return {
    ...actual,
    clearYandexServiceAuth: mocks.clearYandexServiceAuth,
  };
});
vi.mock("@/services/notifications/notificationManager", () => ({
  configureNotificationSound: vi.fn(),
  playConfiguredNewEmailSound: vi.fn(),
}));
vi.mock("@/services/db/pendingOperations", () => ({
  getPendingOpsCount: vi.fn(async () => 0),
  getFailedOpsCount: vi.fn(async () => 0),
}));
vi.mock("@/services/globalShortcut", () => ({
  registerComposeShortcut: vi.fn(),
  getCurrentShortcut: vi.fn(async () => "CommandOrControl+N"),
  DEFAULT_SHORTCUT: "CommandOrControl+N",
}));

import { SettingsPage } from "./SettingsPage";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.platform = "macos";
  mocks.invoke.mockResolvedValue(undefined);
  mocks.deleteAccount.mockResolvedValue(undefined);
  mocks.removeClient.mockResolvedValue(undefined);
  mocks.clearYandexServiceAuth.mockResolvedValue(undefined);
  mocks.getSetting.mockResolvedValue(null);
  mocks.getSecureSetting.mockResolvedValue(null);
  mocks.setSetting.mockResolvedValue(undefined);
  mocks.getAliasesForAccount.mockResolvedValue([]);
  mocks.getAccount.mockImplementation(async (id: string) => ({
    id,
    email: `${id}@example.test`,
    oauth_provider: "yandex",
    auth_method: "oauth2",
  }));
  useAccountStore.setState({
    accounts: [
      { id: "account-a", email: "a@example.test", displayName: "Account A", avatarUrl: null, isActive: true, provider: "imap" },
      { id: "account-b", email: "b@example.test", displayName: "Account B", avatarUrl: null, isActive: false, provider: "imap" },
    ],
    activeAccountId: "account-a",
  });
});

describe("SettingsPage account removal", () => {
  it("awaits Telemost cleanup for a Yandex account with the removed id only", async () => {
    let finishCleanup: (value: unknown) => void = () => undefined;
    mocks.invoke.mockImplementation(() => new Promise((resolve) => {
      finishCleanup = resolve;
    }));
    render(<SettingsPage />);

    const removeButtons = await screen.findAllByRole("button", { name: "Удалить" });
    fireEvent.click(removeButtons[1]);
    await screen.findByText("Удалить аккаунт?");
    const confirmButtons = screen.getAllByRole("button", { name: "Удалить" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("reset_telemost_macos_profile", {
      accountKey: "account-b",
    }));
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
    finishCleanup(undefined);

    await waitFor(() => expect(mocks.deleteAccount).toHaveBeenCalledWith("account-b"));
    expect(mocks.removeClient).toHaveBeenCalledWith("account-b");
    expect(mocks.invoke).not.toHaveBeenCalledWith("reset_telemost_macos_profile", {
      accountKey: "account-a",
    });
    expect(useAccountStore.getState().accounts.map((account) => account.id)).toEqual(["account-a"]);
  });

  it("does not invoke Telemost profile reset on Windows", async () => {
    mocks.platform = "windows";
    render(<SettingsPage />);

    const removeButtons = await screen.findAllByRole("button", { name: "Удалить" });
    fireEvent.click(removeButtons[1]);
    await screen.findByText("Удалить аккаунт?");
    const confirmButtons = screen.getAllByRole("button", { name: "Удалить" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(mocks.deleteAccount).toHaveBeenCalledWith("account-b"));
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("does not invoke Telemost profile reset for a non-Yandex account on macOS", async () => {
    mocks.getAccount.mockResolvedValue({
      id: "account-b",
      email: "b@example.test",
      oauth_provider: "google",
      auth_method: "oauth2",
    });
    render(<SettingsPage />);

    const removeButtons = await screen.findAllByRole("button", { name: "Удалить" });
    fireEvent.click(removeButtons[1]);
    await screen.findByText("Удалить аккаунт?");
    const confirmButtons = screen.getAllByRole("button", { name: "Удалить" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(mocks.deleteAccount).toHaveBeenCalledWith("account-b"));
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("still removes the account if Telemost cleanup fails and records the failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.invoke.mockRejectedValue(Object.assign(new Error("WebKit store missing"), { name: "DataStoreInUse" }));
    render(<SettingsPage />);

    const removeButtons = await screen.findAllByRole("button", { name: "Удалить" });
    fireEvent.click(removeButtons[0]);
    await screen.findByText("Удалить аккаунт?");
    const confirmButtons = screen.getAllByRole("button", { name: "Удалить" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(mocks.deleteAccount).toHaveBeenCalledWith("account-a"));
    await waitFor(() => expect(useAccountStore.getState().accounts.map((account) => account.id)).toEqual(["account-b"]));
    expect(warn).toHaveBeenCalledWith("telemost profile cleanup failed", {
      accountId: "account-a",
      errorClass: "DataStoreInUse",
    });
    expect(screen.queryByText("WebKit store missing")).not.toBeInTheDocument();
    warn.mockRestore();
  });
});
