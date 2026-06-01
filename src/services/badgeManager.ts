import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { getUnreadInboxCount } from "./db/threads";
import { APP_NAME_EN } from "@/i18n";

let lastCount = -1;

export async function updateBadgeCount(): Promise<void> {
  try {
    const count = await getUnreadInboxCount();
    if (count === lastCount) return;
    lastCount = count;

    try {
      await getCurrentWindow().setBadgeCount(count > 0 ? count : undefined);
    } catch {
      // badge count may not be supported on all platforms
    }

    const tooltip = count > 0 ? `${APP_NAME_EN} - ${count} unread` : APP_NAME_EN;
    try {
      await invoke("set_tray_tooltip", { tooltip });
    } catch {
      // tray tooltip update is best-effort
    }
  } catch (err) {
    console.error("Failed to update badge count:", err);
  }
}
