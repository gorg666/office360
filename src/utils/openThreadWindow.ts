import type { Thread } from "@/stores/threadStore";

/** Stable Tauri window label per thread (matches existing pop-out menus). */
export function getThreadWindowLabel(threadId: string): string {
  return `thread-${threadId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type OpenThreadWindowResult = "opened" | "focused" | "fallback";

export interface OpenThreadWindowOptions {
  threadId: string;
  accountId: string;
  title?: string | null;
  /** Called when Tauri is unavailable or window creation fails (e.g. browser dev). */
  onFallback?: () => void;
}

/**
 * Open a thread in a dedicated Tauri window, or focus an existing one.
 * Reuses `ThreadWindow` entry (`/?thread=…&account=…`).
 */
export async function openThreadInWindow(
  options: OpenThreadWindowOptions,
): Promise<OpenThreadWindowResult> {
  const { threadId, accountId, title, onFallback } = options;

  if (!isTauriRuntime()) {
    console.info(
      "[thread-window] Tauri runtime unavailable; opening thread in reading pane instead.",
    );
    onFallback?.();
    return "fallback";
  }

  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const windowLabel = getThreadWindowLabel(threadId);
    const url = `/?thread=${encodeURIComponent(threadId)}&account=${encodeURIComponent(accountId)}`;

    const existing = await WebviewWindow.getByLabel(windowLabel);
    if (existing) {
      await existing.setFocus();
      return "focused";
    }

    const win = new WebviewWindow(windowLabel, {
      url,
      title: title?.trim() || "Письмо",
      width: 800,
      height: 700,
      center: true,
      dragDropEnabled: false,
    });

    win.once("tauri://error", (e) => {
      console.error("[thread-window] Failed to create pop-out window:", e);
    });

    return "opened";
  } catch (err) {
    console.warn("[thread-window] Pop-out failed; using reading pane fallback:", err);
    onFallback?.();
    return "fallback";
  }
}

export function openThreadPopOut(thread: Thread, onFallback?: () => void): Promise<OpenThreadWindowResult> {
  return openThreadInWindow({
    threadId: thread.id,
    accountId: thread.accountId,
    title: thread.subject,
    onFallback,
  });
}
