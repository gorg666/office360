/** Week layout policy: RU starts Monday; EN keeps Sunday-first. */

export type CalendarUiLocale = "en" | "ru";

const DAY_NAMES = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  ru: ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"],
} as const;

export function weekStartsOnMonday(locale: CalendarUiLocale): boolean {
  return locale === "ru";
}

/** Offset from month-grid start (0 = first column) to the 1st of the month. */
export function monthGridStartOffset(firstOfMonth: Date, locale: CalendarUiLocale): number {
  const sundayIndex = firstOfMonth.getDay();
  return weekStartsOnMonday(locale) ? (sundayIndex + 6) % 7 : sundayIndex;
}

export function startOfWeek(date: Date, locale: CalendarUiLocale): Date {
  const start = new Date(date);
  const offset = weekStartsOnMonday(locale) ? (start.getDay() + 6) % 7 : start.getDay();
  start.setDate(start.getDate() - offset);
  start.setHours(0, 0, 0, 0);
  return start;
}

export function endOfWeek(date: Date, locale: CalendarUiLocale): Date {
  const end = startOfWeek(date, locale);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function monthGridRange(currentDate: Date, locale: CalendarUiLocale): { start: Date; end: Date } {
  const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  start.setDate(start.getDate() - monthGridStartOffset(start, locale));
  const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  const trailing = weekStartsOnMonday(locale)
    ? (7 - ((lastDay.getDay() + 6) % 7) - 1) % 7
    : 6 - lastDay.getDay();
  const end = new Date(lastDay);
  end.setDate(end.getDate() + trailing);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function orderedDayNames(locale: CalendarUiLocale): readonly string[] {
  if (!weekStartsOnMonday(locale)) return DAY_NAMES[locale];
  const names = [...DAY_NAMES[locale]];
  const sunday = names.shift();
  if (sunday) names.push(sunday);
  return names;
}

/**
 * Hour-gutter label for the Week/Day time grid.
 *
 * Uses Intl rather than a hand-rolled formatter, so RU renders 24-hour ("13")
 * and EN keeps 12-hour ("1 PM"). The previous inline expression hardcoded
 * English am/pm and so showed "1am / 2pm" in the Russian UI.
 *
 * Midnight returns an empty string: the top gridline needs no label, and that
 * matches the previous behaviour.
 */
export function hourGutterLabel(hour: number, locale: CalendarUiLocale): string {
  if (hour === 0) return "";
  const sample = new Date(2000, 0, 1, hour, 0, 0);
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    hour: "numeric",
  }).format(sample);
}
