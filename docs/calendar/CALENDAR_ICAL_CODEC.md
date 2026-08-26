# CAL-103 — iCalendar codec

Дата: 2026-08-22 (Asia/Bangkok)

## Boundary

Production iCalendar flow is now:

```text
raw ICS
  -> src/services/calendar/ical/codec.ts (ical.js only)
  -> plain component/property data
  -> icalTimeMapping.ts
  -> CalendarEventData / CAL-102 domain
```

The reverse write flow uses the same codec boundary. `ICAL.Component`, `ICAL.Property`, `ICAL.Time`, and all other library objects remain private to `codec.ts`; React, DB, providers, Mail UI, and provider-neutral domain types do not import `ical.js`.

`icalHelper.ts` remains the compatibility facade used by CalDAV, invitations, and legacy DB lazy projection. Its parser, serializer, update, and attendee-response functions delegate to the codec; the former regex/split/manual escaping helpers were removed.

## Dependency

- package: `ical.js`
- pinned version: `2.2.1`
- license: MPL-2.0
- lockfile: updated by npm
- production main chunk before CAL-103: 1,925.88 kB raw / 574.99 kB gzip
- production main chunk after CAL-103: 2,008.36 kB raw / 598.94 kB gzip
- measured delta: +82.48 kB raw / +23.95 kB gzip

The build emits a browser-externalized `stream` warning from the transitive `sax` module, but compilation, browser-side Vitest execution, and production bundling complete successfully.

## Time mapping rules

`ical.js` owns RFC content parsing, folding, escaping, parameters, and serialization. It does not own Office360 time policy.

- `VALUE=DATE` maps to CAL-102 `all-day` with exclusive end date.
- UTC and resolved TZID values map to `timed-zoned`; the codec passes wall fields and TZID to existing `Intl`-based CAL-102 helpers.
- A date-time without `Z` or `TZID` remains `floating`.
- DST gap and overlap policy remains in the CAL-102 domain (`gap -> first valid wall time`, `overlap -> earlier offset`).
- Compatibility epoch projection for floating and degraded unknown-TZID values defaults to explicit UTC unless a caller supplies `floatingTimeZone`; host timezone is never selected implicitly.
- `RECURRENCE-ID` is mapped to the existing occurrence identity and `createOccurrenceKey`; library identities do not enter the domain.

## VTIMEZONE and non-IANA TZIDs

Incoming `VTIMEZONE`, including `STANDARD`/`DAYLIGHT` children and their offset/recurrence properties, is parsed and retained in serialized component data. Resolution order is:

1. directly supported IANA TZID through `Intl`;
2. a deliberately small Windows interoperability map (`Russian Standard Time`, `Russia TZ 2 Standard Time`, and common US/European identifiers);
3. matching `VTIMEZONE` `X-LIC-LOCATION` when it names an IANA zone;
4. deterministic best-effort floating semantics plus provider-neutral `unsupported-timezone` diagnostic.

The mapping table is intentionally not a timezone database. Office360 does not generate IANA transition rules and no additional timezone dependency was added.

Existing incoming `VTIMEZONE` components are preserved when an event is updated. Newly created non-UTC IANA events emit `TZID`; they do not synthesize a new `VTIMEZONE` block.

## Round-trip and updates

The codec provides semantic assertions for UTC, Europe/Moscow, America/New_York, Australia/Lord_Howe, floating, and all-day values. Update operations mutate the master `VEVENT` through `ical.js`, preserve unknown properties and sibling override components, preserve RRULE/RDATE/EXDATE/RECURRENCE-ID/DURATION, refresh DTSTAMP, and increment SEQUENCE once unless an explicit sequence is supplied.

Text escaping, CRLF output, line folding, LF/CRLF space and tab unfolding, quoted parameters, and attendee parameters are delegated to the library and verified semantically after parse rather than by snapshots alone.

## Malformed isolation

CAL-102F isolation remains in place. A minimal structural scanner finds component boundaries only; it does not parse content lines. Each isolated `VEVENT` is then parsed by `ical.js`, so a malformed sibling increments `unreadableComponentCount` without dropping readable events. DAV object-level diagnostics and the prohibition on logging raw ICS are unchanged.

## Mail and providers

The shared codec reads `METHOD:REQUEST`, `METHOD:REPLY`, and `METHOD:CANCEL`, organizer, attendee participation parameters, SEQUENCE, STATUS, UID, and RECURRENCE-ID. Existing invitation cards continue to use the compatibility facade. CalDAV/Yandex read/create/update/RSVP paths therefore use the codec automatically. Google keeps its native API mapper and is covered by provider conformance tests.

Legacy DB rows require no migration or backfill. Rows with raw ICS are lazily projected through the new codec; rows without raw ICS keep the existing v34 fallback.

## Known limitations

1. Newly serialized IANA events include TZID but do not synthesize VTIMEZONE transition data; doing that correctly requires an approved timezone data source.
2. The Windows alias table is intentionally small. Unknown identifiers remain visible with an `unsupported-timezone` diagnostic rather than guessed host-local semantics.
3. CAL-103 does not add normalized attendee persistence, VALARM behavior, outbound iTIP delivery, remote RSVP orchestration, or recurrence-edit UI.
