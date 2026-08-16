import { Window, getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { MAIL_UNREAD_CHANGED_EVENT } from "@/components/layout/useServiceNavBadges";
import { getUnreadInboxCount } from "./db/threads";
import { APP_NAME_EN } from "@/i18n";

let lastCount = -1;

/** Dock/taskbar badge payload: hide the mark when unread is zero. */
export function dockBadgeCount(unread: number): number | undefined {
  return unread > 0 ? unread : undefined;
}

export function resetBadgeCountCache(): void {
  lastCount = -1;
}

export async function updateBadgeCount(): Promise<void> {
  try {
    const count = await getUnreadInboxCount();
    if (count === lastCount) return;
    lastCount = count;

    try {
      window.dispatchEvent(new CustomEvent(MAIL_UNREAD_CHANGED_EVENT, { detail: { count } }));
    } catch {
      // DOM event fan-out is best-effort for Sidebar badges
    }

    const badge = dockBadgeCount(count);
    try {
      await invoke("set_dock_badge_count", { count: badge ?? null });
    } catch {
      try {
        const main = await Window.getByLabel("main");
        await (main ?? getCurrentWindow()).setBadgeCount(badge);
      } catch {
        // badge count may not be supported on all platforms
      }
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
