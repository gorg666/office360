import { isSupportedIanaTimeZone } from "../domain";

export interface ICalendarTimeZoneDefinition {
  tzid: string;
  location: string | null;
  serialized: string;
  observances: Array<{
    kind: "standard" | "daylight";
    dtstart: string | null;
    tzOffsetFrom: string | null;
    tzOffsetTo: string | null;
    rule: string | null;
    dates: string[];
  }>;
}

export interface ResolvedCalendarTimeZone {
  originalTzid: string;
  resolvedTzid: string | null;
  source: "iana" | "windows-alias" | "vtimezone-location" | "unsupported";
}

// Deliberately small interoperability table. This is not a timezone database;
// it covers common Windows TZIDs emitted by Calendar/iMIP producers.
const WINDOWS_TIME_ZONE_ALIASES: Readonly<Record<string, string>> = {
  "Russian Standard Time": "Europe/Moscow",
  "Russia TZ 2 Standard Time": "Europe/Moscow",
  "W. Europe Standard Time": "Europe/Berlin",
  "GMT Standard Time": "Europe/London",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
};

export function resolveCalendarTimeZone(
  tzid: string,
  definitions: readonly ICalendarTimeZoneDefinition[] = [],
): ResolvedCalendarTimeZone {
  if (isSupportedIanaTimeZone(tzid)) {
    return { originalTzid: tzid, resolvedTzid: tzid, source: "iana" };
  }

  const alias = WINDOWS_TIME_ZONE_ALIASES[tzid];
  if (alias && isSupportedIanaTimeZone(alias)) {
    return { originalTzid: tzid, resolvedTzid: alias, source: "windows-alias" };
  }

  const definition = definitions.find((candidate) => candidate.tzid === tzid);
  if (definition?.location && isSupportedIanaTimeZone(definition.location)) {
    return {
      originalTzid: tzid,
      resolvedTzid: definition.location,
      source: "vtimezone-location",
    };
  }

  return { originalTzid: tzid, resolvedTzid: null, source: "unsupported" };
}
