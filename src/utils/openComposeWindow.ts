import type { ComposerMode } from "@/stores/composerStore";
import { useComposerStore } from "@/stores/composerStore";
import { isTauriRuntime } from "./openThreadWindow";

export type OpenComposeWindowResult = "opened" | "focused" | "fallback";

export interface OpenComposeWindowOptions {
  mode?: ComposerMode;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  bodyHtml?: string;
  threadId?: string | null;
  inReplyToMessageId?: string | null;
  draftId?: string | null;
  fromEmail?: string | null;
  title?: string | null;
  /** Called when Tauri is unavailable or window creation fails (e.g. browser dev). */
  onFallback?: () => void;
}

/** Stable label for empty new compose; draft/reply/prefilled use unique labels. */
export function getComposeWindowLabel(options: OpenComposeWindowOptions): string {
  if (options.draftId) {
    return `compose-draft-${options.draftId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  }

  const mode = options.mode ?? "new";
  const hasPrefill =
    (options.to?.length ?? 0) > 0 ||
    (options.cc?.length ?? 0) > 0 ||
    (options.bcc?.length ?? 0) > 0 ||
    Boolean(options.subject?.trim()) ||
    Boolean(options.bodyHtml?.trim()) ||
    Boolean(options.threadId) ||
    Boolean(options.inReplyToMessageId);

  if (mode === "new" && !hasPrefill) {
    return "compose-new";
  }

  return `compose-${Date.now()}`;
}

export function buildComposeWindowUrl(options: OpenComposeWindowOptions): string {
  const params = new URLSearchParams();
  params.set("compose", "true");
  params.set("mode", options.mode ?? "new");

  if (options.to && options.to.length > 0) params.set("to", options.to.join(","));
  if (options.cc && options.cc.length > 0) params.set("cc", options.cc.join(","));
  if (options.bcc && options.bcc.length > 0) params.set("bcc", options.bcc.join(","));
  if (options.subject) params.set("subject", options.subject);
  if (options.threadId) params.set("threadId", options.threadId);
  if (options.inReplyToMessageId) params.set("inReplyToMessageId", options.inReplyToMessageId);
  if (options.draftId) params.set("draftId", options.draftId);
  if (options.fromEmail) params.set("fromEmail", options.fromEmail);

  if (options.bodyHtml) {
    params.set("body", btoa(unescape(encodeURIComponent(options.bodyHtml))));
  }

  return `index.html?${params.toString()}`;
}

export function getComposeWindowTitle(options: OpenComposeWindowOptions): string {
  if (options.title?.trim()) return options.title.trim();
  if (options.subject?.trim()) return options.subject.trim();
  const mode = options.mode ?? "new";
  if (mode === "reply") return "Ответ";
  if (mode === "replyAll") return "Ответить всем";
  if (mode === "forward") return "Переслать";
  return "Новое сообщение";
}

/**
 * Open composer in a dedicated Tauri window, or focus an existing one.
 * Reuses `ComposerWindow` entry (`index.html?compose=true&…`).
 */
export async function openComposeWindow(
  options: OpenComposeWindowOptions,
): Promise<OpenComposeWindowResult> {
  const { onFallback } = options;

  if (!isTauriRuntime()) {
    console.info(
      "[compose-window] Tauri runtime unavailable; opening composer in main window instead.",
    );
    onFallback?.();
    return "fallback";
  }

  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const windowLabel = getComposeWindowLabel(options);
    const url = buildComposeWindowUrl(options);

    const existing = await WebviewWindow.getByLabel(windowLabel);
    if (existing) {
      await existing.setFocus();
      return "focused";
    }

    const win = new WebviewWindow(windowLabel, {
      url,
      title: getComposeWindowTitle(options),
      width: 700,
      height: 650,
      center: true,
      dragDropEnabled: false,
    });

    win.once("tauri://error", (e) => {
      console.error("[compose-window] Failed to create pop-out window:", e);
    });

    return "opened";
  } catch (err) {
    console.warn("[compose-window] Pop-out failed; using main-window fallback:", err);
    onFallback?.();
    return "fallback";
  }
}

type NewComposeOptions = Omit<OpenComposeWindowOptions, "mode"> & {
  mode?: "new";
};

function composerOptsFromWindowOptions(options: NewComposeOptions) {
  return {
    mode: "new" as const,
    to: options.to,
    cc: options.cc,
    bcc: options.bcc,
    subject: options.subject,
    bodyHtml: options.bodyHtml,
    threadId: options.threadId,
    inReplyToMessageId: options.inReplyToMessageId,
    draftId: options.draftId,
  };
}

/**
 * Default path for creating a new message: separate Tauri window when available,
 * otherwise floating composer in the main app.
 */
export async function openNewCompose(
  options: NewComposeOptions = {},
): Promise<OpenComposeWindowResult> {
  return openComposeWindow({
    ...options,
    mode: "new",
    onFallback: () => {
      useComposerStore.getState().openComposer(composerOptsFromWindowOptions(options));
      options.onFallback?.();
    },
  });
}
