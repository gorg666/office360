import {
  getCalendarEventsInRangeMulti,
  reconcileCalendarEventsRange,
  type DbCalendarEvent,
} from "@/services/db/calendarEvents";
import {
  getCalendarsForAccount,
  markMissingProviderCalendarsRemoved,
  upsertCalendar,
  type DbCalendar,
} from "@/services/db/calendars";
import { getCalendarRangeCoverage } from "@/services/db/calendarSyncCoverage";
import { getCalendarProvider, hasCalendarSupport } from "./providerFactory";
import type { CalendarProvider, CalendarReadDiagnostics } from "./types";
import { eventReadableCalendars } from "./calendarAccessService";
import { calendarSyncCoordinator } from "./calendarSyncCoordinator";

export type CalendarRangeLoadStatus = "fresh" | "fresh-with-warnings" | "stale" | "error";
export type CalendarLoadErrorCategory = "calendar-api-disabled" | "permission" | "other" | null;

export interface CalendarRangeSnapshot {
  events: DbCalendarEvent[];
  calendars: DbCalendar[];
  coverage: "never-synced" | "partial" | "complete";
  hasUsableCache: boolean;
}

export interface CalendarRangeLoadResult extends CalendarRangeSnapshot {
  hasCalendar: boolean;
  status: CalendarRangeLoadStatus;
  diagnostics: CalendarReadDiagnostics;
  errorCategory: CalendarLoadErrorCategory;
}

export interface CalendarRangeLoadRequest {
  accountId: string;
  rangeStart: Date;
  rangeEnd: Date;
  onCache?: (snapshot: CalendarRangeSnapshot) => void;
}

interface CalendarSyncDependencies {
  hasCalendarSupport: typeof hasCalendarSupport;
  getCalendarProvider: typeof getCalendarProvider;
  getCalendarsForAccount: typeof getCalendarsForAccount;
  upsertCalendar: typeof upsertCalendar;
  markMissingProviderCalendarsRemoved: typeof markMissingProviderCalendarsRemoved;
  getCalendarEventsInRangeMulti: typeof getCalendarEventsInRangeMulti;
  getCalendarRangeCoverage: typeof getCalendarRangeCoverage;
  reconcileCalendarEventsRange: typeof reconcileCalendarEventsRange;
  refreshRange?: typeof calendarSyncCoordinator.refreshRange;
}

const defaultDependencies: CalendarSyncDependencies = {
  hasCalendarSupport,
  getCalendarProvider,
  getCalendarsForAccount,
  upsertCalendar,
  markMissingProviderCalendarsRemoved,
  getCalendarEventsInRangeMulti,
  getCalendarRangeCoverage,
  reconcileCalendarEventsRange,
  refreshRange: calendarSyncCoordinator.refreshRange.bind(calendarSyncCoordinator),
};

export class CalendarSyncService {
  constructor(private readonly dependencies: CalendarSyncDependencies = defaultDependencies) {}

  async loadRange(request: CalendarRangeLoadRequest): Promise<CalendarRangeLoadResult> {
    const rangeStart = Math.floor(request.rangeStart.getTime() / 1000);
    const rangeEnd = Math.floor(request.rangeEnd.getTime() / 1000);
    let calendars: DbCalendar[] = [];
    let visibleCalendars: DbCalendar[] = [];
    let cache: DbCalendarEvent[] = [];
    let coverage: CalendarRangeSnapshot["coverage"] = "never-synced";
    let hasUsableCache = false;

    try {
      calendars = await this.dependencies.getCalendarsForAccount(request.accountId);
      visibleCalendars = eventReadableCalendars(calendars).filter((calendar) => calendar.is_visible === 1);
      const calendarIds = visibleCalendars.map((calendar) => calendar.id);
      cache = await this.dependencies.getCalendarEventsInRangeMulti(
        request.accountId,
        calendarIds,
        rangeStart,
        rangeEnd,
      );
      coverage = (await this.dependencies.getCalendarRangeCoverage(
        request.accountId,
        calendarIds,
        rangeStart,
        rangeEnd,
      )).state;
      // Existing pre-v35 event rows remain usable during the lazy transition.
      hasUsableCache = coverage === "complete" || cache.length > 0;
      request.onCache?.({ events: cache, calendars, coverage, hasUsableCache });
    } catch {
      // A cache read failure must not prevent an independent remote attempt.
    }

    try {
      const supported = await this.dependencies.hasCalendarSupport(request.accountId);
      if (!supported) {
        return emptyResult(false);
      }

      const provider = await this.dependencies.getCalendarProvider(request.accountId);
      if (!this.dependencies.refreshRange) {
        await this.discoverCalendars(request.accountId, provider);
      }
      calendars = await this.dependencies.getCalendarsForAccount(request.accountId);
      visibleCalendars = eventReadableCalendars(calendars).filter((calendar) => calendar.is_visible === 1);
      let diagnostics = emptyDiagnostics();

      if (this.dependencies.refreshRange) {
        diagnostics = (await this.dependencies.refreshRange({
          accountId: request.accountId,
          rangeStart: request.rangeStart,
          rangeEnd: request.rangeEnd,
          reason: "foreground",
        })).diagnostics;
        calendars = await this.dependencies.getCalendarsForAccount(request.accountId);
        visibleCalendars = eventReadableCalendars(calendars).filter((calendar) => calendar.is_visible === 1);
      } else {
        for (const calendar of visibleCalendars) {
          const events = await provider.fetchEvents(
            calendar.remote_id,
            request.rangeStart.toISOString(),
            request.rangeEnd.toISOString(),
          );
          const calendarDiagnostics = provider.lastReadDiagnostics ?? emptyDiagnostics();
          diagnostics.unreadableComponentCount += calendarDiagnostics.unreadableComponentCount;
          diagnostics.unreadableObjectCount += calendarDiagnostics.unreadableObjectCount;
          await this.dependencies.reconcileCalendarEventsRange({
            accountId: request.accountId,
            calendarId: calendar.id,
            rangeStart,
            rangeEnd,
            events,
            diagnostics: { ...calendarDiagnostics },
          });
        }
      }

      const calendarIds = visibleCalendars.map((calendar) => calendar.id);
      const events = await this.dependencies.getCalendarEventsInRangeMulti(
        request.accountId,
        calendarIds,
        rangeStart,
        rangeEnd,
      );
      const finalCoverage = (await this.dependencies.getCalendarRangeCoverage(
        request.accountId,
        calendarIds,
        rangeStart,
        rangeEnd,
      )).state;
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("office360-calendar-reminders-reconcile"));
      }
      return {
        events,
        calendars,
        coverage: finalCoverage,
        hasUsableCache: finalCoverage === "complete" || events.length > 0,
        hasCalendar: true,
        status: hasWarnings(diagnostics) ? "fresh-with-warnings" : "fresh",
        diagnostics,
        errorCategory: null,
      };
    } catch (error) {
      // A successful calendar refresh may have completed before a later calendar
      // failed. Reload the non-destructively reconciled cache when possible.
      try {
        const calendarIds = visibleCalendars.map((calendar) => calendar.id);
        cache = await this.dependencies.getCalendarEventsInRangeMulti(
          request.accountId,
          calendarIds,
          rangeStart,
          rangeEnd,
        );
      } catch {
        // Keep the earlier cache snapshot.
      }
      return {
        events: cache,
        calendars,
        coverage,
        hasUsableCache,
        hasCalendar: true,
        status: hasUsableCache ? "stale" : "error",
        diagnostics: emptyDiagnostics(),
        errorCategory: classifyCalendarLoadError(error),
      };
    }
  }

  private async discoverCalendars(accountId: string, provider: CalendarProvider): Promise<void> {
    const remoteCalendars = await provider.listCalendars();
    const observedAt = Math.floor(Date.now() / 1000);
    for (const calendar of remoteCalendars) {
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
      remoteCalendars.map((calendar) => calendar.remoteId),
    );
  }
}

export const calendarSyncService = new CalendarSyncService();

function emptyDiagnostics(): CalendarReadDiagnostics {
  return { unreadableComponentCount: 0, unreadableObjectCount: 0 };
}

function hasWarnings(diagnostics: CalendarReadDiagnostics): boolean {
  return diagnostics.unreadableComponentCount > 0 || diagnostics.unreadableObjectCount > 0;
}

function emptyResult(hasCalendar: boolean): CalendarRangeLoadResult {
  return {
    events: [],
    calendars: [],
    coverage: "never-synced",
    hasUsableCache: false,
    hasCalendar,
    status: "fresh",
    diagnostics: emptyDiagnostics(),
    errorCategory: null,
  };
}

function classifyCalendarLoadError(error: unknown): CalendarLoadErrorCategory {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (
    message.includes("service_disabled")
    || message.includes("not been used")
    || message.includes("not enabled")
    || message.includes("accessnotconfigured")
  ) return "calendar-api-disabled";
  if (message.includes("403") || message.includes("insufficient")) return "permission";
  return "other";
}
