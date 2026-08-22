import {
  formatICalCalendarDate,
  formatICalWallDateTime,
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
