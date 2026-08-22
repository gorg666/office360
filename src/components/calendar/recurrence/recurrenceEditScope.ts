import type { CalendarWriteFailureStatus, CalendarWriteResult } from "@/services/calendar/calendarMutationService";
import { supportsRecurrenceScope, type CalendarProviderCapabilities, type RecurrenceWriteScope } from "@/services/calendar/domain";

export type RecurringEditKind = "plain" | "series-master" | "occurrence";

export interface RecurringEditTarget {
  kind: RecurringEditKind;
  seriesUid?: string;
  occurrenceKey?: string;
}

export interface RecurrenceScopeChoice {
  scope: RecurrenceWriteScope;
  enabled: boolean;
  label: string;
  description?: string;
}

/** Stable offer order. `this-and-future` appears only when the capability is supported. */
export const RECURRENCE_SCOPE_ORDER: readonly RecurrenceWriteScope[] = ["single", "series", "this-and-future"];

export function classifyRecurringEditTarget(event: {
  is_recurrence_master: number;
  occurrence_key: string | null;
  series_uid: string | null;
  uid: string | null;
}): RecurringEditTarget {
  const seriesUid = event.series_uid ?? event.uid ?? undefined;
  if (event.occurrence_key) {
    return { kind: "occurrence", seriesUid, occurrenceKey: event.occurrence_key };
  }
  if (event.is_recurrence_master === 1) {
    return { kind: "series-master", seriesUid };
  }
  return { kind: "plain" };
}

export function recurrenceScopeChoices(
  capabilities: CalendarProviderCapabilities | null,
  operation: "update" | "delete",
  target: RecurringEditTarget,
): RecurrenceScopeChoice[] {
  if (!capabilities || target.kind === "plain") return [];
  return RECURRENCE_SCOPE_ORDER.flatMap((scope) => {
    if (scope === "single" && (target.kind !== "occurrence" || !target.occurrenceKey)) return [];
    if (!supportsRecurrenceScope(capabilities, operation, scope)) return [];
    return [{
      scope,
      enabled: true,
      label: scopeLabel(scope),
      description: operation === "delete" ? scopeDeleteDescription(scope) : undefined,
    }];
  });
}

export function defaultRecurrenceScope(choices: RecurrenceScopeChoice[]): RecurrenceWriteScope | null {
  const enabled = choices.filter((choice) => choice.enabled);
  return enabled.find((choice) => choice.scope === "single")?.scope ?? enabled[0]?.scope ?? null;
}

export function canMutateRecurring(
  capabilities: CalendarProviderCapabilities | null,
  operation: "update" | "delete",
  target: RecurringEditTarget,
): boolean {
  if (!capabilities || capabilities.events[operation] !== "remote") return false;
  if (target.kind === "plain") return true;
  return recurrenceScopeChoices(capabilities, operation, target).some((choice) => choice.enabled);
}

export function writeFailureCopy(
  result: Extract<CalendarWriteResult<unknown>, { status: CalendarWriteFailureStatus }>,
): string {
  switch (result.status) {
    case "conflict":
      return "Событие было изменено в другом месте. Обновите данные и попробуйте снова.";
    case "unsupported":
      return "Этот способ изменения не поддерживается календарём.";
    case "permission-denied":
      return "Недостаточно прав для изменения этого календаря.";
    case "auth-required":
      return "Сессия календаря истекла. Подключите аккаунт повторно.";
    case "network-error":
      return "Не удалось связаться с сервером календаря. Повторите попытку.";
    default:
      return "Не удалось выполнить операцию с календарём.";
  }
}

function scopeLabel(scope: RecurrenceWriteScope): string {
  if (scope === "single") return "Только это событие";
  if (scope === "series") return "Всю серию";
  return "Это и последующие события";
}

function scopeDeleteDescription(scope: RecurrenceWriteScope): string | undefined {
  if (scope === "single") return "Удалить только выбранное событие из серии";
  if (scope === "series") return "Удалить всю серию событий";
  return "Удалить это и все последующие события серии";
}
