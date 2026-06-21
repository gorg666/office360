export const FOLDER_EDITING_UNSUPPORTED_MESSAGE =
  "Folder editing is not supported for this account provider yet.";

/**
 * Folder editing currently uses the Gmail label API. IMAP-backed providers,
 * including Yandex and manual accounts, remain read/sync-only until their
 * backend folder commands are implemented.
 */
export function supportsFolderEditing(provider: string | null | undefined): boolean {
  const normalized = provider?.trim().toLowerCase();
  return normalized === "gmail_api" || normalized === "gmail" || normalized === "google";
}
