import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { calendarColorSet, type CalendarColorSet } from "@/constants/calendarColors";

/**
 * Supplies per-calendar colours to the grid — DESIGN-001C.
 *
 * A context rather than props: the resolver has to reach EventCard, the timed
 * grid overlay and the all-day lane, and threading it through Month/Week/Day as
 * a prop would mean touching behaviour signatures on six components for a purely
 * visual concern.
 *
 * Rendering a view without a provider is supported and falls back to the brand
 * colour, so existing view tests keep working unchanged.
 */

export interface EventColorKey {
  calendar_id?: string | null;
}

type Resolver = (event: EventColorKey) => CalendarColorSet;

const FALLBACK_ID = "__office360_default__";

const CalendarColorContext = createContext<Resolver | null>(null);

/** Tracks the `dark` class that App.tsx maintains on <html>. */
export function useIsDarkTheme(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return dark;
}

export function CalendarColorProvider({
  calendars,
  children,
}: {
  calendars: readonly { id: string; color: string | null }[];
  children: ReactNode;
}) {
  const dark = useIsDarkTheme();

  const resolver = useMemo<Resolver>(() => {
    const byId = new Map<string, CalendarColorSet>();
    for (const calendar of calendars) {
      byId.set(calendar.id, calendarColorSet(calendar, dark));
    }
    const fallback = calendarColorSet({ id: FALLBACK_ID, color: null }, dark);

    return (event) => {
      const id = event.calendar_id;
      if (!id) return fallback;
      const known = byId.get(id);
      if (known) return known;
      // An event whose calendar is not in the visible list still gets a stable
      // colour derived from its id, rather than collapsing to one grey.
      return calendarColorSet({ id, color: null }, dark);
    };
  }, [calendars, dark]);

  return (
    <CalendarColorContext.Provider value={resolver}>{children}</CalendarColorContext.Provider>
  );
}

export function useCalendarColors(): Resolver {
  const fromContext = useContext(CalendarColorContext);
  const dark = useIsDarkTheme();

  return useMemo<Resolver>(() => {
    if (fromContext) return fromContext;
    const fallback = calendarColorSet({ id: FALLBACK_ID, color: null }, dark);
    return () => fallback;
  }, [fromContext, dark]);
}
