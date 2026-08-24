import { accessForCalendar, type DbCalendar } from "@/services/db/calendars";
import { Users } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";

interface CalendarListProps {
  calendars: DbCalendar[];
  onVisibilityChange: (calendarId: string, visible: boolean) => void;
  onManageSharing?: (calendar: DbCalendar) => void;
}

const FOCUS =
  "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-accent";

export function CalendarList({ calendars, onVisibilityChange, onManageSharing }: CalendarListProps) {
  const locale = useUIStore((state) => state.locale);
  const heading = locale === "ru" ? "Календари" : "Calendars";
  const untitled = locale === "ru" ? "Календарь" : "Calendar";

  return (
    <div className="w-44 min-w-[10.5rem] max-w-[13.5rem] shrink-0 overflow-y-auto border-r border-border-primary p-3 xl:w-52">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-tertiary">
        {heading}
      </h3>
      <div className="space-y-1">
        {calendars.map((cal) => {
          const access = accessForCalendar(cal);
          const name = cal.display_name ?? untitled;
          const accessLabel = accessBadge(cal, access, locale);
          const canShare = (access.permissions.canManageSharing || access.ownership === "owned" || access.ownership === "primary") && onManageSharing;
          return (
            <div key={cal.id} className="rounded px-2 py-1.5 hover:bg-bg-hover">
              <div className="flex min-w-0 items-center">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!cal.is_visible}
                    onChange={(e) => onVisibilityChange(cal.id, e.target.checked)}
                    className="peer sr-only"
                    aria-label={locale === "ru" ? `Показать календарь ${name}` : `Show calendar ${name}`}
                  />
                  <span
                    className={`flex h-3 w-3 shrink-0 items-center justify-center rounded-sm border-2 transition-colors ${FOCUS} ${
                      cal.is_visible ? "border-transparent" : "border-border-primary bg-transparent"
                    }`}
                    style={cal.is_visible ? { backgroundColor: cal.color ?? "var(--color-accent)" } : undefined}
                  >
                    {!!cal.is_visible && (
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                        <path d="M1.5 4L3 5.5L6.5 2" stroke="#000" strokeOpacity="0.55" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M1.5 4L3 5.5L6.5 2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0 truncate text-sm text-text-primary" title={name}>{name}</span>
                </label>
                {canShare && (
                  <button
                    type="button"
                    onClick={() => onManageSharing(cal)}
                    aria-label={locale === "ru" ? `Управление доступом ${name}` : `Manage access ${name}`}
                    className="ml-1 shrink-0 rounded p-1 text-text-tertiary hover:bg-bg-secondary hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                  >
                    <Users size={13} />
                  </button>
                )}
              </div>
              <span className="ml-5 block truncate text-[0.6rem] text-text-tertiary" title={accessLabel}>
                {accessLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function accessBadge(
  cal: DbCalendar,
  access: ReturnType<typeof accessForCalendar>,
  locale: "ru" | "en",
): string {
  const ru = locale === "ru";
  if (cal.is_primary || access.ownership === "primary") return ru ? "Основной" : "Primary";
  if (access.ownership === "owned") return ru ? "Владелец" : "Owner";
  if (access.role === "unknown") return ru ? "Недоступен" : "Unavailable";
  if (access.permissions.canCreate) return ru ? "Общий" : "Shared";
  if (access.role === "free-busy-only") return ru ? "Занятость" : "Free/busy";
  return ru ? "Только чтение" : "Read-only";
}
