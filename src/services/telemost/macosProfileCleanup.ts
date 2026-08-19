import { invoke } from "@tauri-apps/api/core";
import { getAccount } from "@/services/db/accounts";
import { getDesktopPlatform } from "@/utils/desktopPlatform";

export type TelemostMacosCleanupSkipReason = "not-macos" | "not-yandex" | "invalid-account";

export type TelemostMacosCleanupResult =
  | { status: "ok" }
  | { status: "skipped"; reason: TelemostMacosCleanupSkipReason }
  | { status: "failed"; errorClass: string };

export function isYandexTelemostAccount(account: {
  oauth_provider?: string | null;
  auth_method?: string | null;
}): boolean {
  return account.oauth_provider === "yandex" && account.auth_method === "oauth2";
}

function errorClassOf(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  return "Error";
}

export async function resetTelemostMacosProfileForRemovedAccount(
  accountId: string,
): Promise<TelemostMacosCleanupResult> {
  const accountKey = accountId.trim();
  if (!accountKey) return { status: "skipped", reason: "invalid-account" };
  const { clearTelemostAccountScopedData } = await import("./multiAccountOwnership");
  clearTelemostAccountScopedData(accountKey);

  try {
    if ((await getDesktopPlatform()) !== "macos") {
      return { status: "skipped", reason: "not-macos" };
    }

    const account = await getAccount(accountKey);
    if (!account || !isYandexTelemostAccount(account)) {
      return { status: "skipped", reason: "not-yandex" };
    }

    await invoke("reset_telemost_macos_profile", { accountKey });
    return { status: "ok" };
  } catch (error) {
    const errorClass = errorClassOf(error);
    console.warn("telemost profile cleanup failed", { accountId: accountKey, errorClass });
    return { status: "failed", errorClass };
  }
}
