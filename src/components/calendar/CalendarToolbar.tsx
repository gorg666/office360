import { ChevronLeft, ChevronRight, Plus, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
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
  calendarListOpen?: boolean;
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
  calendarListOpen,
  search,
}: CalendarToolbarProps) {
  const locale = useUIStore((state) => state.locale);
  const title = formatCalendarToolbarTitle(currentDate, view, locale);
  const viewLabels: Record<CalendarView, string> = locale === "ru"
    ? { day: "День", week: "Неделя", month: "Месяц" }
    : { day: "Day", week: "Week", month: "Month" };

  return (
    <div className="material-subtle flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-separator px-3 py-2.5 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="md"
            iconOnly
            icon={<ChevronLeft size={16} />}
            onClick={onPrev}
            aria-label={locale === "ru" ? "Предыдущий период" : "Previous period"}
          />
          <Button variant="secondary" size="md" onClick={onToday}>
            {locale === "ru" ? "Сегодня" : "Today"}
          </Button>
          <Button
            variant="ghost"
            size="md"
            iconOnly
            icon={<ChevronRight size={16} />}
            onClick={onNext}
            aria-label={locale === "ru" ? "Следующий период" : "Next period"}
          />
        </div>
        <h2
          data-no-translate
          className="min-w-0 truncate text-page font-semibold text-ink-primary"
          title={title}
        >
          {title}
        </h2>
      </div>

      <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
        {search ? <div className="min-w-0 max-w-full">{search}</div> : null}
        {showCalendarListButton && onToggleCalendarList && (
          <Button
            variant={calendarListOpen ? "subtle" : "ghost"}
            size="md"
            iconOnly
            icon={<CalendarDays size={16} />}
            onClick={onToggleCalendarList}
            aria-pressed={calendarListOpen}
            aria-label={locale === "ru" ? "Список календарей" : "Calendar list"}
          />
        )}
        <SegmentedControl
          label={locale === "ru" ? "Представление" : "Calendar view"}
          size="md"
          value={view}
          onChange={onViewChange}
          options={(["day", "week", "month"] as CalendarView[]).map((v) => ({
            value: v,
            label: viewLabels[v],
          }))}
        />
        <Button
          variant="primary"
          size="md"
          icon={<Plus size={14} />}
          onClick={onCreateEvent}
          disabled={!canCreateEvent}
          title={!canCreateEvent ? (locale === "ru" ? "Создание событий недоступно" : "Event creation unavailable") : undefined}
        >
          {locale === "ru" ? "Создать" : "Create"}
        </Button>
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
