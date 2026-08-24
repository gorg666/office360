import { ChevronLeft, ChevronRight, Plus, CalendarDays } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { endOfWeek, startOfWeek } from "./weekLocale";
import type { ReactNode } from "react";

export type CalendarView = "day" | "week" | "month";

interface CalendarToolbarProps {
  currentDate: Date;
  view: CalendarView;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onViewChange: (view: CalendarView) => void;
  onCreateEvent: () => void;
  canCreateEvent?: boolean;
  onToggleCalendarList?: () => void;
  showCalendarListButton?: boolean;
  search?: ReactNode;
}

export function CalendarToolbar({
  currentDate,
  view,
  onPrev,
  onNext,
  onToday,
  onViewChange,
  onCreateEvent,
  canCreateEvent = true,
  onToggleCalendarList,
  showCalendarListButton,
  search,
}: CalendarToolbarProps) {
  const locale = useUIStore((state) => state.locale);
  const title = formatCalendarToolbarTitle(currentDate, view, locale);
  const viewLabels: Record<CalendarView, string> = locale === "ru"
    ? { day: "День", week: "Неделя", month: "Месяц" }
    : { day: "Day", week: "Week", month: "Month" };

  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-border-primary">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onPrev}
            className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
            aria-label={locale === "ru" ? "Предыдущий период" : "Previous period"}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={onToday}
            className="px-2.5 py-1 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
          >
            {locale === "ru" ? "Сегодня" : "Today"}
          </button>
          <button
            type="button"
            onClick={onNext}
            className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
            aria-label={locale === "ru" ? "Следующий период" : "Next period"}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <h2
          data-no-translate
          className="min-w-0 shrink-0 whitespace-nowrap text-lg font-semibold normal-case tracking-normal text-text-primary"
        >
          {title}
        </h2>
      </div>

      <div className="flex items-center gap-2">
        {search}
        {showCalendarListButton && onToggleCalendarList && (
          <button
            type="button"
            onClick={onToggleCalendarList}
            className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
            title="Toggle calendar list"
          >
            <CalendarDays size={16} />
          </button>
        )}
        <div className="flex bg-bg-tertiary rounded-md p-0.5">
          {(["day", "week", "month"] as CalendarView[]).map((v) => (
            <button
              type="button"
              key={v}
              onClick={() => onViewChange(v)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                view === v
                  ? "bg-bg-primary text-text-primary shadow-sm"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              {viewLabels[v]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onCreateEvent}
          disabled={!canCreateEvent}
          title={!canCreateEvent ? (locale === "ru" ? "Создание событий недоступно" : "Event creation unavailable") : undefined}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 rounded-md transition-colors"
        >
          <Plus size={14} />
          {locale === "ru" ? "Создать" : "Create"}
        </button>
      </div>
    </div>
  );
}

/** Title-case first letter only; keeps Intl month/year (incl. ru «г.»). */
function capitalizeFirstLetter(value: string, locale: string): string {
  const chars = [...value];
  if (chars.length === 0) return value;
  chars[0] = chars[0]!.toLocaleUpperCase(locale);
  return chars.join("");
}

export function formatCalendarToolbarTitle(
  date: Date,
  view: CalendarView,
  locale: "en" | "ru",
): string {
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";
  if (view === "month") {
    const raw = new Intl.DateTimeFormat(intlLocale, {
      month: "long",
      year: "numeric",
    }).format(date);
    return capitalizeFirstLetter(raw, intlLocale);
  }
  if (view === "week") {
    const start = startOfWeek(date, locale);
    const end = endOfWeek(date, locale);
    const monthLong = new Intl.DateTimeFormat(intlLocale, { month: "long" });
    const monthShort = new Intl.DateTimeFormat(intlLocale, { month: "short" });
    if (start.getMonth() === end.getMonth()) {
      return locale === "ru"
        ? `${start.getDate()}-${end.getDate()} ${monthLong.format(start)} ${start.getFullYear()}`
        : `${monthLong.format(start)} ${start.getDate()}-${end.getDate()}, ${start.getFullYear()}`;
    }
    return locale === "ru"
      ? `${start.getDate()} ${monthShort.format(start)} - ${end.getDate()} ${monthShort.format(end)} ${end.getFullYear()}`
      : `${monthShort.format(start)} ${start.getDate()} - ${monthShort.format(end)} ${end.getDate()}, ${end.getFullYear()}`;
  }
  return new Intl.DateTimeFormat(intlLocale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
