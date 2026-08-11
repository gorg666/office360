import { router } from "./index";
import { useUIStore } from "@/stores/uiStore";

/** Known system labels that map to /mail/$label */
const SYSTEM_LABELS = new Set([
  "inbox", "starred", "snoozed", "outbox", "sent", "drafts", "trash", "spam", "all",
]);

type SettingsReturnSnapshot = {
  pathname: string;
  search: Record<string, unknown>;
  messengersPanelsOpen: boolean;
};

let settingsReturnSnapshot: SettingsReturnSnapshot | null = null;
let settingsSurfaceReturnStack: SettingsReturnSnapshot[] = [];

function isSettingsPath(pathname: string): boolean {
  return /^\/settings(\/|$)/.test(pathname);
}

function isRepairPath(pathname: string): boolean {
  return /^\/repair(\/|$)/.test(pathname);
}

function isQueuePath(pathname: string): boolean {
  return /^\/queue(\/|$)/.test(pathname);
}

function isSettingsSurfacePath(pathname: string): boolean {
  return isSettingsPath(pathname) || isRepairPath(pathname) || isQueuePath(pathname);
}

function captureCurrentLocation(): SettingsReturnSnapshot {
  const { pathname, search } = router.state.location;
  return {
    pathname,
    search: { ...(search as Record<string, unknown>) },
    messengersPanelsOpen: useUIStore.getState().messengersPanelsOpen,
  };
}

function isSameSnapshotTarget(a: SettingsReturnSnapshot, b: SettingsReturnSnapshot): boolean {
  return a.pathname === b.pathname && JSON.stringify(a.search) === JSON.stringify(b.search);
}

function isSettingsReturnSnapshot(snapshot: SettingsReturnSnapshot | null | undefined): snapshot is SettingsReturnSnapshot {
  return Boolean(
    snapshot
      && typeof snapshot.pathname === "string"
      && snapshot.search
      && typeof snapshot.search === "object"
      && typeof snapshot.messengersPanelsOpen === "boolean",
  );
}

function captureSettingsReturnLocation(): void {
  const { pathname } = router.state.location;
  if (isSettingsSurfacePath(pathname)) return;

  settingsReturnSnapshot = captureCurrentLocation();
  settingsSurfaceReturnStack = [];
}

function rememberSettingsSurfaceReturnLocation(): void {
  const { pathname } = router.state.location;
  if (!isSettingsSurfacePath(pathname)) {
    captureSettingsReturnLocation();
    return;
  }

  const snapshot = captureCurrentLocation();
  const previous = settingsSurfaceReturnStack[settingsSurfaceReturnStack.length - 1];
  if (!previous || !isSameSnapshotTarget(previous, snapshot)) {
    settingsSurfaceReturnStack.push(snapshot);
  }
}

function navigateToInboxFallback(): void {
  useUIStore.getState().setMessengersPanelsOpen(false);
  router.navigate({ to: "/mail/$label", params: { label: "inbox" } });
}

function navigateToSnapshot(snapshot: SettingsReturnSnapshot | null | undefined): void {
  if (!isSettingsReturnSnapshot(snapshot)) {
    navigateToInboxFallback();
    return;
  }

  useUIStore.getState().setMessengersPanelsOpen(snapshot.messengersPanelsOpen);

  const { pathname } = snapshot;
  const search = snapshot.search as Record<string, string>;

  const settingsMatch = pathname.match(/^\/settings(?:\/([^/]+))?$/);
  if (settingsMatch) {
    router.navigate({
      to: "/settings/$tab",
      params: { tab: settingsMatch[1] ?? "general" },
      search,
    });
    return;
  }

  const mailThreadMatch = pathname.match(/^\/mail\/([^/]+)\/thread\/([^/]+)$/);
  if (mailThreadMatch) {
    router.navigate({
      to: "/mail/$label/thread/$threadId",
      params: { label: mailThreadMatch[1]!, threadId: mailThreadMatch[2]! },
      search,
    });
    return;
  }

  const mailMatch = pathname.match(/^\/mail\/([^/]+)$/);
  if (mailMatch) {
    router.navigate({
      to: "/mail/$label",
      params: { label: mailMatch[1]! },
      search,
    });
    return;
  }

  const labelThreadMatch = pathname.match(/^\/label\/([^/]+)\/thread\/([^/]+)$/);
  if (labelThreadMatch) {
    router.navigate({
      to: "/label/$labelId/thread/$threadId",
      params: { labelId: labelThreadMatch[1]!, threadId: labelThreadMatch[2]! },
      search,
    });
    return;
  }

  const labelMatch = pathname.match(/^\/label\/([^/]+)$/);
  if (labelMatch) {
    router.navigate({
      to: "/label/$labelId",
      params: { labelId: labelMatch[1]! },
      search,
    });
    return;
  }

  const smartFolderThreadMatch = pathname.match(/^\/smart-folder\/([^/]+)\/thread\/([^/]+)$/);
  if (smartFolderThreadMatch) {
    router.navigate({
      to: "/smart-folder/$folderId/thread/$threadId",
      params: { folderId: smartFolderThreadMatch[1]!, threadId: smartFolderThreadMatch[2]! },
      search,
    });
    return;
  }

  const smartFolderMatch = pathname.match(/^\/smart-folder\/([^/]+)$/);
  if (smartFolderMatch) {
    router.navigate({
      to: "/smart-folder/$folderId",
      params: { folderId: smartFolderMatch[1]! },
      search,
    });
    return;
  }

  if (pathname === "/attachments") {
    router.navigate({ to: "/attachments" });
    return;
  }

  if (pathname === "/calendar") {
    router.navigate({ to: "/calendar" });
    return;
  }

  if (pathname === "/tasks") {
    router.navigate({ to: "/tasks" });
    return;
  }

  if (pathname === "/contacts") {
    router.navigate({ to: "/contacts" });
    return;
  }

  if (pathname === "/repair") {
    router.navigate({ to: "/repair", search });
    return;
  }

  const repairMatch = pathname.match(/^\/repair\/([^/]+)$/);
  if (repairMatch) {
    router.navigate({
      to: "/repair/$accountId",
      params: { accountId: repairMatch[1]! },
      search,
    });
    return;
  }

  if (pathname === "/queue") {
    router.navigate({ to: "/queue", search });
    return;
  }

  const helpMatch = pathname.match(/^\/help(?:\/([^/]+))?$/);
  if (helpMatch) {
    router.navigate({
      to: "/help/$topic",
      params: { topic: helpMatch[1] ?? "getting-started" },
      search,
    });
    return;
  }

  navigateToInboxFallback();
}

/**
 * Navigate to a label/view. Handles routing for system labels, custom labels,
 * smart folders, and special views (settings, calendar).
 */
export function navigateToLabel(
  label: string,
  opts?: { category?: string; threadId?: string },
): void {
  if (label === "settings") {
    navigateToSettings("general");
    return;
  }

  if (label === "tasks") {
    router.navigate({ to: "/tasks" });
    return;
  }

  if (label === "attachments") {
    router.navigate({ to: "/attachments" });
    return;
  }

  if (label === "calendar") {
    router.navigate({ to: "/calendar" });
    return;
  }

  if (label === "disk" || label === "telemost" || label === "tracker") {
    router.navigate({ to: `/${label}` as "/disk" | "/telemost" | "/tracker" });
    return;
  }

  if (label === "contacts") {
    router.navigate({ to: "/contacts" });
    return;
  }

  if (label === "messengers") {
    useUIStore.getState().setMessengersPanelsOpen(true);
    const pathname = router.state.location.pathname;
    const onMailShell = /^\/mail\/|^\/label\/|^\/smart-folder\//.test(pathname);
    if (!onMailShell) {
      router.navigate({ to: "/mail/$label", params: { label: "inbox" } });
    }
    return;
  }

  if (label === "help") {
    router.navigate({ to: "/help/$topic", params: { topic: "getting-started" } });
    return;
  }

  if (label === "repair") {
    navigateToRepairCenter();
    return;
  }

  if (label === "queue") {
    navigateToQueueInspector();
    return;
  }

  if (label.startsWith("smart-folder:")) {
    const folderId = label.replace("smart-folder:", "");
    if (opts?.threadId) {
      router.navigate({
        to: "/smart-folder/$folderId/thread/$threadId",
        params: { folderId, threadId: opts.threadId },
      });
    } else {
      router.navigate({
        to: "/smart-folder/$folderId",
        params: { folderId },
      });
    }
    return;
  }

  if (SYSTEM_LABELS.has(label)) {
    const search: Record<string, string> = {};
    if (opts?.category) search["category"] = opts.category;
    if (opts?.threadId) {
      router.navigate({
        to: "/mail/$label/thread/$threadId",
        params: { label, threadId: opts.threadId },
        search,
      });
    } else {
      router.navigate({
        to: "/mail/$label",
        params: { label },
        search,
      });
    }
    return;
  }

  // Custom user label
  if (opts?.threadId) {
    router.navigate({
      to: "/label/$labelId/thread/$threadId",
      params: { labelId: label, threadId: opts.threadId },
    });
  } else {
    router.navigate({
      to: "/label/$labelId",
      params: { labelId: label },
    });
  }
}

/**
 * Navigate to a thread within the current mail context.
 * Appends /thread/$threadId to the current route.
 */
export function navigateToThread(threadId: string): void {
  const { location } = router.state;
  const pathname = location.pathname;

  // Already on a mail/$label route
  const mailMatch = pathname.match(/^\/mail\/([^/]+)/);
  if (mailMatch) {
    router.navigate({
      to: "/mail/$label/thread/$threadId",
      params: { label: mailMatch[1]!, threadId },
      search: location.search as Record<string, string>,
    });
    return;
  }

  // On a custom label route
  const labelMatch = pathname.match(/^\/label\/([^/]+)/);
  if (labelMatch) {
    router.navigate({
      to: "/label/$labelId/thread/$threadId",
      params: { labelId: labelMatch[1]!, threadId },
      search: location.search as Record<string, string>,
    });
    return;
  }

  // On a smart folder route
  const sfMatch = pathname.match(/^\/smart-folder\/([^/]+)/);
  if (sfMatch) {
    router.navigate({
      to: "/smart-folder/$folderId/thread/$threadId",
      params: { folderId: sfMatch[1]!, threadId },
      search: location.search as Record<string, string>,
    });
    return;
  }

  // Fallback: navigate to inbox with thread
  router.navigate({
    to: "/mail/$label/thread/$threadId",
    params: { label: "inbox", threadId },
  });
}

/**
 * Navigate to settings with an optional tab.
 */
export function navigateToSettings(tab = "general"): void {
  const { pathname } = router.state.location;
  if (!isSettingsPath(pathname)) {
    rememberSettingsSurfaceReturnLocation();
  }
  router.navigate({ to: "/settings/$tab", params: { tab } });
}

/**
 * Leave settings and return to the route the user came from (or inbox fallback).
 */
export function navigateBackFromSettings(): void {
  const surfaceSnapshot = settingsSurfaceReturnStack.pop();
  if (surfaceSnapshot) {
    navigateToSnapshot(surfaceSnapshot);
    return;
  }

  const returnSnapshot = settingsReturnSnapshot;
  settingsReturnSnapshot = null;
  if (!returnSnapshot) {
    navigateToInboxFallback();
    return;
  }

  navigateToSnapshot(returnSnapshot);
}

export function navigateToRepairCenter(accountId?: string): void {
  const { pathname } = router.state.location;
  const targetPathname = accountId ? `/repair/${accountId}` : "/repair";
  if (pathname !== targetPathname) {
    rememberSettingsSurfaceReturnLocation();
  }

  if (accountId) {
    router.navigate({ to: "/repair/$accountId", params: { accountId } });
  } else {
    router.navigate({ to: "/repair" });
  }
}

export function navigateBackFromRepair(): void {
  navigateBackFromSettings();
}

export function navigateBackFromQueueInspector(): void {
  if (settingsSurfaceReturnStack.length > 0 || settingsReturnSnapshot) {
    navigateBackFromSettings();
    return;
  }

  if (window.history.length > 1) {
    try {
      window.history.back();
    } catch {
      navigateToInboxFallback();
    }
    return;
  }

  navigateToInboxFallback();
}

export function navigateToQueueInspector(): void {
  const { pathname } = router.state.location;
  if (!isQueuePath(pathname)) {
    rememberSettingsSurfaceReturnLocation();
  }
  router.navigate({ to: "/queue" });
}

/**
 * Navigate to help with an optional topic.
 */
export function navigateToHelp(topic = "getting-started"): void {
  router.navigate({ to: "/help/$topic", params: { topic } });
}

/**
 * Navigate back (deselect thread → go to parent list route).
 */
export function navigateBack(): void {
  const { location } = router.state;
  const pathname = location.pathname;

  // If on a thread sub-route, go to parent
  const mailThreadMatch = pathname.match(/^\/mail\/([^/]+)\/thread\//);
  if (mailThreadMatch) {
    router.navigate({
      to: "/mail/$label",
      params: { label: mailThreadMatch[1]! },
      search: location.search as Record<string, string>,
    });
    return;
  }

  const labelThreadMatch = pathname.match(/^\/label\/([^/]+)\/thread\//);
  if (labelThreadMatch) {
    router.navigate({
      to: "/label/$labelId",
      params: { labelId: labelThreadMatch[1]! },
      search: location.search as Record<string, string>,
    });
    return;
  }

  const sfThreadMatch = pathname.match(/^\/smart-folder\/([^/]+)\/thread\//);
  if (sfThreadMatch) {
    router.navigate({
      to: "/smart-folder/$folderId",
      params: { folderId: sfThreadMatch[1]! },
      search: location.search as Record<string, string>,
    });
    return;
  }

  // Not on a thread route — navigate to inbox
  router.navigate({ to: "/mail/$label", params: { label: "inbox" } });
}

/**
 * Get the active label from the current router state (non-React helper).
 */
export function getActiveLabel(): string {
  const matches = router.state.matches;
  for (const match of matches) {
    if (match.routeId === "/mail/$label" || match.routeId === "/mail/$label/thread/$threadId") {
      return (match.params as { label: string }).label;
    }
    if (match.routeId === "/label/$labelId" || match.routeId === "/label/$labelId/thread/$threadId") {
      return (match.params as { labelId: string }).labelId;
    }
    if (match.routeId === "/smart-folder/$folderId" || match.routeId === "/smart-folder/$folderId/thread/$threadId") {
      return `smart-folder:${(match.params as { folderId: string }).folderId}`;
    }
    if (match.routeId === "/settings/$tab" || match.routeId === "/settings") {
      return "settings";
    }
    if (match.routeId === "/attachments") {
      return "attachments";
    }
    if (match.routeId === "/tasks") {
      return "tasks";
    }
    if (match.routeId === "/calendar") {
      return "calendar";
    }
    if (match.routeId === "/contacts") {
      return "contacts";
    }
    if (match.routeId === "/repair" || match.routeId === "/repair/$accountId") {
      return "repair";
    }
    if (match.routeId === "/help/$topic" || match.routeId === "/help") {
      return "help";
    }
  }
  return "inbox";
}

/**
 * Get the selected thread ID from the current router state (non-React helper).
 */
export function getSelectedThreadId(): string | null {
  const matches = router.state.matches;
  for (const match of matches) {
    const params = match.params as Record<string, string>;
    if (params["threadId"]) {
      return params["threadId"];
    }
  }
  return null;
}
