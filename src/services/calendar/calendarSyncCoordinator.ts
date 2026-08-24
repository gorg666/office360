import {
  accessForCalendar,
  getVisibleCalendars,
  markMissingProviderCalendarsRemoved,
  updateCalendarSyncToken,
  upsertCalendar,
  type DbCalendar,
} from "@/services/db/calendars";
import { applyCalendarSyncBatch, reconcileCalendarEventsRange } from "@/services/db/calendarEvents";
import { redactLogIdentifier } from "@/services/diagnostics";
import { getCalendarProvider, hasCalendarSupport } from "./providerFactory";
import type { CalendarProvider, CalendarReadDiagnostics } from "./types";
import { CalendarOfflineError } from "./calendarOfflinePolicy";

export type CalendarSyncReason = "background" | "startup" | "manual" | "foreground" | "reconnect";

export interface CalendarRangeRefreshResult {
  diagnostics: CalendarReadDiagnostics;
}

interface CoordinatorDependencies {
  hasCalendarSupport: typeof hasCalendarSupport;
  getCalendarProvider: typeof getCalendarProvider;
  getVisibleCalendars: typeof getVisibleCalendars;
  upsertCalendar: typeof upsertCalendar;
  markMissingProviderCalendarsRemoved: typeof markMissingProviderCalendarsRemoved;
  updateCalendarSyncToken: typeof updateCalendarSyncToken;
  applyCalendarSyncBatch: typeof applyCalendarSyncBatch;
  reconcileCalendarEventsRange: typeof reconcileCalendarEventsRange;
  online: () => boolean;
}

const defaultDependencies: CoordinatorDependencies = {
  hasCalendarSupport,
  getCalendarProvider,
  getVisibleCalendars,
  upsertCalendar,
  markMissingProviderCalendarsRemoved,
  updateCalendarSyncToken,
  applyCalendarSyncBatch,
  reconcileCalendarEventsRange,
  online: () => typeof navigator === "undefined" || navigator.onLine,
};

/** Owns every Calendar provider refresh. Delta cursor consumption is single-flight per account. */
export class CalendarSyncCoordinator {
  private readonly deltaFlights = new Map<string, Promise<void>>();
  private readonly rangeFlights = new Map<string, Promise<CalendarRangeRefreshResult>>();

  constructor(private readonly dependencies: CoordinatorDependencies = defaultDependencies) {}

  syncAccount(accountId: string, reason: CalendarSyncReason = "background"): Promise<void> {
    if (!this.dependencies.online()) return Promise.reject(new CalendarOfflineError());
    const existing = this.deltaFlights.get(accountId);
    if (existing) {
      this.log("single_flight_reused", accountId, reason);
      return existing;
    }
    this.log("sync_started", accountId, reason);
    const flight = this.syncAccountOnce(accountId).finally(() => {
      if (this.deltaFlights.get(accountId) === flight) this.deltaFlights.delete(accountId);
    });
    this.deltaFlights.set(accountId, flight);
    return flight;
  }

  async refreshRange(input: {
    accountId: string;
    rangeStart: Date;
    rangeEnd: Date;
    reason?: CalendarSyncReason;
  }): Promise<CalendarRangeRefreshResult> {
    if (!this.dependencies.online()) throw new CalendarOfflineError();
    await this.syncAccount(input.accountId, input.reason ?? "foreground");
    const key = `${input.accountId}:${input.rangeStart.toISOString()}:${input.rangeEnd.toISOString()}`;
    const existing = this.rangeFlights.get(key);
    if (existing) return existing;
    const flight = this.refreshRangeOnce(input).finally(() => {
      if (this.rangeFlights.get(key) === flight) this.rangeFlights.delete(key);
    });
    this.rangeFlights.set(key, flight);
    return flight;
  }

  private async syncAccountOnce(accountId: string): Promise<void> {
    if (!await this.dependencies.hasCalendarSupport(accountId)) return;
    const provider = await this.dependencies.getCalendarProvider(accountId);
    await this.discover(accountId, provider);
    const calendars = readableVisible(await this.dependencies.getVisibleCalendars(accountId));
    const failures: unknown[] = [];
    for (const calendar of calendars) {
      try {
        let result = await provider.syncEvents(calendar.remote_id, calendar.sync_token ?? undefined);
        if (result.cursorInvalidated) {
          this.log("cursor_invalidated", accountId, "background", calendar.id);
          await this.dependencies.updateCalendarSyncToken(calendar.id, null, null);
          result = await provider.syncEvents(calendar.remote_id);
          if (result.cursorInvalidated) throw new Error("Provider cursor remained invalid after initial recovery");
          this.log("full_recovery", accountId, "background", calendar.id);
        }
        if (result.strategy === "range-refresh" && result.coverageRange) {
          await this.dependencies.reconcileCalendarEventsRange({
            accountId,
            calendarId: calendar.id,
            rangeStart: result.coverageRange.start,
            rangeEnd: result.coverageRange.end,
            events: [...result.created, ...result.updated],
            diagnostics: result.diagnostics ?? emptyDiagnostics(),
          });
        } else {
          await this.dependencies.applyCalendarSyncBatch({ accountId, calendarId: calendar.id, result });
        }
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw failures[0];
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("office360-calendar-reminders-reconcile"));
    }
  }

  private async refreshRangeOnce(input: {
    accountId: string;
    rangeStart: Date;
    rangeEnd: Date;
  }): Promise<CalendarRangeRefreshResult> {
    const provider = await this.dependencies.getCalendarProvider(input.accountId);
    const calendars = readableVisible(await this.dependencies.getVisibleCalendars(input.accountId));
    const diagnostics = emptyDiagnostics();
    for (const calendar of calendars) {
      const events = await provider.fetchEvents(
        calendar.remote_id,
        input.rangeStart.toISOString(),
        input.rangeEnd.toISOString(),
      );
      const current = provider.lastReadDiagnostics ?? emptyDiagnostics();
      diagnostics.unreadableComponentCount += current.unreadableComponentCount;
      diagnostics.unreadableObjectCount += current.unreadableObjectCount;
      await this.dependencies.reconcileCalendarEventsRange({
        accountId: input.accountId,
        calendarId: calendar.id,
        rangeStart: Math.floor(input.rangeStart.getTime() / 1000),
        rangeEnd: Math.floor(input.rangeEnd.getTime() / 1000),
        events,
        diagnostics: { ...current },
      });
    }
    return { diagnostics };
  }

  private async discover(accountId: string, provider: CalendarProvider): Promise<void> {
    const remote = await provider.listCalendars();
    const observedAt = Math.floor(Date.now() / 1000);
    for (const calendar of remote) {
      await this.dependencies.upsertCalendar({
        accountId,
        provider: provider.type,
        remoteId: calendar.remoteId,
        displayName: calendar.displayName,
        color: calendar.color,
        isPrimary: calendar.isPrimary,
        access: calendar.access,
        observedAt,
      });
    }
    await this.dependencies.markMissingProviderCalendarsRemoved(
      accountId,
      provider.type,
      remote.map((calendar) => calendar.remoteId),
    );
  }

  private log(event: string, accountId: string, reason: CalendarSyncReason, calendarId?: string): void {
    console.info("[calendar-sync]", {
      event,
      accountId: redactLogIdentifier(accountId),
      calendarId: calendarId ? redactLogIdentifier(calendarId) : undefined,
      reason,
    });
  }
}

function readableVisible(calendars: DbCalendar[]): DbCalendar[] {
  return calendars.filter((calendar) => {
    const permissions = accessForCalendar(calendar).permissions;
    return permissions.canRead && permissions.canSeeEventDetails && calendar.provider_presence !== "removed";
  });
}

function emptyDiagnostics(): CalendarReadDiagnostics {
  return { unreadableComponentCount: 0, unreadableObjectCount: 0 };
}

export const calendarSyncCoordinator = new CalendarSyncCoordinator();
