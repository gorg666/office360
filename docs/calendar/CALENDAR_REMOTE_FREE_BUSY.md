# CAL-110 — Remote Free/Busy providers

Status: implemented on `feat/calendar-yandex360`, 2026-08-22.
Migration: **NONE**.

## Boundary and routing

Remote availability is an optional `RemoteFreeBusyAdapter` beneath `FreeBusyService`; it is
not a new event-read path and is not part of `CalendarProvider`'s public CRUD interface.

```text
SchedulingAssistantService
  -> FreeBusyService
     -> LocalAccountFreeBusyAdapter      (signed-in identity first)
     -> AccountRemoteFreeBusyAdapter     (account/provider scoped)
        -> GoogleRemoteFreeBusyAdapter
        -> CalDavRemoteFreeBusyAdapter   (only after discovery)
```

The request stays `ParticipantRef[]`. The response stays privacy-limited
`ParticipantAvailability[]`: participant identity, reliability and `{start,end,busyType}` only.
Event title, description, location, attendee list, UID, provider resource ID and raw ICS never
cross the adapter boundary. Unsupported or missing data is never interpreted as free.

## Provider capability audit

| Provider | `freeBusy.self` | `freeBusy.others` | Runtime rule |
| --- | --- | --- | --- |
| Google Calendar API | `local-derived` | `remote` | official `POST /calendar/v3/freeBusy`; Calendar readonly scope already exists |
| generic CalDAV | `local-derived` | initially `none`, then `remote` | enabled only after RFC 6638 scheduling outbox, calendar user address and `calendar-auto-schedule` discovery |
| Yandex CalDAV | `local-derived` | `none` | read-only discovery runs, but remote query remains disabled because public Yandex docs do not confirm the CalDAV scheduling extension |

Google limits `calendarExpansionMax` to 50, so the adapter splits larger requests into batches
of 50. Per-calendar errors and failed batches are isolated: successful participants remain
known, access/not-found becomes `permission-denied`, and provider/rate/transport failures become
`error`. The endpoint returns busy periods only; the adapter never calls `events.list`.

Generic CalDAV discovery reads the current principal's `calendar-user-address-set`,
`schedule-inbox-URL`, `schedule-outbox-URL`, and the OPTIONS `calendar-auto-schedule` DAV token.
Only a complete result enables remote capability. A query posts an RFC 6638 VFREEBUSY request to
the scheduling outbox and maps each schedule response independently. `3.7` / `3.8` request status
is permission denied; malformed/missing responses are error. `free-busy-query REPORT` support on
calendar collections is not treated as proof that arbitrary participants can be queried.

References: [Google freeBusy.query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query),
[RFC 4791 §7.10](https://www.rfc-editor.org/rfc/rfc4791.html#section-7.10),
[RFC 6638](https://www.rfc-editor.org/rfc/rfc6638.html).

## Reliability, cancellation and cache

- `known` is the only reliability that permits an empty busy list to mean free.
- `permission-denied`, `unsupported` and `error` remain distinct.
- `AbortSignal` reaches Google HTTP calls, CalDAV discovery, OPTIONS and scheduling POST; abort
  rejects with `AbortError`, including Gmail rate-limit backoff.
- identical account/provider/participant/range/timezone queries are coalesced;
- successful and typed-error results use a 60-second in-memory TTL;
- keys contain account ID and provider type, never credentials or tokens;
- cache values contain only the provider-neutral privacy projection.

No SQLite table, migration, backfill or durable availability store is introduced.

## Scheduler behavior

CAL-108 remains unchanged. Required remote busy blocks a slot; required known-empty availability
confirms free; required permission-denied/error is unknown; optional remote busy remains selectable
and appears as an optional conflict. CAL-109 remains a thin consumer of `GroupSchedulingResult`.

## Known limitations

1. No live Google account was available during CAL-110 acceptance; Google behavior is covered by
   official-contract mocks, batch/error/privacy tests and provider conformance.
2. Yandex web Calendar exposes participant availability as a product feature, but that does not
   prove its public CalDAV endpoint implements RFC 6638. Office360 therefore performs discovery
   only and does not send a participant query.
3. CalDAV servers that expose only collection `free-busy-query REPORT`, without an RFC 6638
   scheduling outbox, remain unsupported for arbitrary participants.
4. The cache is process-local and deliberately short-lived; it is not a durable offline source.
