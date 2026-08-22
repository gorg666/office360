import {
  formatICalCalendarDate,
  formatICalWallDateTime,
  parseCalendarDate,
  parseWallDateTime,
  type CalendarDate,
  type WallDateTime,
} from "./time";

export type OccurrenceIdentity =
  | { kind: "timed-zoned"; wall: WallDateTime; tzid: string }
  | { kind: "floating"; wall: WallDateTime }
  | { kind: "all-day"; date: CalendarDate };

export function createOccurrenceKey(seriesUid: string, identity: OccurrenceIdentity): string {
  const uid = encodeURIComponent(seriesUid);
  switch (identity.kind) {
    case "timed-zoned":
      return `${uid}|Z|${encodeURIComponent(identity.tzid)}|${formatICalWallDateTime(identity.wall)}`;
    case "floating":
      return `${uid}|F|${formatICalWallDateTime(identity.wall)}`;
    case "all-day":
      return `${uid}|D|${formatICalCalendarDate(identity.date)}`;
  }
}

export interface ParsedOccurrenceKey {
  seriesUid: string;
  identity: OccurrenceIdentity;
}

export function parseOccurrenceKey(key: string): ParsedOccurrenceKey {
  const parts = key.split("|");
  try {
    const seriesUid = decodeURIComponent(parts[0] ?? "");
    if (!seriesUid) throw new Error("missing series UID");
    if (parts[1] === "Z" && parts.length === 4) {
      const tzid = decodeURIComponent(parts[2] ?? "");
      if (!tzid) throw new Error("missing timezone");
      return { seriesUid, identity: { kind: "timed-zoned", tzid, wall: parseWallDateTime(parts[3]!) } };
    }
    if (parts[1] === "F" && parts.length === 3) {
      return { seriesUid, identity: { kind: "floating", wall: parseWallDateTime(parts[2]!) } };
    }
    if (parts[1] === "D" && parts.length === 3) {
      return { seriesUid, identity: { kind: "all-day", date: parseCalendarDate(parts[2]!) } };
    }
  } catch (error) {
    if (error instanceof URIError) throw new Error("Invalid occurrence key encoding");
    throw error;
  }
  throw new Error("Invalid occurrence key");
}
