import { useEffect, useState } from "react";
import { useUIStore } from "@/stores/uiStore";
import { currentTimeTopPx, indexOfTodayColumn } from "./displayTimeIndicator";

interface CurrentTimeIndicatorProps {
  days: Date[];
  hourHeightPx: number;
  displayTimeZone: string;
}

export function CurrentTimeIndicator({ days, hourHeightPx, displayTimeZone }: CurrentTimeIndicatorProps) {
  const locale = useUIStore((state) => state.locale);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((value) => value + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  void tick;

  const dayIndex = indexOfTodayColumn(days, displayTimeZone);
  if (dayIndex < 0) return null;

  const top = currentTimeTopPx(displayTimeZone, hourHeightPx);
  const columnWidth = 100 / days.length;

  // Formatted through Intl so the label follows the UI locale (24h in RU),
  // matching the hour gutter rather than inventing a second convention.
  const label = new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: displayTimeZone,
  }).format(new Date());

  return (
    <div
      data-testid="current-time-indicator"
      className="pointer-events-none absolute z-sticky"
      style={{
        top,
        left: `${dayIndex * columnWidth}%`,
        width: `${columnWidth}%`,
      }}
      aria-hidden="true"
    >
      <div className="relative h-0">
        {/* Anchored inside today's own column: the indicator spans one column,
            so a gutter-side label would sit over the previous day. */}
        <span className="cal-now-label absolute left-2.5 top-0 -translate-y-1/2 rounded-tight px-1 py-px text-caption font-semibold tabular-nums">
          {label}
        </span>
        <span className="cal-now-dot absolute -left-1 top-0 h-2.5 w-2.5 -translate-y-1/2 rounded-full" />
        <span className="cal-now-line absolute inset-x-0 top-0 h-px" />
      </div>
    </div>
  );
}
