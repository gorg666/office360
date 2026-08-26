import { X } from "lucide-react";
import { PeoplePicker, type PeopleSearch } from "@/components/people/PeoplePicker";
import { normalizePersonEmail, personDisplayName, personIdentityFromEmail, type PersonIdentity } from "@/services/people";
import type { AuthoredParticipant, AuthoringAttendanceRole } from "./authoredParticipants";

const SELECT_CLASS =
  "focus-ring t-fast rounded-control border border-outline bg-surface-solid text-ink-primary px-2 py-1 text-control";

interface ParticipantAuthoringProps {
  value: readonly AuthoredParticipant[];
  organizerEmail?: string | null;
  accountId?: string | null;
  onChange: (next: AuthoredParticipant[]) => void;
  search?: PeopleSearch;
}

export function ParticipantAuthoring({
  value,
  organizerEmail,
  accountId,
  onChange,
  search,
}: ParticipantAuthoringProps) {
  const selected = value.map((row) => personIdentityFromEmail(row.email, { displayName: row.displayName }));

  const reconcile = (people: PersonIdentity[]) => {
    const existing = new Map(value.map((row) => [normalizePersonEmail(row.email), row]));
    onChange(people.map((person) => {
      const row = existing.get(person.normalizedEmail);
      return {
        email: person.email,
        role: row?.role ?? "required",
        ...(person.displayName || row?.displayName ? { displayName: person.displayName ?? row?.displayName } : {}),
      };
    }));
  };

  return (
    <fieldset className="space-y-2 rounded-md border border-border-primary p-3" data-testid="participant-authoring">
      <legend className="px-1 text-xs text-text-secondary">Участники</legend>
      <PeoplePicker
        accountId={accountId}
        label="Адрес участника"
        selected={selected}
        onChange={reconcile}
        excludedEmails={organizerEmail ? [organizerEmail] : []}
        placeholder="Имя, должность или email"
        {...(search ? { search } : {})}
        renderSelectedPerson={(person, remove) => {
          const row = value.find((item) => normalizePersonEmail(item.email) === person.normalizedEmail);
          return (
            <span className="inline-flex max-w-full items-center gap-1 rounded-control bg-surface-sunken px-1.5 py-1" data-testid="participant-row">
              <span className="max-w-40 truncate text-xs text-text-primary" title={person.email}>{personDisplayName(person)}</span>
              <select
                aria-label={`Роль ${person.email}`}
                className={SELECT_CLASS}
                value={row?.role ?? "required"}
                onChange={(event) => onChange(value.map((item) => (
                  normalizePersonEmail(item.email) === person.normalizedEmail
                    ? { ...item, role: event.target.value as AuthoringAttendanceRole }
                    : item
                )))}
              >
                <option value="required">Обязательный</option>
                <option value="optional">Необязательный</option>
              </select>
              <button type="button" onClick={remove} className="p-0.5 text-text-tertiary hover:text-danger" aria-label={`Удалить ${person.email}`}>
                <X size={12} />
              </button>
            </span>
          );
        }}
      />
      {value.length === 0 && (
        <p className="text-xs text-text-tertiary">Организатор не показывается в этом списке.</p>
      )}
    </fieldset>
  );
}
