import type { RecurrenceDraft, RecurrenceFrequency, RecurrencePreset, WeekDay } from "@/services/calendar/domain";
import {
  WEEK_DAYS,
  applyRecurrencePreset,
  summarizeRecurrenceRule,
  validateRecurrenceDraft,
} from "@/services/calendar/domain";

const PRESET_OPTIONS: Array<{ value: RecurrencePreset; label: string }> = [
  { value: "none", label: "Не повторять" },
  { value: "daily", label: "Каждый день" },
  { value: "weekly", label: "Каждую неделю" },
  { value: "monthly", label: "Каждый месяц" },
  { value: "yearly", label: "Каждый год" },
  { value: "weekdays", label: "По будням" },
  { value: "custom", label: "Настроить…" },
];

const FREQUENCY_OPTIONS: Array<{ value: RecurrenceFrequency; label: string }> = [
  { value: "DAILY", label: "День" },
  { value: "WEEKLY", label: "Неделя" },
  { value: "MONTHLY", label: "Месяц" },
  { value: "YEARLY", label: "Год" },
];

const WEEK_DAY_LABELS: Record<WeekDay, string> = {
  MO: "Пн",
  TU: "Вт",
  WE: "Ср",
  TH: "Чт",
  FR: "Пт",
  SA: "Сб",
  SU: "Вс",
};

const SELECT_CLASS =
  "w-full rounded border border-border-primary bg-bg-tertiary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent";

interface RecurrenceRuleEditorProps {
  value: RecurrenceDraft;
  eventStartDate: string;
  disabled?: boolean;
  readOnly?: boolean;
  onChange: (next: RecurrenceDraft) => void;
}

export function RecurrenceRuleEditor({
  value,
  eventStartDate,
  disabled = false,
  readOnly = false,
  onChange,
}: RecurrenceRuleEditorProps) {
  const locked = disabled || readOnly;
  const errors = validateRecurrenceDraft(value, eventStartDate);
  const summary = summarizeRecurrenceRule(value);

  return (
    <fieldset className="space-y-2 rounded-md border border-border-primary p-3" data-testid="recurrence-editor">
      <legend className="px-1 text-xs text-text-secondary">Повторение</legend>
      <label className="block text-xs text-text-secondary">
        Правило повторения
        <select
          aria-label="Правило повторения"
          className={`${SELECT_CLASS} mt-1`}
          value={value.preset}
          disabled={locked}
          onChange={(event) => onChange(applyRecurrencePreset(event.target.value as RecurrencePreset, value))}
        >
          {PRESET_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>

      {value.preset === "custom" && !readOnly ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs text-text-secondary">
            Интервал
            <input
              type="number"
              min={1}
              step={1}
              aria-label="Интервал повторения"
              className={`${SELECT_CLASS} mt-1`}
              value={value.interval}
              disabled={locked}
              onChange={(event) => onChange({
                ...value,
                sourceRule: undefined,
                interval: Number(event.target.value),
              })}
            />
          </label>
          <label className="block text-xs text-text-secondary">
            Частота
            <select
              aria-label="Частота повторения"
              className={`${SELECT_CLASS} mt-1`}
              value={value.frequency}
              disabled={locked}
              onChange={(event) => onChange({
                ...value,
                sourceRule: undefined,
                frequency: event.target.value as RecurrenceFrequency,
                weekDays: event.target.value === "WEEKLY" ? value.weekDays : [],
              })}
            >
              {FREQUENCY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {value.preset === "custom" && value.frequency === "WEEKLY" && !readOnly ? (
        <fieldset className="space-y-2">
          <legend className="text-xs text-text-secondary">Дни недели</legend>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Дни недели">
            {WEEK_DAYS.map((day) => {
              const checked = value.weekDays.includes(day);
              return (
                <label
                  key={day}
                  className={`inline-flex min-w-[2.25rem] cursor-pointer items-center justify-center rounded border px-2 py-1 text-xs outline-none focus-within:border-accent ${
                    checked
                      ? "border-accent bg-bg-tertiary text-text-primary"
                      : "border-border-primary bg-bg-secondary text-text-secondary"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    disabled={locked}
                    aria-label={WEEK_DAY_LABELS[day]}
                    onChange={() => onChange({
                      ...value,
                      sourceRule: undefined,
                      weekDays: checked
                        ? value.weekDays.filter((item) => item !== day)
                        : WEEK_DAYS.filter((item) => item === day || value.weekDays.includes(item)),
                    })}
                  />
                  {WEEK_DAY_LABELS[day]}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {value.preset !== "none" && !readOnly ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs text-text-secondary">
            Окончание
            <select
              aria-label="Окончание повторения"
              className={`${SELECT_CLASS} mt-1`}
              value={value.end.kind}
              disabled={locked}
              onChange={(event) => {
                const kind = event.target.value as RecurrenceDraft["end"]["kind"];
                if (kind === "never") onChange({ ...value, sourceRule: undefined, end: { kind: "never" } });
                else if (kind === "until") {
                  onChange({
                    ...value,
                    sourceRule: undefined,
                    end: { kind: "until", date: value.end.kind === "until" ? value.end.date : eventStartDate },
                  });
                } else {
                  onChange({
                    ...value,
                    sourceRule: undefined,
                    end: { kind: "count", count: value.end.kind === "count" ? value.end.count : 10 },
                  });
                }
              }}
            >
              <option value="never">Никогда</option>
              <option value="until">До даты</option>
              <option value="count">После числа повторений</option>
            </select>
          </label>
          {value.end.kind === "until" ? (
            <label className="block text-xs text-text-secondary">
              Дата окончания
              <input
                type="date"
                aria-label="Дата окончания повторения"
                className={`${SELECT_CLASS} mt-1`}
                value={value.end.date}
                disabled={locked}
                onChange={(event) => onChange({
                  ...value,
                  sourceRule: undefined,
                  end: { kind: "until", date: event.target.value },
                })}
              />
            </label>
          ) : null}
          {value.end.kind === "count" ? (
            <label className="block text-xs text-text-secondary">
              Число повторений
              <input
                type="number"
                min={1}
                step={1}
                aria-label="Число повторений"
                className={`${SELECT_CLASS} mt-1`}
                value={value.end.count}
                disabled={locked}
                onChange={(event) => onChange({
                  ...value,
                  sourceRule: undefined,
                  end: { kind: "count", count: Number(event.target.value) },
                })}
              />
            </label>
          ) : null}
        </div>
      ) : null}

      <p data-testid="recurrence-summary" className="text-sm text-text-secondary">{summary}</p>
      {readOnly ? (
        <p className="text-xs text-text-tertiary">Правило серии нельзя изменить при правке одного повторения.</p>
      ) : null}
      {errors.length > 0 && !readOnly ? (
        <p role="alert" className="text-xs text-danger">{errors[0]}</p>
      ) : null}
    </fieldset>
  );
}
