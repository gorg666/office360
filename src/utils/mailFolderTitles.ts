/**
 * Canonical English display titles for system mail folders.
 * TranslationLayer maps these to proper Russian (capitalized) via i18n.
 * Never render raw route ids (`inbox`) as titles — that yields lowercase RU.
 */
export const SYSTEM_FOLDER_TITLE: Record<string, string> = {
  inbox: "Inbox",
  starred: "Starred",
  snoozed: "Snoozed",
  outbox: "Outbox",
  sent: "Sent",
  drafts: "Drafts",
  trash: "Trash",
  spam: "Spam",
  all: "All Mail",
};

export function getSystemFolderTitle(labelId: string): string | null {
  return SYSTEM_FOLDER_TITLE[labelId] ?? null;
}
