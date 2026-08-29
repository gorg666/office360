import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2, UserRound } from "lucide-react";
import {
  personDisplayName,
  type DirectorySearchCapability,
  type PersonIdentity,
} from "@/services/people/domain";
import { searchOrganizationMembers } from "@/services/tasks/organizationDirectorySearch";

export interface OrganizationPeoplePickerProps {
  accountId: string;
  organizationId: string;
  value: PersonIdentity | null;
  onChange: (person: PersonIdentity | null) => void;
  disabled?: boolean;
  /** Confirmed organization members only; manual email is never allowed. */
  policy?: "confirmed-organization-member";
  allowManual?: false;
  label?: string;
  searchFn?: typeof searchOrganizationMembers;
}

export function OrganizationPeoplePicker({
  accountId,
  organizationId,
  value,
  onChange,
  disabled = false,
  label = "Исполнитель",
  searchFn = searchOrganizationMembers,
}: OrganizationPeoplePickerProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [people, setPeople] = useState<PersonIdentity[]>([]);
  const [capability, setCapability] = useState<DirectorySearchCapability>("supported");
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const runSearch = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await searchFn({
        accountId,
        organizationId,
        query: q,
        limit: 25,
      });
      setPeople(result.people);
      setCapability(result.directorySearch);
      setError(result.directoryError ?? null);
      setActiveIndex(0);
    } catch {
      setPeople([]);
      setCapability("unsupported");
      setError("Не удалось загрузить сотрудников организации");
    } finally {
      setLoading(false);
    }
  }, [accountId, organizationId, searchFn]);

  useEffect(() => {
    if (!open || disabled) return;
    const handle = window.setTimeout(() => {
      void runSearch(query);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [open, query, disabled, runSearch]);

  const selectPerson = (person: PersonIdentity) => {
    if (person.source !== "organization-directory") return;
    onChange(person);
    setQuery("");
    setOpen(false);
  };

  const clear = () => {
    onChange(null);
    setQuery("");
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      <label className="block text-xs font-medium text-text-secondary mb-1" htmlFor={listId}>
        {label}
      </label>
      {value ? (
        <div className="flex items-start gap-2 rounded-md border border-border-primary bg-bg-secondary px-3 py-2">
          <UserRound size={14} className="mt-0.5 text-text-tertiary shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm text-text-primary truncate">{personDisplayName(value)}</div>
            <div className="text-xs text-text-tertiary truncate">{value.email}</div>
            {(value.jobTitle || value.department) && (
              <div className="text-xs text-text-tertiary truncate">
                {[value.jobTitle, value.department].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
          {!disabled && (
            <button
              type="button"
              className="text-xs text-text-tertiary hover:text-text-primary"
              onClick={clear}
            >
              Сменить
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          <input
            ref={inputRef}
            id={listId}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={`${listId}-listbox`}
            aria-autocomplete="list"
            disabled={disabled}
            value={query}
            placeholder="Поиск сотрудника организации…"
            className="w-full rounded-md border border-border-primary bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/40"
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (!open) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, Math.max(people.length - 1, 0)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && people[activeIndex]) {
                e.preventDefault();
                selectPerson(people[activeIndex]!);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
          />
          {open && (
            <div
              id={`${listId}-listbox`}
              role="listbox"
              className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border-primary bg-bg-primary shadow-lg"
            >
              {loading && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-text-tertiary">
                  <Loader2 size={12} className="animate-spin" />
                  Поиск…
                </div>
              )}
              {!loading && capability === "permission-denied" && (
                <div className="px-3 py-2 text-xs text-warning">
                  {error ?? "Не удалось подтвердить сотрудника организации"}
                </div>
              )}
              {!loading && capability === "supported" && people.length === 0 && (
                <div className="px-3 py-2 text-xs text-text-tertiary">
                  Сотрудники не найдены. Произвольный email недоступен.
                </div>
              )}
              {!loading && people.map((person, index) => (
                <button
                  key={person.id}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`w-full px-3 py-2 text-left hover:bg-bg-hover ${index === activeIndex ? "bg-bg-hover" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectPerson(person)}
                >
                  <div className="text-sm text-text-primary">{personDisplayName(person)}</div>
                  <div className="text-xs text-text-tertiary">{person.email}</div>
                  {(person.jobTitle || person.department) && (
                    <div className="text-xs text-text-tertiary">
                      {[person.jobTitle, person.department].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="mt-1 text-[11px] text-text-tertiary">
        Только подтверждённые сотрудники организации. Ручной email запрещён.
      </p>
    </div>
  );
}

/** Alias matching TASKS architecture PeoplePicker contract naming. */
export const PeoplePicker = OrganizationPeoplePicker;
