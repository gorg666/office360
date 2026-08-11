/**
 * @deprecated MAIL-020 — legacy black center toast removed.
 * Undo + send progress live in SendFeedbackToast (single global channel).
 * Kept as empty export so stale imports fail loudly in types if misused.
 */
export function UndoSendToast(): null {
  return null;
}
