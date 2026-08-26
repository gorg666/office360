import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
  registerActionTypes,
  onAction,
} from "@tauri-apps/plugin-notification";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import { getSetting } from "../db/settings";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useComposerStore } from "../../stores/composerStore";
import { navigateToLabel } from "../../router/navigate";
import { normalizeEmail } from "@/utils/emailUtils";
import { APP_NAME_RU, getInitialLocale, translateText } from "@/i18n";
import { pluralRu } from "@/utils/pluralRu";

let initialized = false;
let notificationsEnabled = true;
let lastSoundAt = 0;
let notificationSoundVolume = 0.8;
let notificationSoundPath = "";
let isWindowsHost: boolean | null = null;
export type NotificationPermissionStatus = "unknown" | "granted" | "denied" | "disabled";
export type CalendarNotificationResult = {
  status: "delivered" | "permission-denied" | "disabled" | "failed";
  permission: NotificationPermissionStatus;
};
let notificationPermissionStatus: NotificationPermissionStatus = "unknown";

interface NotificationContext {
  threadId?: string;
  accountId?: string;
  fromAddress?: string;
  subject?: string;
}

let lastNotificationContext: NotificationContext | null = null;
const recentContexts = new Map<string, NotificationContext>();

export function configureNotificationSound(options: {
  volume?: string | number | null;
  path?: string | null;
}): void {
  if (options.volume !== undefined) {
    const parsedVolume = Number(options.volume ?? "80");
    notificationSoundVolume = Math.min(1, Math.max(0, Number.isFinite(parsedVolume) ? parsedVolume / 100 : 0.8));
  }

  if (options.path !== undefined) {
    notificationSoundPath = options.path ?? "";
  }
}

export async function loadNotificationSoundSettings(): Promise<void> {
  const [volumeSetting, customSoundPath] = await Promise.all([
    getSetting("notification_sound_volume"),
    getSetting("notification_sound_path"),
  ]);
  configureNotificationSound({
    volume: volumeSetting ?? "80",
    path: customSoundPath ?? "",
  });
}

function playNewEmailSound(): void {
  if (typeof window === "undefined") return;

  const now = Date.now();
  if (now - lastSoundAt < 1_500) return;
  lastSoundAt = now;

  playConfiguredNewEmailSound();
}

export function playConfiguredNewEmailSound(): void {
  void invoke("play_notification_sound", {
    path: notificationSoundPath.trim() || null,
    volume: notificationSoundVolume,
  }).catch((err) => {
    console.warn("Failed to play native notification sound:", err);
  });
}

async function showAndFocusMainWindow(): Promise<void> {
  const mainWindow = await WebviewWindow.getByLabel("main");
  if (mainWindow) {
    await mainWindow.show();
    await mainWindow.setFocus();
  }
}

async function isMainWindowForeground(): Promise<boolean> {
  try {
    const mainWindow = await WebviewWindow.getByLabel("main");
    if (!mainWindow) return false;
    const focused = await mainWindow.isFocused();
    const visible =
      typeof document === "undefined" ? true : document.visibilityState === "visible";
    return focused && visible;
  } catch {
    return false;
  }
}

async function detectWindowsHost(): Promise<boolean> {
  if (isWindowsHost != null) return isWindowsHost;
  try {
    isWindowsHost = (await platform()) === "windows";
  } catch {
    isWindowsHost = false;
  }
  return isWindowsHost;
}

/**
 * Show OS toast as Office360 (Windows: native WinRT + AUMID registry).
 * Avoids tauri-plugin-notification PowerShell attribution under target/debug|release.
 */
async function showOsNotification(title: string, body: string, actionTypeId: string): Promise<void> {
  const onWindows = await detectWindowsHost();
  if (onWindows) {
    try {
      await invoke("show_native_notification", { title, body });
      return;
    } catch (err) {
      console.warn("Native Office360 notification failed, falling back to plugin:", err);
    }
  }

  sendNotification({
    title,
    body,
    actionTypeId,
  });
}

/**
 * Initialize notification permissions and action types.
 */
export async function initNotifications(): Promise<NotificationPermissionStatus> {
  if (initialized) return notificationPermissionStatus;
  initialized = true;

  const setting = await getSetting("notifications_enabled");
  notificationsEnabled = setting !== "false";
  await loadNotificationSoundSettings();

  if (!notificationsEnabled) {
    notificationPermissionStatus = "disabled";
    return notificationPermissionStatus;
  }

  if (await detectWindowsHost()) {
    try {
      await invoke("ensure_notification_app_identity");
    } catch (err) {
      console.warn("Failed to ensure Windows notification identity:", err);
    }
  }

  let granted = false;
  try {
    granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === "granted";
    }
  } catch (error) {
    notificationPermissionStatus = "unknown";
    console.warn("Unable to determine notification permission:", error);
    return notificationPermissionStatus;
  }

  if (!granted) {
    notificationsEnabled = false;
    notificationPermissionStatus = "denied";
    return notificationPermissionStatus;
  }
  notificationPermissionStatus = "granted";

  try {
    await registerActionTypes([
      {
        id: "default",
        actions: [],
      },
      {
        id: "email",
        actions: [
          { id: "reply", title: translateText("Reply", getInitialLocale()) },
          { id: "archive", title: translateText("Archive", getInitialLocale()) },
        ],
      },
      {
        // Snooze/dismiss are provided by the in-app reminder center because
        // native action support is not consistent across desktop platforms.
        id: "calendar-reminder",
        actions: [],
      },
    ]);

    await onAction(async (event) => {
      const actionId = event.actionTypeId;
      const ctx = lastNotificationContext;

      if (actionId === "calendar-reminder") {
        await showAndFocusMainWindow();
        navigateToLabel("calendar");
      } else if (actionId === "reply" && ctx?.threadId && ctx?.accountId) {
        await showAndFocusMainWindow();
        useComposerStore.getState().openComposer({
          mode: "reply",
          to: ctx.fromAddress ? [ctx.fromAddress] : [],
          subject: ctx.subject ? `Re: ${ctx.subject}` : "",
          threadId: ctx.threadId,
        });
      } else if (actionId === "archive" && ctx?.threadId && ctx?.accountId) {
        try {
          const { archiveThread } = await import("../emailActions");
          await archiveThread(ctx.accountId, ctx.threadId, []);
        } catch (err) {
          console.error("Failed to archive from notification:", err);
        }
      } else {
        await showAndFocusMainWindow();
        if (ctx?.threadId) {
          navigateToLabel("inbox", { threadId: ctx.threadId });
        }
      }
    });
  } catch {
    // registerActionTypes/onAction not available on this platform (e.g. Windows)
  }
  return notificationPermissionStatus;
}

export function getNotificationPermissionStatus(): NotificationPermissionStatus {
  return notificationPermissionStatus;
}

/** Calendar delivery entrypoint. Payload is already privacy-filtered by its domain service. */
export async function showCalendarReminderNotification(input: {
  title: string;
  body: string;
}): Promise<CalendarNotificationResult> {
  if (!initialized) await initNotifications();
  if (notificationPermissionStatus === "denied") {
    return { status: "permission-denied", permission: notificationPermissionStatus };
  }
  if (notificationPermissionStatus === "disabled") {
    return { status: "disabled", permission: notificationPermissionStatus };
  }
  if (notificationPermissionStatus !== "granted") {
    return { status: "failed", permission: notificationPermissionStatus };
  }
  try {
    await showOsNotification(input.title, input.body, "calendar-reminder");
    return { status: "delivered", permission: notificationPermissionStatus };
  } catch (error) {
    console.warn("Calendar reminder notification failed:", error);
    return { status: "failed", permission: notificationPermissionStatus };
  }
}

let pendingCount = 0;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

export function queueNewEmailNotification(
  from: string,
  subject: string,
  threadId?: string,
  accountId?: string,
  fromAddress?: string,
): void {
  if (!notificationsEnabled) return;

  pendingCount++;

  const ctx = { threadId, accountId, fromAddress, subject };
  lastNotificationContext = ctx;
  if (threadId) recentContexts.set(threadId, ctx);

  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    const count = pendingCount;
    pendingCount = 0;
    notifyTimer = null;

    void (async () => {
      playNewEmailSound();

      // Foreground: sound only — avoid duplicate Windows toast.
      if (await isMainWindowForeground()) {
        return;
      }

      const locale = getInitialLocale();
      const noSubject = translateText("(No subject)", locale);
      if (count === 1) {
        await showOsNotification(
          translateText("New mail", locale),
          `${from}: ${subject || noSubject}`,
          "email",
        );
      } else if (count > 1) {
        const body =
          locale === "ru"
            ? `${count} ${pluralRu(count, "новое письмо", "новых письма", "новых писем")}`
            : `${count} new emails`;
        await showOsNotification(APP_NAME_RU, body, "email");
      }
    })();
  }, 2000);
}

export function shouldNotifyForMessage(
  smartEnabled: boolean,
  allowedCategories: Set<string>,
  vipSenders: Set<string>,
  threadCategory: string | null,
  fromAddress?: string,
): boolean {
  if (!smartEnabled) return true;
  if (fromAddress && vipSenders.has(normalizeEmail(fromAddress))) return true;
  const category = threadCategory ?? "Primary";
  return allowedCategories.has(category);
}

export function notifyFollowUpDue(
  subject: string,
  threadId?: string,
  accountId?: string,
): void {
  if (!notificationsEnabled) return;
  const ctx = { threadId, accountId, subject };
  lastNotificationContext = ctx;
  if (threadId) recentContexts.set(threadId, ctx);
  void (async () => {
    if (await isMainWindowForeground()) return;
    const locale = getInitialLocale();
    await showOsNotification(
      translateText("Follow up needed", locale),
      subject || translateText("(No subject)", locale),
      "email",
    );
  })();
}

export function notifySnoozeReturn(subject: string): void {
  if (!notificationsEnabled) return;
  void (async () => {
    if (await isMainWindowForeground()) return;
    const locale = getInitialLocale();
    await showOsNotification(
      translateText("Snoozed email returned", locale),
      subject || translateText("(No subject)", locale),
      "default",
    );
  })();
}
