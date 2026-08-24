import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
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
      <div className="flex min-h-9 flex-wrap items-center gap-1 rounded border border-border-primary bg-bg-secondary px-2 py-1 focus-within:border-accent">
        {selected.map((person) => renderSelectedPerson ? (
          <div key={person.normalizedEmail}>{renderSelectedPerson(person, () => remove(person))}</div>
        ) : (
          <span
            key={person.normalizedEmail}
            title={person.email}
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent-light px-2 py-0.5 text-xs text-accent"
          >
            <span className="truncate">{personDisplayName(person)}</span>
            <button type="button" onClick={() => remove(person)} className="shrink-0 p-0.5 hover:text-danger" aria-label={`Удалить ${person.email}`}>
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
            className="min-w-28 flex-1 bg-transparent py-0.5 text-sm text-text-primary outline-none placeholder:text-text-tertiary"
          />
        )}
        {loading && <Loader2 size={14} className="animate-spin text-text-tertiary" aria-label="Поиск" />}
      </div>

      {open && (
        <div id={listboxId} role="listbox" className="absolute left-0 top-full z-50 mt-1 max-h-72 w-full min-w-72 overflow-y-auto rounded-md border border-border-primary bg-bg-primary py-1 shadow-lg">
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
              className={`flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-bg-hover ${index === activeIndex ? "bg-bg-hover" : ""}`}
            >
              <PersonAvatar person={person} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-text-primary">{personDisplayName(person)}</span>
                <span className="block truncate text-xs text-text-tertiary">{person.email}</span>
                {(person.jobTitle || person.department) && (
                  <span className="block truncate text-[11px] text-text-tertiary">{[person.jobTitle, person.department].filter(Boolean).join(" · ")}</span>
                )}
              </span>
              {person.source === "manual" && <span className="shrink-0 text-[10px] text-text-tertiary">Использовать email</span>}
            </button>
          ))}
          {!loading && suggestions.length === 0 && (
            <div className="px-3 py-2 text-xs text-text-tertiary">Ничего не найдено. Введите корректный email вручную.</div>
          )}
          {result?.directorySearch === "permission-denied" && (
            <div role="status" className="border-t border-border-primary px-3 py-2 text-[11px] text-text-tertiary">Каталог организации недоступен; показаны локальные контакты и недавние адресаты.</div>
          )}
          {result?.directoryError && result.directorySearch !== "permission-denied" && (
            <div role="status" className="border-t border-border-primary px-3 py-2 text-[11px] text-text-tertiary">Каталог временно недоступен; локальный поиск продолжает работать.</div>
          )}
        </div>
      )}
    </div>
  );
}

function PersonAvatar({ person }: { person: PersonIdentity }) {
  const source = personDisplayName(person);
  const initials = source.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
  return person.avatarUrl ? (
    <img src={person.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
  ) : (
    <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-light text-[11px] font-medium text-accent">{initials}</span>
  );
}

const defaultPeopleSearch: PeopleSearch = (input) => peopleSearchService.search(input);
