import { useState } from "react";
import type { AuthoredParticipant, AuthoringAttendanceRole } from "./authoredParticipants";
import { addAuthoredParticipant, removeAuthoredParticipant, setAuthoredParticipantRole } from "./authoredParticipants";

const SELECT_CLASS =
  "rounded border border-border-primary bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent";

interface ParticipantAuthoringProps {
  value: readonly AuthoredParticipant[];
  organizerEmail?: string | null;
  onChange: (next: AuthoredParticipant[]) => void;
}

export function ParticipantAuthoring({ value, organizerEmail, onChange }: ParticipantAuthoringProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const result = addAuthoredParticipant(value, draft, organizerEmail);
    setError(result.error);
    if (!result.error) {
      onChange(result.list);
      setDraft("");
    }
  };

  return (
    <fieldset className="space-y-2 rounded-md border border-border-primary p-3" data-testid="participant-authoring">
      <legend className="px-1 text-xs text-text-secondary">Участники</legend>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="block min-w-0 flex-1 text-xs text-text-secondary">
          Адрес участника
          <input
            type="email"
            aria-label="Адрес участника"
            placeholder="name@example.com"
            className={`${SELECT_CLASS} mt-1 w-full px-3 py-2`}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="mt-auto rounded border border-border-primary bg-bg-tertiary px-3 py-2 text-sm text-text-primary outline-none hover:border-accent focus:border-accent"
          onClick={add}
        >
          Добавить
        </button>
      </div>
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
      {value.length === 0 ? (
        <p className="text-xs text-text-tertiary">Организатор не показывается в этом списке.</p>
      ) : (
        <ul className="space-y-2">
          {value.map((row) => (
            <li
              key={row.email}
              className="flex flex-col gap-2 rounded border border-border-primary bg-bg-secondary p-2 sm:flex-row sm:items-center"
              data-testid="participant-row"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{row.email}</span>
              <label className="text-xs text-text-secondary">
                Роль
                <select
                  aria-label={`Роль ${row.email}`}
                  className={`${SELECT_CLASS} ml-2`}
                  value={row.role}
                  onChange={(event) => onChange(setAuthoredParticipantRole(
                    value,
                    row.email,
                    event.target.value as AuthoringAttendanceRole,
                  ))}
                >
                  <option value="required">Обязательный</option>
                  <option value="optional">Необязательный</option>
                </select>
              </label>
              <button
                type="button"
                className="rounded border border-border-primary px-2 py-1 text-xs text-text-secondary outline-none hover:border-accent focus:border-accent"
                aria-label={`Удалить ${row.email}`}
                onClick={() => onChange(removeAuthoredParticipant(value, row.email))}
              >
                Удалить
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
