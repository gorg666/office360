import { useEffect, useState } from "react";
import { currentTimeTopPx, indexOfTodayColumn } from "./displayTimeIndicator";

interface CurrentTimeIndicatorProps {
  days: Date[];
  hourHeightPx: number;
  displayTimeZone: string;
}

export function CurrentTimeIndicator({ days, hourHeightPx, displayTimeZone }: CurrentTimeIndicatorProps) {
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

  return (
    <div
      data-testid="current-time-indicator"
      className="pointer-events-none absolute z-30"
      style={{
        top,
        left: `${dayIndex * columnWidth}%`,
        width: `${columnWidth}%`,
      }}
      aria-hidden="true"
    >
      <div className="relative h-0">
        <span className="absolute -left-1 top-0 h-2 w-2 -translate-y-1/2 rounded-full bg-danger" />
        <span className="absolute left-0 right-0 top-0 h-px bg-danger" />
      </div>
    </div>
  );
}
