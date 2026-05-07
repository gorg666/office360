import { ChevronLeft, ChevronRight, Plus, CalendarDays } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";

export type CalendarView = "day" | "week" | "month";

interface CalendarToolbarProps {
  currentDate: Date;
  view: CalendarView;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onViewChange: (view: CalendarView) => void;
  onCreateEvent: () => void;
  onToggleCalendarList?: () => void;
  showCalendarListButton?: boolean;
}

export function CalendarToolbar({
  currentDate,
  view,
  onPrev,
  onNext,
  onToday,
  onViewChange,
  onCreateEvent,
  onToggleCalendarList,
  showCalendarListButton,
}: CalendarToolbarProps) {
  const locale = useUIStore((state) => state.locale);
  const title = formatTitle(currentDate, view, locale);
  const viewLabels: Record<CalendarView, string> = locale === "ru"
    ? { day: "День", week: "Неделя", month: "Месяц" }
    : { day: "Day", week: "Week", month: "Month" };

  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-border-primary">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={onPrev}
            className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={onToday}
            className="px-2.5 py-1 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
          >
            {locale === "ru" ? "Сегодня" : "Today"}
          </button>
          <button
            onClick={onNext}
            className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {showCalendarListButton && onToggleCalendarList && (
          <button
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
              key={v}
              onClick={() => onViewChange(v)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors capitalize ${
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
          onClick={onCreateEvent}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors"
        >
          <Plus size={14} />
          {locale === "ru" ? "Создать" : "Create"}
        </button>
      </div>
    </div>
  );
}

function formatTitle(date: Date, view: CalendarView, locale: "en" | "ru"): string {
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";
  if (view === "month") {
    return new Intl.DateTimeFormat(intlLocale, { month: "long", year: "numeric" }).format(date);
  }
  if (view === "week") {
    const start = new Date(date);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
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
