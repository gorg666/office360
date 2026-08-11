/**
 * Capability map for mail thread context menu.
 * English labels are translated by TranslationLayer via i18n.
 */

export type ThreadContextMenuView = {
  isTrashView: boolean;
  isDraftsView: boolean;
  isSpamView: boolean;
  isMulti: boolean;
};

export type ThreadContextMenuActionId =
  | "open"
  | "reply"
  | "reply-all"
  | "forward"
  | "toggle-read"
  | "toggle-star"
  | "snooze"
  | "move-to-folder"
  | "archive"
  | "spam"
  | "delete";

export function isThreadContextActionEnabled(
  id: ThreadContextMenuActionId,
  view: ThreadContextMenuView,
): boolean {
  switch (id) {
    case "open":
      return !view.isMulti;
    case "reply":
    case "reply-all":
    case "forward":
      return !view.isMulti && !view.isDraftsView;
    case "snooze":
      return !view.isDraftsView;
    case "archive":
      return !view.isDraftsView && !view.isTrashView;
    case "spam":
      return !view.isDraftsView;
    case "toggle-read":
    case "toggle-star":
    case "move-to-folder":
    case "delete":
      return true;
    default:
      return false;
  }
}

export const THREAD_CONTEXT_MENU_CORE_LABELS = [
  "Open",
  "Reply",
  "Reply All",
  "Forward",
  "Mark as Read",
  "Mark as Unread",
  "Star",
  "Unstar",
  "Snooze...",
  "Move to Folder",
  "Archive",
  "Report Spam",
  "Delete",
] as const;
