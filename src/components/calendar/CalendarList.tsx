import { accessForCalendar, type DbCalendar } from "@/services/db/calendars";
import { Users } from "lucide-react";

interface CalendarListProps {
  calendars: DbCalendar[];
  onVisibilityChange: (calendarId: string, visible: boolean) => void;
  onManageSharing?: (calendar: DbCalendar) => void;
}

export function CalendarList({ calendars, onVisibilityChange, onManageSharing }: CalendarListProps) {
  return (
    <div className="w-52 border-r border-border-primary p-3 overflow-y-auto shrink-0">
      <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">
        Calendars
      </h3>
      <div className="space-y-1">
        {calendars.map((cal) => {
          const access = accessForCalendar(cal);
          const accessLabel = cal.is_primary || access.ownership === "primary" ? "Primary"
            : access.ownership === "owned" ? "Owner"
              : access.role === "unknown" ? "Unavailable"
                : access.permissions.canCreate ? "Shared"
                  : access.role === "free-busy-only" ? "Free/busy" : "Read-only";
          return (
            <div key={cal.id} className="flex items-center rounded px-2 py-1.5 hover:bg-bg-hover transition-colors">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!cal.is_visible}
                  onChange={(e) => onVisibilityChange(cal.id, e.target.checked)}
                  className="sr-only"
                />
                <span
                  className={`w-3 h-3 rounded-sm border-2 flex items-center justify-center shrink-0 transition-colors ${
                    cal.is_visible ? "border-transparent" : "border-border-primary bg-transparent"
                  }`}
                  style={cal.is_visible ? { backgroundColor: cal.color ?? "var(--color-accent)" } : undefined}
                >
                  {!!cal.is_visible && (
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                      <path d="M1.5 4L3 5.5L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="truncate text-sm text-text-primary">{cal.display_name ?? "Calendar"}</span>
              </label>
              <span className="ml-1 shrink-0 text-[0.6rem] text-text-tertiary">{accessLabel}</span>
              {(access.permissions.canManageSharing || access.ownership === "owned" || access.ownership === "primary") && onManageSharing && (
                <button
                  type="button"
                  onClick={() => onManageSharing(cal)}
                  aria-label={`Управление доступом ${cal.display_name ?? "Calendar"}`}
                  className="ml-1 rounded p-1 text-text-tertiary hover:bg-bg-secondary hover:text-text-primary"
                >
                  <Users size={13} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
