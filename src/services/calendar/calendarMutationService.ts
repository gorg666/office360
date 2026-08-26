import { classifyError } from "@/utils/networkErrors";
import { getCalendarProvider } from "./providerFactory";
import { accessForCalendar, getCalendarByRemoteId } from "@/services/db/calendars";
import { getEventByRemoteId } from "@/services/db/calendarEvents";
import { refreshCalendarAccess } from "./calendarAccessService";
import {
  normalizeCalendarReminderPolicy,
  normalizeParticipantEmail,
  supportsRecurrenceScope,
  parseOccurrenceKey,
  formatICalCalendarDate,
  formatICalWallDateTime,
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
import type { CalendarProvider } from "./types";
import { isCalendarOffline } from "./calendarOfflinePolicy";

export type CalendarWriteFailureStatus =
  | "unsupported"
  | "permission-denied"
  | "read-only"
  | "calendar-unavailable"
  | "auth-required"
  | "conflict"
  | "network-error"
  | "offline"
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
  /** Internal reconciliation writes must not emit a second invitation message. */
  suppressInvitationDelivery?: boolean;
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
    if (isCalendarOffline()) return offlineWriteUnsupported();
    try {
      const provider = await getCalendarProvider(accountId);
      if (provider.capabilities.events.create !== "remote") {
        return unsupported("Создание событий не поддерживается этим календарём");
      }
      const permissionFailure = await requireCalendarPermission(accountId, calendarRemoteId, "canCreate");
      if (permissionFailure) return permissionFailure;
      const reminderFailure = validateReminderWrite(provider.capabilities, event.reminders);
      if (reminderFailure) return reminderFailure;
      const result = await runCalendarWrite(accountId, provider, () => provider.createEvent(calendarRemoteId, event));
      if (result.status !== "success" || !result.value.attendees?.length) return result;
      const calendar = await getCalendarByRemoteId(accountId, calendarRemoteId);
      return deliverInvitation(result, () => queueCalendarDelivery({
        accountId,
        calendarId: calendar?.id ?? null,
        method: "REQUEST",
        event: result.value,
        allowMissingOrganizer: true,
      }));
    } catch (error) {
      return classifyWriteFailure(error);
    }
  }

  async update(
    target: CalendarMutationTarget,
    event: UpdateEventInput,
  ): Promise<CalendarWriteResult<CalendarEventData>> {
    if (isCalendarOffline()) return offlineWriteUnsupported();
    try {
      const provider = await getCalendarProvider(target.accountId);
      if (provider.capabilities.events.update !== "remote") {
        return unsupported("Изменение событий не поддерживается этим календарём");
      }
      const permissionFailure = await requireCalendarPermission(target.accountId, target.calendarRemoteId, "canUpdate");
      if (permissionFailure) return permissionFailure;
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
      const calendar = await getCalendarByRemoteId(target.accountId, target.calendarRemoteId);
      const previous = calendar
        ? await getEventByRemoteId(calendar.id, target.remoteEventId).catch(() => null)
        : null;
      const result = await runCalendarWrite(target.accountId, provider, () => provider.updateEvent(
        target.calendarRemoteId,
        target.remoteEventId,
        safeEvent,
        target.etag,
        recurrence ?? undefined,
      ));
      if (result.status !== "success" || target.suppressInvitationDelivery || !Array.isArray(result.value.attendees)) return result;
      return deliverInvitation(result, async () => {
        const itip = await import("./itip/lifecycle");
        const currentRecipients = participantKeys(result.value.attendees);
        if (currentRecipients.length) {
          await itip.queueEventInvitationDeliveries({
            accountId: target.accountId,
            calendarId: calendar?.id ?? null,
            method: "REQUEST",
            event: result.value,
            ...recurrenceDeliveryForTarget(target),
          });
        }
        if (previous) {
          const previousEvent = itip.invitationEnvelopeFromDbEvent(previous);
          const removed = participantKeys(previousEvent.attendees).filter((key) => !currentRecipients.includes(key));
          if (removed.length) {
            await itip.queueEventInvitationDeliveries({
              accountId: target.accountId,
              calendarId: calendar?.id ?? null,
              method: "CANCEL",
              event: previousEvent,
              recipients: removed,
              sequence: result.value.sequence,
              ...recurrenceDeliveryForTarget(target),
            });
          }
        }
      });
    } catch (error) {
      return classifyWriteFailure(error);
    }
  }

  async delete(target: CalendarMutationTarget): Promise<CalendarWriteResult<void>> {
    if (isCalendarOffline()) return offlineWriteUnsupported();
    try {
      const provider = await getCalendarProvider(target.accountId);
      if (provider.capabilities.events.delete !== "remote") {
        return unsupported("Удаление событий не поддерживается этим календарём");
      }
      const permissionFailure = await requireCalendarPermission(target.accountId, target.calendarRemoteId, "canDelete");
      if (permissionFailure) return permissionFailure;
      const recurrence = recurringMutationContext(provider.capabilities, "delete", target);
      if (recurrence && "status" in recurrence) return recurrence;
      const calendar = await getCalendarByRemoteId(target.accountId, target.calendarRemoteId);
      const previous = calendar
        ? await getEventByRemoteId(calendar.id, target.remoteEventId).catch(() => null)
        : null;
      const result = await runCalendarWrite(target.accountId, provider, () => provider.deleteEvent(
        target.calendarRemoteId,
        target.remoteEventId,
        target.etag,
        recurrence ?? undefined,
      ));
      if (result.status !== "success" || target.suppressInvitationDelivery || !previous) return result;
      return deliverInvitation(result, async () => {
        const itip = await import("./itip/lifecycle");
        const previousEvent = itip.invitationEnvelopeFromDbEvent(previous);
        await itip.queueEventInvitationDeliveries({
          accountId: target.accountId,
          calendarId: calendar?.id ?? null,
          method: "CANCEL",
          event: previousEvent,
          sequence: Math.max(previousEvent.sequence + 1, target.baseSequence === undefined ? 0 : target.baseSequence + 1),
          ...recurrenceDeliveryForTarget(target),
        });
      });
    } catch (error) {
      return classifyWriteFailure(error);
    }
  }

  async respond(
    target: Omit<CalendarMutationTarget, "isRecurring" | "recurrenceScope">,
    attendeeEmail: string,
    status: CalendarParticipationStatus,
  ): Promise<CalendarWriteResult<void>> {
    if (isCalendarOffline()) return offlineWriteUnsupported();
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

type WritePermission = "canCreate" | "canUpdate" | "canDelete";

async function requireCalendarPermission(
  accountId: string,
  calendarRemoteId: string,
  permission: WritePermission,
): Promise<CalendarWriteResult<never> | null> {
  const calendar = await getCalendarByRemoteId(accountId, calendarRemoteId);
  if (!calendar) {
    return { status: "calendar-unavailable", message: "Календарь больше недоступен. Обновите список календарей." };
  }
  if (!accessForCalendar(calendar).permissions[permission]) {
    return { status: "read-only", message: "Этот календарь доступен только для чтения." };
  }
  return null;
}

async function runCalendarWrite<T>(
  accountId: string,
  provider: CalendarProvider,
  operation: () => Promise<T>,
): Promise<CalendarWriteResult<T>> {
  const result = await runWrite(operation);
  if (result.status === "permission-denied") {
    // Reconcile effective permissions once, without retrying a non-idempotent write.
    await refreshCalendarAccess(accountId, provider).catch(() => undefined);
  }
  return result;
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

function offlineWriteUnsupported(): CalendarWriteResult<never> {
  return {
    status: "offline",
    message: "Изменения календаря недоступны без сети. Ничего не было сохранено или поставлено в очередь.",
  };
}

async function deliverInvitation<T>(
  result: Extract<CalendarWriteResult<T>, { status: "success" }>,
  delivery: () => Promise<unknown>,
): Promise<CalendarWriteResult<T>> {
  try {
    await delivery();
    return result;
  } catch {
    return {
      status: "partial",
      message: "Событие сохранено, но приглашение не удалось поставить в очередь отправки.",
    };
  }
}

async function queueCalendarDelivery(input: {
  accountId: string;
  calendarId: string | null;
  method: "REQUEST" | "CANCEL";
  event: CalendarEventData;
  allowMissingOrganizer?: boolean;
}): Promise<void> {
  const itip = await import("./itip/lifecycle");
  await itip.queueEventInvitationDeliveries(input);
}

function participantKeys(attendees: CalendarEventData["attendees"]): string[] {
  return [...new Set(attendees
    .map((attendee) => normalizeParticipantEmail(attendee.participant.normalizedEmail ?? attendee.participant.value))
    .filter(Boolean))];
}

function recurrenceDeliveryForTarget(target: CalendarMutationTarget): {
  recurrenceId: string | null;
  recurrenceTzid?: string | null;
} {
  if (target.recurrenceScope !== "single" || !target.occurrenceKey) return { recurrenceId: null };
  try {
    const { identity } = parseOccurrenceKey(target.occurrenceKey);
    if (identity.kind === "all-day") return { recurrenceId: formatICalCalendarDate(identity.date) };
    return {
      recurrenceId: formatICalWallDateTime(identity.wall),
      recurrenceTzid: identity.kind === "timed-zoned" ? identity.tzid : null,
    };
  } catch {
    return { recurrenceId: null };
  }
}

export const calendarMutationService = new CalendarMutationService();
