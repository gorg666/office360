import { DAVClient, type DAVCalendar, type DAVObject } from "tsdav";
import type {
  CalendarProvider,
  CalendarProviderType,
  CalendarInfo,
  CalendarEventData,
  CalendarSyncResult,
  CreateEventInput,
  UpdateEventInput,
} from "./types";
import { generateVEvent, parseVEvent } from "./icalHelper";
import { getAccount } from "@/services/db/accounts";
import { ensureFreshToken } from "@/services/oauth/oauthTokenManager";
import { isYandexOAuthCalendarAccount, YANDEX_CALDAV_URL } from "./yandex";

export class CalDAVProvider implements CalendarProvider {
  readonly type: CalendarProviderType = "caldav";
  private client: DAVClient | null = null;

  constructor(readonly accountId: string) {}

  private async getClient(): Promise<DAVClient> {
    if (this.client) return this.client;

    const account = await getAccount(this.accountId);
    if (!account) throw new Error("Account not found");

    const usesYandexOAuth = isYandexOAuthCalendarAccount(account);
    const serverUrl = account.caldav_url ?? (usesYandexOAuth ? YANDEX_CALDAV_URL : null);
    const username = account.caldav_username ?? account.email;
    const password = account.caldav_password;

    if (!serverUrl) {
      throw new Error("CalDAV credentials not configured");
    }

    let client: DAVClient;

    if (usesYandexOAuth) {
      const accessToken = await ensureFreshToken(account);
      client = new DAVClient({
        serverUrl,
        credentials: { accessToken },
        authMethod: "Custom",
        authFunction: async () => ({ authorization: `OAuth ${accessToken}` }),
        defaultAccountType: "caldav",
      });
    } else {
      if (!password) {
        throw new Error("CalDAV credentials not configured");
      }

      client = new DAVClient({
        serverUrl,
        credentials: { username, password },
        authMethod: "Basic",
        defaultAccountType: "caldav",
      });
    }

    await client.login();
    this.client = client;
    return client;
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    const client = await this.getClient();
    const calendars = await client.fetchCalendars();

    return calendars.map((cal, index) => ({
      remoteId: cal.url,
      displayName: typeof cal.displayName === "string" ? cal.displayName : `Calendar ${index + 1}`,
      color: extractCalendarColor(cal) ?? null,
      isPrimary: index === 0,
    }));
  }

  async fetchEvents(calendarRemoteId: string, timeMin: string, timeMax: string): Promise<CalendarEventData[]> {
    const client = await this.getClient();

    const objects = await client.fetchCalendarObjects({
      calendar: { url: calendarRemoteId } as DAVCalendar,
      timeRange: {
        start: timeMin,
        end: timeMax,
      },
    });

    return objects
      .filter((obj) => obj.data)
      .map((obj) => {
        const event = parseVEvent(obj.data!, obj.url);
        event.etag = obj.etag ?? null;
        return event;
      });
  }

  async createEvent(calendarRemoteId: string, event: CreateEventInput): Promise<CalendarEventData> {
    const client = await this.getClient();
    const uid = crypto.randomUUID();
    const icalData = generateVEvent(event, uid);
    const filename = `${uid}.ics`;

    const response = await client.createCalendarObject({
      calendar: { url: calendarRemoteId } as DAVCalendar,
      filename,
      iCalString: icalData,
    });
    await assertDavResponseOk(response, "create event");

    const parsed = parseVEvent(icalData, joinCalendarObjectUrl(calendarRemoteId, filename));
    return parsed;
  }

  async updateEvent(
    calendarRemoteId: string,
    remoteEventId: string,
    event: UpdateEventInput,
    etag?: string,
  ): Promise<CalendarEventData> {
    const client = await this.getClient();

    // Fetch the existing object to get its current data
    const objects = await client.fetchCalendarObjects({
      calendar: { url: calendarRemoteId } as DAVCalendar,
      objectUrls: [remoteEventId],
    });

    const existing = objects[0];
    if (!existing?.data) throw new Error("Event not found on server");

    // Parse existing, merge updates, regenerate
    const parsed = parseVEvent(existing.data, remoteEventId);
    const merged: CreateEventInput = {
      summary: event.summary ?? parsed.summary ?? "",
      description: event.description ?? parsed.description ?? undefined,
      location: event.location ?? parsed.location ?? undefined,
      startTime: event.startTime ?? new Date(parsed.startTime * 1000).toISOString(),
      endTime: event.endTime ?? new Date(parsed.endTime * 1000).toISOString(),
      isAllDay: event.isAllDay ?? parsed.isAllDay,
    };

    const icalData = generateVEvent(merged, parsed.uid ?? undefined);

    const headers: Record<string, string> = {};
    if (etag) headers["If-Match"] = etag;

    const response = await client.updateCalendarObject({
      calendarObject: {
        url: remoteEventId,
        data: icalData,
        etag: etag ?? existing.etag ?? undefined,
      } as DAVObject,
      headers,
    });
    await assertDavResponseOk(response, "update event");

    const result = parseVEvent(icalData, remoteEventId);
    return result;
  }

  async deleteEvent(_calendarRemoteId: string, remoteEventId: string, etag?: string): Promise<void> {
    const client = await this.getClient();

    const headers: Record<string, string> = {};
    if (etag) headers["If-Match"] = etag;

    const response = await client.deleteCalendarObject({
      calendarObject: {
        url: remoteEventId,
        etag: etag ?? undefined,
      } as DAVObject,
      headers,
    });
    await assertDavResponseOk(response, "delete event");
  }

  async syncEvents(calendarRemoteId: string, _syncToken?: string): Promise<CalendarSyncResult> {
    const client = await this.getClient();
    const created: CalendarEventData[] = [];

    // Full fetch — tsdav's syncCalendars doesn't reliably expose per-object deltas,
    // so we do a time-range fetch and let the DB upsert logic handle deduplication.
    const now = new Date();
    const timeMin = new Date(now);
    timeMin.setDate(timeMin.getDate() - 90);
    const timeMax = new Date(now);
    timeMax.setFullYear(timeMax.getFullYear() + 1);

    const objects = await client.fetchCalendarObjects({
      calendar: { url: calendarRemoteId } as DAVCalendar,
      timeRange: {
        start: timeMin.toISOString(),
        end: timeMax.toISOString(),
      },
    });

    for (const obj of objects) {
      if (obj.data) {
        const event = parseVEvent(obj.data, obj.url);
        event.etag = obj.etag ?? null;
        created.push(event);
      }
    }

    return { created, updated: [], deletedRemoteIds: [], newSyncToken: null, newCtag: null };
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const client = await this.getClient();
      const calendars = await client.fetchCalendars();
      return {
        success: true,
        message: `Connected — found ${calendars.length} calendar${calendars.length !== 1 ? "s" : ""}`,
      };
    } catch (err) {
      // Reset client on failure so next attempt can retry
      this.client = null;
      return { success: false, message: err instanceof Error ? err.message : "Connection failed" };
    }
  }
}

function extractCalendarColor(cal: DAVCalendar): string | null {
  // tsdav may expose calendar-color in props
  const props = cal as unknown as Record<string, unknown>;
  if (typeof props.calendarColor === "string") return props.calendarColor;
  return null;
}

async function assertDavResponseOk(response: Response, action: string): Promise<void> {
  if (response.ok) return;

  let details = response.statusText;
  try {
    const text = await response.text();
    if (text.trim()) details = text.trim();
  } catch {
    // Keep the status text when the response body cannot be read.
  }

  throw new Error(`CalDAV ${action} failed (${response.status}): ${details}`);
}

function joinCalendarObjectUrl(calendarRemoteId: string, filename: string): string {
  try {
    return new URL(filename, calendarRemoteId).href;
  } catch {
    const separator = calendarRemoteId.endsWith("/") ? "" : "/";
    return `${calendarRemoteId}${separator}${filename}`;
  }
}
