import { useState } from "react";
import type {
  CalendarProviderCapabilities,
  CalendarReminderMethod,
  CalendarReminderPolicy,
} from "@/services/calendar/domain";
import { createCalendarReminder, normalizeCalendarReminderPolicy } from "@/services/calendar/domain";

interface ReminderEditorProps {
  capabilities: CalendarProviderCapabilities | null;
  value: CalendarReminderPolicy | null;
  onChange: (value: CalendarReminderPolicy) => void;
}

const PRESETS = [0, 5, 10, 15, 30, 60, 120, 1440] as const;

export function ReminderEditor({ capabilities, value, onChange }: ReminderEditorProps) {
  const [customValue, setCustomValue] = useState("1");
  const [customUnit, setCustomUnit] = useState<"minutes" | "hours" | "days">("hours");
  const [customMethod, setCustomMethod] = useState<CalendarReminderMethod>("notification");
  const reminderCapability = capabilities?.reminders;
  if (!reminderCapability || reminderCapability.write === "none") return null;
  const custom = value?.kind === "custom" ? value.reminders : [];
  const maxCount = reminderCapability.maxCount ?? 10;

  const setKind = (kind: "unknown" | "inherit" | "none" | "custom") => {
    if (kind === "unknown") return;
    if (kind === "inherit") onChange({ kind });
    else if (kind === "none") onChange({ kind });
    else onChange({ kind, reminders: [createCalendarReminder(15, "minutes", reminderCapability.methods[0] ?? "notification")] });
  };

  const replaceReminder = (index: number, minutes: number, method: CalendarReminderMethod) => {
    const reminders = custom.map((reminder, reminderIndex) => reminderIndex === index
      ? createCalendarReminder(minutes, "minutes", method)
      : reminder);
    onChange(normalizeCalendarReminderPolicy({ kind: "custom", reminders }));
  };

  return (
    <fieldset className="space-y-2 rounded-md border border-border-primary p-3" data-testid="reminder-editor">
      <legend className="px-1 text-xs text-text-secondary">Напоминания</legend>
      <select
        aria-label="Политика напоминаний"
        value={value?.kind ?? "unknown"}
        onChange={(event) => setKind(event.target.value as "unknown" | "inherit" | "none" | "custom")}
        className="w-full rounded border border-border-primary bg-bg-tertiary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
      >
        {value === null && <option value="unknown">Не загружено — оставить без изменений</option>}
        {reminderCapability.defaults === "inherit" && <option value="inherit">По умолчанию календаря</option>}
        <option value="none">Без напоминаний</option>
        <option value="custom">Настроить</option>
      </select>

      {value?.kind === "custom" && custom.map((reminder, index) => {
        const minutes = reminder.trigger.duration.seconds / 60;
        return (
          <div key={`${reminder.method}:${minutes}:${index}`} className="grid grid-cols-[1fr_9rem_auto] gap-2">
            <select
              aria-label={`Время напоминания ${index + 1}`}
              value={PRESETS.includes(minutes as typeof PRESETS[number]) ? String(minutes) : "custom"}
              onChange={(event) => {
                const next = event.target.value === "custom" ? minutes : Number(event.target.value);
                replaceReminder(index, next, reminder.method);
              }}
              className="rounded border border-border-primary bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary"
            >
              {PRESETS.map((preset) => <option key={preset} value={preset}>{formatMinutes(preset)}</option>)}
              {!PRESETS.includes(minutes as typeof PRESETS[number]) && <option value="custom">{formatMinutes(minutes)}</option>}
            </select>
            <select
              aria-label={`Способ напоминания ${index + 1}`}
              value={reminder.method}
              onChange={(event) => replaceReminder(index, minutes, event.target.value as CalendarReminderMethod)}
              className="rounded border border-border-primary bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary"
            >
              {reminderCapability.methods.includes("notification") && <option value="notification">Уведомление</option>}
              {reminderCapability.methods.includes("email") && <option value="email">Email</option>}
            </select>
            <button
              type="button"
              aria-label={`Удалить напоминание ${index + 1}`}
              className="rounded px-2 text-text-tertiary hover:bg-bg-hover hover:text-danger"
              onClick={() => onChange(normalizeCalendarReminderPolicy({ kind: "custom", reminders: custom.filter((_, itemIndex) => itemIndex !== index) }))}
            >×</button>
          </div>
        );
      })}

      {value?.kind === "custom" && reminderCapability.multiple && custom.length < maxCount && (
        <div className="space-y-2 border-t border-border-primary pt-2">
          <div className="grid grid-cols-[5rem_1fr_9rem] gap-2">
            <input
              aria-label="Своё время напоминания"
              type="number"
              min="1"
              max={customUnit === "days" ? 28 : customUnit === "hours" ? 672 : 40320}
              step="1"
              value={customValue}
              onChange={(event) => setCustomValue(event.target.value)}
              className="rounded border border-border-primary bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary"
            />
            <select aria-label="Единица времени напоминания" value={customUnit} onChange={(event) => setCustomUnit(event.target.value as typeof customUnit)} className="rounded border border-border-primary bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary">
              <option value="minutes">минут</option><option value="hours">часов</option><option value="days">дней</option>
            </select>
            <select aria-label="Способ своего напоминания" value={customMethod} onChange={(event) => setCustomMethod(event.target.value as CalendarReminderMethod)} className="rounded border border-border-primary bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary">
              {reminderCapability.methods.includes("notification") && <option value="notification">Уведомление</option>}
              {reminderCapability.methods.includes("email") && <option value="email">Email</option>}
            </select>
          </div>
          <button
            type="button"
            className="text-xs font-medium text-accent hover:underline disabled:text-text-tertiary disabled:no-underline"
            disabled={!isValidCustomValue(customValue, customUnit)}
            onClick={() => onChange(normalizeCalendarReminderPolicy({
              kind: "custom",
              reminders: [...custom, createCalendarReminder(Number(customValue), customUnit, customMethod)],
            }))}
          >+ Добавить своё</button>
          <button
            type="button"
            className="ml-3 text-xs font-medium text-accent hover:underline"
            onClick={() => onChange(normalizeCalendarReminderPolicy({
              kind: "custom",
              reminders: [...custom, createCalendarReminder(nextUnusedPreset(custom.map((item) => item.trigger.duration.seconds / 60)), "minutes", reminderCapability.methods[0] ?? "notification")],
            }))}
          >+ Быстро добавить</button>
        </div>
      )}
    </fieldset>
  );
}

export function formatReminderPolicy(policy: CalendarReminderPolicy | null): string | null {
  if (!policy) return null;
  if (policy.kind === "inherit") return "По умолчанию календаря";
  if (policy.kind === "none") return "Нет";
  return policy.reminders.map((reminder) => `${formatMinutes(reminder.trigger.duration.seconds / 60)} · ${reminder.method === "email" ? "Email" : "уведомление"}`).join(", ");
}

function nextUnusedPreset(existing: number[]): number {
  return PRESETS.find((preset) => !existing.includes(preset)) ?? 15;
}

function formatMinutes(minutes: number): string {
  if (minutes === 0) return "В момент начала";
  if (minutes % 1440 === 0) return `За ${minutes / 1440} дн.`;
  if (minutes % 60 === 0) return `За ${minutes / 60} ч.`;
  return `За ${minutes} мин.`;
}

function isValidCustomValue(value: string, unit: "minutes" | "hours" | "days"): boolean {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return false;
  const seconds = numeric * (unit === "minutes" ? 60 : unit === "hours" ? 3600 : 86400);
  return seconds <= 28 * 86400;
}
