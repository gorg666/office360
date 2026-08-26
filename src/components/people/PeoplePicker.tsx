import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { calendarColorSet } from "@/constants/calendarColors";
import {
  personDisplayName,
  isValidPersonEmail,
  normalizePersonEmail,
  personIdentityFromEmail,
  peopleSearchService,
  type PeopleSearchInput,
  type PeopleSearchResult,
  type PersonIdentity,
} from "@/services/people";

export type PeopleSearch = (input: PeopleSearchInput) => Promise<PeopleSearchResult>;

interface PeoplePickerProps {
  accountId?: string | null;
  label: string;
  selected: readonly PersonIdentity[];
  onChange: (selected: PersonIdentity[]) => void;
  mode?: "single" | "multiple";
  placeholder?: string;
  excludedEmails?: readonly string[];
  debounceMs?: number;
  limit?: number;
  className?: string;
  renderSelectedPerson?: (person: PersonIdentity, remove: () => void) => ReactNode;
  search?: PeopleSearch;
}

export function PeoplePicker({
  accountId,
  label,
  selected,
  onChange,
  mode = "multiple",
  placeholder = "Имя или email",
  excludedEmails = [],
  debounceMs = 200,
  limit = 10,
  className = "",
  renderSelectedPerson,
  search = defaultPeopleSearch,
}: PeoplePickerProps) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<PeopleSearchResult | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [activated, setActivated] = useState(false);

  const selectedKeys = new Set(selected.map((person) => person.normalizedEmail));
  const excludedKeys = new Set(excludedEmails.map(normalizePersonEmail));
  const resultPeople = result?.people ?? [];
  const manualPerson = isValidPersonEmail(query)
    && !resultPeople.some((person) => person.normalizedEmail === normalizePersonEmail(query))
    ? personIdentityFromEmail(query)
    : null;
  const suggestions = [...resultPeople, ...(manualPerson ? [manualPerson] : [])].filter((person) => (
    !selectedKeys.has(person.normalizedEmail) && !excludedKeys.has(person.normalizedEmail)
  ));

  const runSearch = useCallback(async (nextQuery: string) => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const next = await search({ accountId, query: nextQuery, limit });
      if (generation.current !== current) return;
      setResult(next);
      setActiveIndex(next.people.length > 0 ? 0 : -1);
      setOpen(true);
    } catch {
      if (generation.current !== current) return;
      setResult({ people: [], directorySearch: "unsupported", directoryError: "Поиск временно недоступен." });
      setActiveIndex(-1);
      setOpen(true);
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [accountId, limit, search]);

  useEffect(() => {
    if (!activated) return;
    const timer = setTimeout(() => void runSearch(query), debounceMs);
    return () => clearTimeout(timer);
  }, [activated, debounceMs, query, runSearch]);

  useEffect(() => () => {
    generation.current += 1;
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  const choose = (person: PersonIdentity) => {
    onChange(mode === "single" ? [person] : [...selected, person]);
    setQuery("");
    setResult(null);
    setOpen(false);
    setActivated(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  const remove = (person: PersonIdentity) => {
    onChange(selected.filter((item) => item.normalizedEmail !== person.normalizedEmail));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && open && suggestions.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, suggestions.length - 1));
      return;
    }
    if (event.key === "ArrowUp" && open && suggestions.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
      return;
    }
    if ((event.key === "Enter" || event.key === "Tab" || event.key === ",") && suggestions.length > 0) {
      event.preventDefault();
      choose(suggestions[Math.max(0, activeIndex)]!);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "Backspace" && !query && selected.length > 0) {
      remove(selected[selected.length - 1]!);
    }
  };

  const activeId = activeIndex >= 0 && activeIndex < suggestions.length
    ? `${listboxId}-option-${activeIndex}`
    : undefined;

  return (
    <div className={`relative ${className}`}>
      <div className="t-fast flex min-h-9 flex-wrap items-center gap-1 rounded-control border border-outline bg-surface-solid px-2 py-1 focus-within:border-brand focus-within:ring-2 focus-within:ring-focus-halo">
        {selected.map((person) => renderSelectedPerson ? (
          <div key={person.normalizedEmail}>{renderSelectedPerson(person, () => remove(person))}</div>
        ) : (
          <span
            key={person.normalizedEmail}
            title={person.email}
            className="group/chip inline-flex max-w-full items-center gap-1 rounded-full bg-brand-tint-1 p-0.5 pr-0.5 text-caption font-medium text-brand-text"
          >
            <PersonAvatar person={person} size={18} />
            <span className="truncate pl-0.5">{personDisplayName(person)}</span>
            <button
              type="button"
              onClick={() => remove(person)}
              className="focus-ring t-fast shrink-0 rounded-full p-0.5 opacity-0 hover:bg-black/10 hover:opacity-100 group-hover/chip:opacity-70 focus-visible:opacity-100 dark:hover:bg-white/15"
              aria-label={`Удалить ${person.email}`}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        {(mode === "multiple" || selected.length === 0) && (
          <input
            ref={inputRef}
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            autoComplete="off"
            value={query}
            placeholder={selected.length === 0 ? placeholder : ""}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setActivated(true);
            }}
            onFocus={() => {
              if (blurTimer.current) clearTimeout(blurTimer.current);
              setOpen(true);
              setActivated(true);
            }}
            onBlur={() => {
              blurTimer.current = setTimeout(() => {
                setOpen(false);
                setActivated(false);
              }, 150);
            }}
            onKeyDown={onKeyDown}
            className="min-w-28 flex-1 bg-transparent py-0.5 text-copy text-ink-primary outline-none placeholder:text-ink-tertiary"
          />
        )}
        {loading && <Loader2 size={14} className="animate-spin text-ink-tertiary" aria-label="Поиск" />}
      </div>

      {open && (
        <div id={listboxId} role="listbox" className="materialize material-elevated absolute left-0 top-full z-dropdown mt-1.5 max-h-80 w-full min-w-72 overflow-y-auto rounded-card py-1">
          {suggestions.map((person, index) => (
            <button
              key={person.normalizedEmail}
              id={`${listboxId}-option-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(person)}
              className={`t-fast relative flex w-full items-center gap-2.5 py-1.5 pr-3 pl-3 text-left
                ${index === activeIndex
                  ? "bg-brand-tint-1 before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-r-full before:bg-brand"
                  : "hover:bg-surface-sunken"}`}
            >
              <PersonAvatar person={person} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-meta font-medium text-ink-primary">{personDisplayName(person)}</span>
                <span className="block truncate text-caption text-ink-secondary">{person.email}</span>
                {(person.jobTitle || person.department) && (
                  <span className="block truncate text-caption text-ink-tertiary">{[person.jobTitle, person.department].filter(Boolean).join(" · ")}</span>
                )}
              </span>
              {person.source === "manual" && <span className="shrink-0 text-caption text-ink-tertiary">Использовать email</span>}
            </button>
          ))}
          {!loading && suggestions.length === 0 && (
            <div className="px-3 py-3 text-caption text-ink-tertiary">Ничего не найдено. Введите корректный email вручную.</div>
          )}
          {result?.directorySearch === "permission-denied" && (
            <div role="status" className="border-t border-separator px-3 py-2 text-caption text-ink-tertiary">Каталог организации недоступен; показаны локальные контакты и недавние адресаты.</div>
          )}
          {result?.directoryError && result.directorySearch !== "permission-denied" && (
            <div role="status" className="border-t border-separator px-3 py-2 text-caption text-ink-tertiary">Каталог временно недоступен; локальный поиск продолжает работать.</div>
          )}
        </div>
      )}
    </div>
  );
}

function PersonAvatar({ person, size = 32 }: { person: PersonIdentity; size?: number }) {
  const source = personDisplayName(person);
  const initials = source.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
  const style = { width: size, height: size };

  if (person.avatarUrl) {
    return <img src={person.avatarUrl} alt="" style={style} className="shrink-0 rounded-full object-cover" />;
  }

  // Stable per-person hue: a directory of forty people should not render as
  // forty identical grey circles.
  const colors = calendarColorSet({ id: person.normalizedEmail, color: null }, false);
  return (
    <span
      aria-hidden
      style={{ ...style, backgroundColor: colors.fill, color: colors.text }}
      className="flex shrink-0 items-center justify-center rounded-full text-caption font-semibold"
    >
      {initials}
    </span>
  );
}

const defaultPeopleSearch: PeopleSearch = (input) => peopleSearchService.search(input);
