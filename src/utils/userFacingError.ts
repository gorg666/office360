import { translateText, getInitialLocale } from "@/i18n";
import { classifyError, formatEmailSendOrDraftError, formatSyncError } from "@/utils/networkErrors";

/**
 * Map technical / protocol errors to user-visible Russian copy.
 * Keeps raw detail in logs only (caller responsibility).
 */
export function toUserFacingError(error: unknown, fallbackKey = "Something went wrong"): string {
  const locale = getInitialLocale();
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error ?? "");

  const lower = raw.toLowerCase();
  const classified = classifyError(raw);

  // SMTP / send failures before generic HTTP 5xx (e.g. "SMTP error 535").
  if (
    lower.includes("send") ||
    lower.includes("smtp") ||
    lower.includes("draft") ||
    lower.includes("recipient")
  ) {
    return formatEmailSendOrDraftError(raw);
  }

  if (classified.type === "network") {
    return translateText("Network error", locale);
  }
  if (classified.type === "auth") {
    return translateText("Session expired", locale);
  }
  if (classified.type === "quota") {
    return translateText("Too many requests. Try again later.", locale);
  }
  if (classified.type === "server") {
    return translateText("Server error. Try again later.", locale);
  }

  const syncFriendly = formatSyncError(raw);
  // If formatSyncError still echoes English technical text, replace with generic.
  if (/[A-Za-z]{4,}/.test(syncFriendly) && !/[А-Яа-яЁё]/.test(syncFriendly)) {
    const translated = translateText(syncFriendly, locale);
    if (translated !== syncFriendly) return translated;
    return translateText(fallbackKey, locale);
  }

  return translateText(syncFriendly, locale) !== syncFriendly
    ? translateText(syncFriendly, locale)
    : translateText(fallbackKey, locale);
}
