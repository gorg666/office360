import { classifyError } from "@/utils/networkErrors";
import { getCalendarProvider } from "./providerFactory";
import {
  supportsRecurrenceScope,
  type CalendarProviderCapabilities,
  type RecurrenceWriteScope,
} from "./domain";
import type {
  CalendarEventData,
  CalendarParticipationStatus,
  CreateEventInput,
  UpdateEventInput,
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
      const scopeFailure = recurrenceScopeFailure(provider.capabilities, "update", target);
      if (scopeFailure) return scopeFailure;
      const safeEvent = target.baseSequence === undefined
        ? event
        : { ...event, sequence: Math.max(event.sequence ?? 0, target.baseSequence + 1) };
      return runWrite(() => provider.updateEvent(
        target.calendarRemoteId,
        target.remoteEventId,
        safeEvent,
        target.etag,
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
      const scopeFailure = recurrenceScopeFailure(provider.capabilities, "delete", target);
      if (scopeFailure) return scopeFailure;
      return runWrite(() => provider.deleteEvent(
        target.calendarRemoteId,
        target.remoteEventId,
        target.etag,
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

function recurrenceScopeFailure(
  capabilities: CalendarProviderCapabilities,
  operation: "update" | "delete",
  target: CalendarMutationTarget,
): CalendarWriteResult<never> | null {
  if (!target.isRecurring) return null;
  if (!target.recurrenceScope) {
    return unsupported("Для повторяющегося события требуется явная область изменения");
  }
  if (!supportsRecurrenceScope(capabilities, operation, target.recurrenceScope)) {
    const action = operation === "delete" ? "удаление" : "изменение";
    return unsupported(`Этот календарь не поддерживает ${action} выбранной части серии`);
  }
  return null;
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
