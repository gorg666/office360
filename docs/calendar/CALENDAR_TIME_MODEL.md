# Calendar time model

Status: CAL-102 foundation, 2026-08-22.

## Canonical event time

Calendar core distinguishes three values in `src/services/calendar/domain/time.ts`:

- `timed-zoned`: wall-clock start/end, explicit IANA `TZID`, and resolved Unix-second instants. The instant is derived from the wall value and zone; the host timezone is never the event timezone.
- `floating`: wall-clock start/end without `Z` or `TZID`. It remains floating in the domain. A display/query projection must provide an explicit timezone and does not change the stored meaning.
- `all-day`: `startDate` and exclusive `endDateExclusive` calendar dates. These are not local-midnight timestamps. Compatibility epochs use UTC date boundaries only.

Google `start.date` / `end.date` and CalDAV `VALUE=DATE` map to the same exclusive-date contract. Google DTOs and ICS content cross explicit provider mapping boundaries before reaching UI/cache code.

## IANA resolution and DST

`wall-clock + IANA timezone -> instant` uses `Intl.DateTimeFormat`; there is no embedded offset table or timezone dependency.

- Gap (non-existent local time): shift forward minute-by-minute to the first valid wall time.
- Overlap (repeated local time): choose the earlier instant/offset.

The policy is centralized as `DST_DISAMBIGUATION_POLICY`. Coverage includes `Europe/Moscow`, `America/New_York`, and the 30-minute transition in `Australia/Lord_Howe`.

## Recurrence and occurrence identity

RRULE expansion runs on naive wall-clock values, then localizes each occurrence. A weekly 10:00 event therefore stays at 10:00 through DST while its UTC instant changes.

Range expansion looks back by the greater of the existing three-day safety window and the event duration. This keeps long occurrences that begin before the requested range but still overlap it; an occurrence whose end is exactly the range start remains excluded.

`occurrenceKey` is composed from:

```text
series UID + time kind + original recurrence wall/date identity + TZID when zoned
```

It is not based solely on a rendered UTC epoch or DAV href. Generated occurrences and `RECURRENCE-ID` overrides share this identity. `EXDATE` values in UTC, TZID, floating, or `VALUE=DATE` form are normalized into the master's recurrence domain before matching. `RDATE` uses the same identity path. `DURATION` supplies the end when `DTEND` is absent.

Resource identity (`remoteEventId`/href), `seriesUid`, and `occurrenceKey` are deliberately separate.

## Metadata and provider capabilities

Calendar domain/cache now carries `TRANSP`, `SEQUENCE`, recurrence-master state, and basic `ParticipantRef` identities. Participant email comparison follows the existing Office360 convention: trim, remove `mailto:`, and lowercase the complete address; presentation casing is retained separately. Attendee role/resource normalization remains out of scope for CAL-102.

Providers expose versioned `CalendarProviderCapabilities` for current CRUD, recurrence scope, RSVP, Free/Busy availability, sync, and conflict behavior. This is a declaration only; CAL-102 does not implement Free/Busy.

## Persistence and compatibility

Migration v34 is append-only. It adds nullable semantic columns plus constant defaults for `is_recurrence_master` and `sequence`; it performs no table rewrite or row update. Existing rows are projected lazily on read:

1. derive from stored ICS when usable;
2. otherwise preserve legacy all-day dates via UTC date boundaries;
3. otherwise project legacy timed epochs as explicit UTC semantics.

Lazy derivation does not write or mass-backfill existing rows. New sync/write records persist the semantic fields.

## Degraded provider reads

CalDAV parsing isolates each `VEVENT` and DAV object. A malformed component is omitted without discarding valid siblings, while safe component/object counters flow through the same `fetchEvents` and `syncEvents` path. The UI reports a successful but degraded read and keeps existing cached range data; diagnostics never contain raw iCalendar content or DAV object identifiers.

## Current boundary

CAL-102 intentionally keeps the handwritten ICS codec and `rrule`. Unsupported/non-IANA TZIDs remain a guarded best-effort floating read with invitation risk metadata; full codec replacement and broader RFC edge cases belong to CAL-103. Recurrence edit scopes and UI are not implemented here.
