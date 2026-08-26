import { getInitialLocale, translateText } from "@/i18n";

function dateLocaleTag(): string {
  return getInitialLocale() === "ru" ? "ru-RU" : "en-US";
}

/**
 * Format a unix timestamp (milliseconds) into a relative date string.
 */
export function formatRelativeDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  const tag = dateLocaleTag();
  const locale = getInitialLocale();

  // Today: show time
  if (isSameDay(date, now)) {
    return date.toLocaleTimeString(tag, {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  // Yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(date, yesterday)) {
    return translateText("Yesterday", locale);
  }

  // Within last 7 days: show day name
  if (diffDays < 7) {
    return date.toLocaleDateString(tag, { weekday: "short" });
  }

  // Same year: show month + day
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(tag, {
      month: "short",
      day: "numeric",
    });
  }

  // Older: show full date
  return date.toLocaleDateString(tag, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format a unix timestamp into a full date string for message headers.
 */
export function formatFullDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString(dateLocaleTag(), {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
