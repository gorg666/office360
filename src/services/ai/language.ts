import { useUIStore, type AppLocale } from "@/stores/uiStore";

export function getAiLocale(): AppLocale {
  return useUIStore.getState().locale;
}

export function getAiLanguageInstruction(locale = getAiLocale()): string {
  if (locale === "ru") {
    return [
      "Language:",
      "- Write all user-facing natural language in Russian.",
      "- This includes summaries, task titles/descriptions, answers, generated drafts, smart replies, and transformed text.",
      "- Preserve email addresses, names, quoted source text, IDs, JSON keys, enum values, category names, label IDs, and required output formats exactly as requested.",
    ].join("\n");
  }

  return [
    "Language:",
    "- Write all user-facing natural language in English.",
    "- Preserve email addresses, names, quoted source text, IDs, JSON keys, enum values, category names, label IDs, and required output formats exactly as requested.",
  ].join("\n");
}

export function withAiLanguage(systemPrompt: string, locale = getAiLocale()): string {
  return `${systemPrompt}\n\n${getAiLanguageInstruction(locale)}`;
}

export function localizedCacheType(baseType: string, locale = getAiLocale()): string {
  return `${baseType}_${locale}`;
}

export function getLocalizedFallback(
  ruText: string,
  enText: string,
  locale = getAiLocale(),
): string {
  return locale === "ru" ? ruText : enText;
}
