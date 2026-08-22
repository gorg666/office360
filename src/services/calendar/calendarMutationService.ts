import { classifyError } from "@/utils/networkErrors";
import { getCalendarProvider } from "./providerFactory";
import {
  normalizeCalendarReminderPolicy,
  supportsRecurrenceScope,
  parseOccurrenceKey,
  type CalendarProviderCapabilities,
  type RecurrenceWriteScope,
} from "./domain";
import type {
  CalendarEventData,
  CalendarParticipationStatus,
  CreateEventInput,
  UpdateEventInput,
  RecurringMutationContext,
} from "./types";

export type CalendarWriteFailureStatus =
  | "unsupported"
  | "permission-denied"
  | "auth-required"
  | "conflict"
  | "network-error"
  | "partial"
  | "provider-error";

export type CalendarWriteResult<T> =
  | { status: "success"; value: T }
  | { status: CalendarWriteFailureStatus; message: string };

export interface CalendarMutationTarget {
  accountId: string;
  calendarRemoteId: string;
  remoteEventId: string;
  etag?: string;
  baseSequence?: number;
  isRecurring?: boolean;
  recurrenceScope?: RecurrenceWriteScope;
  seriesUid?: string;
  occurrenceKey?: string;
}

export class CalendarMutationService {
  async capabilities(accountId: string): Promise<CalendarProviderCapabilities> {
    return (await getCalendarProvider(accountId)).capabilities;
  }

  async create(
    accountId: string,
    calendarRemoteId: string,
    event: CreateEventInput,
  ): Promise<CalendarWriteResult<CalendarEventData>> {
    try {
      const provider = await getCalendarProvider(accountId);
      if (provider.capabilities.events.create !== "remote") {
        return unsupported("Создание событий не поддерживается этим календарём");
      }
      const reminderFailure = validateReminderWrite(provider.capabilities, event.reminders);
      if (reminderFailure) return reminderFailure;
      return runWrite(() => provider.createEvent(calendarRemoteId, event));
    } catch (error) {
      return classifyWriteFailure(error);
    }
  }

  async update(
    target: CalendarMutationTarget,
    event: UpdateEventInput,
  ): Promise<CalendarWriteResult<CalendarEventData>> {
    try {
      const provider = await getCalendarProvider(target.accountId);
      if (provider.capabilities.events.update !== "remote") {
        return unsupported("Изменение событий не поддерживается этим календарём");
      }
      const reminderFailure = validateReminderWrite(provider.capabilities, event.reminders);
      if (reminderFailure) return reminderFailure;
      const recurrence = recurringMutationContext(provider.capabilities, "update", target);
      if (recurrence && "status" in recurrence) return recurrence;
      if (event.recurrenceRule !== undefined && recurrence?.scope !== "series") {
        return unsupported("Правило повторения можно изменить только для всей серии");
      }
      const safeEvent = target.baseSequence === undefined
        ? event
        : { ...event, sequence: Math.max(event.sequence ?? 0, target.baseSequence + 1) };
      return runWrite(() => provider.updateEvent(
        target.calendarRemoteId,
        target.remoteEventId,
        safeEvent,
        target.etag,
        recurrence ?? undefined,
      ));
    } catch (error) {
      return classifyWriteFailure(error);
    }
  }

  async delete(target: CalendarMutationTarget): Promise<CalendarWriteResult<void>> {
    try {
      const provider = await getCalendarProvider(target.accountId);
      if (provider.capabilities.events.delete !== "remote") {
        return unsupported("Удаление событий не поддерживается этим календарём");
      }
      const recurrence = recurringMutationContext(provider.capabilities, "delete", target);
      if (recurrence && "status" in recurrence) return recurrence;
      return runWrite(() => provider.deleteEvent(
        target.calendarRemoteId,
        target.remoteEventId,
        target.etag,
        recurrence ?? undefined,
      ));
    } catch (error) {
      return classifyWriteFailure(error);
    }
  }

  async respond(
    target: Omit<CalendarMutationTarget, "isRecurring" | "recurrenceScope">,
    attendeeEmail: string,
    status: CalendarParticipationStatus,
  ): Promise<CalendarWriteResult<void>> {
    try {
      const provider = await getCalendarProvider(target.accountId);
      if (provider.capabilities.rsvp.remote !== "direct") {
        return unsupported("Удалённый ответ на приглашение не поддерживается этим календарём");
      }
      return runWrite(() => provider.respondToEvent(
        target.calendarRemoteId,
        target.remoteEventId,
        attendeeEmail,
        status,
        target.etag,
      ));
    } catch (error) {
      return classifyWriteFailure(error);
    }
  }
}

function validateReminderWrite(
  capabilities: CalendarProviderCapabilities,
  reminders: CreateEventInput["reminders"],
): CalendarWriteResult<never> | null {
  if (reminders === undefined) return null;
  const capability = capabilities.reminders;
  if (capability.write === "none") {
    return unsupported("Этот календарь не поддерживает изменение напоминаний");
  }
  if (reminders.kind === "inherit") {
    return capability.defaults === "inherit"
      ? null
      : unsupported("Этот календарь не поддерживает напоминания по умолчанию");
  }
  if (reminders.kind === "none") return null;

  const normalized = normalizeCalendarReminderPolicy(reminders);
  if (normalized.kind !== "custom" || normalized.reminders.length === 0) {
    return unsupported("Укажите хотя бы одно корректное напоминание");
  }
  if (!capability.multiple && normalized.reminders.length > 1) {
    return unsupported("Этот календарь поддерживает только одно напоминание");
  }
  if (capability.maxCount !== null && normalized.reminders.length > capability.maxCount) {
    return unsupported(`Этот календарь поддерживает не более ${capability.maxCount} напоминаний`);
  }
  if (normalized.reminders.some((reminder) => !capability.methods.includes(reminder.method))) {
    return unsupported("Выбранный способ напоминания не поддерживается этим календарём");
  }
  return null;
}

function recurringMutationContext(
  capabilities: CalendarProviderCapabilities,
  operation: "update" | "delete",
  target: CalendarMutationTarget,
): CalendarWriteResult<never> | RecurringMutationContext | null {
  if (!target.isRecurring) return null;
  const scope = target.recurrenceScope;
  if (!scope) {
    return unsupported("Для повторяющегося события требуется явная область изменения");
  }
  if (!supportsRecurrenceScope(capabilities, operation, scope)) {
    const action = operation === "delete" ? "удаление" : "изменение";
    return unsupported(`Этот календарь не поддерживает ${action} выбранной части серии`);
  }
  if (!target.seriesUid) return unsupported("Для повторяющейся серии отсутствует стабильный UID");
  if (scope === "series") return { scope, seriesUid: target.seriesUid };
  if (!target.occurrenceKey) return unsupported("Для отдельного повторения отсутствует occurrence identity");
  try {
    const occurrence = parseOccurrenceKey(target.occurrenceKey);
    if (occurrence.seriesUid !== target.seriesUid) {
      return unsupported("Occurrence identity не принадлежит выбранной серии");
    }
    return { scope, seriesUid: target.seriesUid, occurrence: { key: target.occurrenceKey, identity: occurrence.identity } };
  } catch {
    return unsupported("Occurrence identity повреждён или не поддерживается");
  }
}

async function runWrite<T>(operation: () => Promise<T>): Promise<CalendarWriteResult<T>> {
  try {
    return { status: "success", value: await operation() };
  } catch (error) {
    return classifyWriteFailure(error);
  }
}

export function classifyWriteFailure(error: unknown): CalendarWriteResult<never> {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  if (/\b(409|412)\b/.test(lower) || lower.includes("precondition failed")) {
    return { status: "conflict", message: "Событие изменилось на сервере. Обновите календарь и повторите действие." };
  }
  if (/\b401\b/.test(lower)) {
    return { status: "auth-required", message: "Сессия календаря истекла. Подключите аккаунт повторно." };
  }
  if (/\b403\b/.test(lower) || lower.includes("permission")) {
    return { status: "permission-denied", message: "Недостаточно прав для изменения этого календаря." };
  }

  const classified = classifyError(error);
  if (classified.type === "auth") {
    return { status: "auth-required", message: "Сессия календаря истекла. Подключите аккаунт повторно." };
  }
  if (classified.isRetryable || classified.type === "network" || classified.type === "server") {
    return { status: "network-error", message: "Не удалось связаться с сервером календаря. Повторите попытку." };
  }
  return { status: "provider-error", message: "Не удалось выполнить операцию с календарём." };
}

function unsupported(message: string): CalendarWriteResult<never> {
  return { status: "unsupported", message };
}

export const calendarMutationService = new CalendarMutationService();
