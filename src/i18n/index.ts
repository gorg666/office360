import { useCallback } from "react";
import { useUIStore, type AppLocale } from "@/stores/uiStore";
import { enMessages, type I18nKey } from "./locales/en";
import { ruMessages } from "./locales/ru";

export type { I18nKey } from "./locales/en";

const dictionaries: Record<AppLocale, Record<I18nKey, string>> = {
  en: enMessages,
  ru: ruMessages,
};

export const NAV_LABEL_KEYS: Record<string, I18nKey> = {
  inbox: "nav.inbox",
  starred: "nav.starred",
  snoozed: "nav.snoozed",
  outbox: "nav.outbox",
  sent: "nav.sent",
  drafts: "nav.drafts",
  trash: "nav.trash",
  spam: "nav.spam",
  all: "nav.allMail",
  messengers: "nav.messengers",
  tasks: "nav.tasks",
  calendar: "nav.calendar",
  attachments: "nav.attachments",
  "smart-folders": "nav.smartFolders",
  labels: "nav.labels",
};

export function navLabelKey(navId: string): I18nKey {
  return NAV_LABEL_KEYS[navId] ?? "nav.inbox";
}

export function t(key: I18nKey, locale?: AppLocale): string {
  const loc = locale ?? useUIStore.getState().locale;
  return dictionaries[loc][key] ?? dictionaries.en[key] ?? key;
}

export function useT(): (key: I18nKey) => string {
  const locale = useUIStore((s) => s.locale);
  return useCallback((key: I18nKey) => t(key, locale), [locale]);
}

export * from "./legacy";
