import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Loader2, Search, X } from "lucide-react";
import { calendarSearchService, type CalendarSearchResult } from "@/services/calendar/calendarSearchService";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import type { DbCalendar } from "@/services/db/calendars";

interface CalendarSearchProps {
  accountId: string;
  calendars: readonly DbCalendar[];
  currentRange: { start: number; end: number };
  locale: "en" | "ru";
  debounceMs?: number;
  onOpenEvent: (event: DbCalendarEvent) => void;
}

type SearchState = "idle" | "loading" | "ready" | "error";

export function CalendarSearch({
  accountId,
  calendars,
  currentRange,
  locale,
  debounceMs = 220,
  onOpenEvent,
}: CalendarSearchProps) {
  const [query, setQuery] = useState("");
  const [rangeMode, setRangeMode] = useState<"current" | "all">("all");
  const [calendarId, setCalendarId] = useState("all");
  const [results, setResults] = useState<CalendarSearchResult[]>([]);
  const [state, setState] = useState<SearchState>("idle");
  const [activeIndex, setActiveIndex] = useState(0);
  const generationRef = useRef(0);
  const trimmedQuery = query.trim();
  const isOpen = trimmedQuery.length > 0;

  useEffect(() => {
    const generation = ++generationRef.current;
    if (trimmedQuery.length < 2) {
      setResults([]);
      setState("idle");
      return;
    }
    setState("loading");
    const timer = window.setTimeout(() => {
      void calendarSearchService.search({
        accountId,
        query: trimmedQuery,
        calendarIds: calendarId === "all" ? undefined : [calendarId],
        range: rangeMode === "current" ? currentRange : null,
        limit: 30,
      }).then((next) => {
        if (generationRef.current !== generation) return;
        setResults(next);
        setActiveIndex(0);
        setState("ready");
      }).catch(() => {
        if (generationRef.current !== generation) return;
        setResults([]);
        setState("error");
      });
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [accountId, calendarId, currentRange.end, currentRange.start, debounceMs, rangeMode, trimmedQuery]);

  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }), [locale]);

  const openResult = async (result: CalendarSearchResult) => {
    try {
      const event = await calendarSearchService.resolveEvent(accountId, result.eventId);
      if (!event) {
        setState("error");
        return;
      }
      onOpenEvent(event);
      setQuery("");
    } catch {
      setState("error");
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      setResults([]);
      return;
    }
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const result = results[activeIndex];
      if (result) void openResult(result);
    }
  };

  return (
    <div className="relative w-56 xl:w-72" data-testid="calendar-search">
      <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={locale === "ru" ? "Поиск событий" : "Search events"}
        aria-label={locale === "ru" ? "Поиск событий календаря" : "Search calendar events"}
        aria-expanded={isOpen}
        aria-controls="calendar-search-results"
        className="h-8 w-full rounded-md border border-border-primary bg-bg-secondary pl-8 pr-8 text-xs text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-accent"
      />
      {query && (
        <button
          type="button"
          aria-label={locale === "ru" ? "Очистить поиск" : "Clear search"}
          onClick={() => setQuery("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
        >
          <X size={14} />
        </button>
      )}

      {isOpen && (
        <div
          id="calendar-search-results"
          role="listbox"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(30rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border-primary bg-bg-primary shadow-xl"
        >
          <div className="flex items-center gap-2 border-b border-border-primary p-2">
            <select
              aria-label={locale === "ru" ? "Календарь" : "Calendar"}
              value={calendarId}
              onChange={(event) => setCalendarId(event.target.value)}
              className="min-w-0 flex-1 rounded border border-border-primary bg-bg-secondary px-2 py-1 text-xs text-text-secondary"
            >
              <option value="all">{locale === "ru" ? "Все доступные календари" : "All accessible calendars"}</option>
              {calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>{calendar.display_name || calendar.remote_id}</option>
              ))}
            </select>
            <select
              aria-label={locale === "ru" ? "Период" : "Date range"}
              value={rangeMode}
              onChange={(event) => setRangeMode(event.target.value as "current" | "all")}
              className="rounded border border-border-primary bg-bg-secondary px-2 py-1 text-xs text-text-secondary"
            >
              <option value="all">{locale === "ru" ? "Весь локальный кэш" : "All cached dates"}</option>
              <option value="current">{locale === "ru" ? "Текущий период" : "Current period"}</option>
            </select>
          </div>

          <div className="max-h-96 overflow-y-auto p-1">
            {trimmedQuery.length < 2 && <SearchMessage>{locale === "ru" ? "Введите минимум 2 символа" : "Type at least 2 characters"}</SearchMessage>}
            {state === "loading" && <SearchMessage><Loader2 size={14} className="animate-spin" />{locale === "ru" ? "Поиск…" : "Searching…"}</SearchMessage>}
            {state === "error" && <SearchMessage>{locale === "ru" ? "Не удалось выполнить поиск" : "Search failed"}</SearchMessage>}
            {state === "ready" && results.length === 0 && <SearchMessage>{locale === "ru" ? "События не найдены" : "No events found"}</SearchMessage>}
            {state === "ready" && results.map((result, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                key={`${result.eventId}:${result.occurrenceKey ?? ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => void openResult(result)}
                className={`flex w-full gap-3 rounded-md px-3 py-2 text-left ${index === activeIndex ? "bg-bg-hover" : "hover:bg-bg-hover"}`}
              >
                <CalendarClock size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text-primary">{result.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-text-secondary">
                    {result.isAllDay ? new Date(result.startTime * 1000).toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US") : dateFormatter.format(new Date(result.startTime * 1000))}
                    {result.calendarName ? ` · ${result.calendarName}` : ""}
                    {result.location ? ` · ${result.location}` : ""}
                  </span>
                  <span className="mt-1 block text-[10px] text-text-tertiary">{formatMatches(result.matchedFields, locale)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SearchMessage({ children }: { children: React.ReactNode }) {
  return <div role="status" className="flex min-h-20 items-center justify-center gap-2 px-3 text-xs text-text-tertiary">{children}</div>;
}

function formatMatches(fields: CalendarSearchResult["matchedFields"], locale: "en" | "ru"): string {
  const labels = locale === "ru"
    ? { title: "название", description: "описание", location: "место", participant: "участник" }
    : { title: "title", description: "description", location: "location", participant: "participant" };
  return `${locale === "ru" ? "Совпадение" : "Matched"}: ${fields.map((field) => labels[field]).join(", ")}`;
}
