# Calendar recurrence mutation contract

Дата: 2026-08-22 (Asia/Bangkok)
Статус: CAL-111 backend contract

## Scope and identity

Every recurring update or delete crosses `CalendarMutationService` with an explicit scope:

- `single` — one occurrence identified by the existing canonical `occurrenceKey`;
- `series` — the recurrence master/resource;
- `this-and-future` — the selected occurrence and later instances.

The provider request carries `seriesUid`, decoded `OccurrenceIdentity`, scope and mutation. Access tokens, display labels and a newly moved `DTSTART` are never identity. The service rejects a missing, malformed or cross-series occurrence key before provider I/O. A recurrence rule can only be changed with `series`.

## Provider matrix

| Operation | Google | CalDAV | Yandex |
| --- | --- | --- | --- |
| single update | supported: patch provider instance ID | supported: VEVENT override | supported through CalDAV adapter |
| single delete | supported: delete provider instance ID | supported: remove matching override and add EXDATE | supported through CalDAV adapter |
| series update | supported: resolve instance to master, patch master | supported: update master VEVENT | supported through CalDAV adapter |
| series delete | supported: resolve instance to master, delete master | supported: delete whole calendar resource | supported through CalDAV adapter |
| this-and-future | unsupported | unsupported | unsupported |

Google's published split-series recipe requires trimming the old RRULE and inserting a second series, and resets later exceptions. Office360 does not claim this as an atomic capability. CalDAV `RANGE=THISANDFUTURE` interoperability is likewise not implemented or advertised.

## Single occurrence semantics

CalDAV update creates a full VEVENT override when none exists, retains the series UID, removes copied RRULE/RDATE/EXDATE from the override, and writes `RECURRENCE-ID` from the original occurrence identity. Moving Tuesday 10:00 to Thursday 14:00 changes `DTSTART`/`DTEND` only; `RECURRENCE-ID` remains Tuesday 10:00. Existing overrides are updated in place. Master fields and sibling exceptions remain unchanged.

CalDAV single delete never calls `deleteCalendarObject`. It removes a matching override, adds a value-type/TZID-correct EXDATE to the master, advances master SEQUENCE/DTSTAMP, and PUTs the same resource using cached or freshly fetched ETag. Repeating the exclusion does not duplicate EXDATE.

Google expanded instances already have immutable `originalStartTime` and an instance API ID. A single mutation addresses that ID directly. A series mutation first reads the supplied event, resolves `recurringEventId` to the master when necessary, and uses the master's ETag.

## Series semantics

CalDAV series update changes only the master VEVENT. UID, VTIMEZONE, existing EXDATE/RDATE and sibling RECURRENCE-ID overrides are preserved. RRULE replacement accepts an RRULE value without a property prefix or line breaks. Time, duration (DTEND), attendees, TZID and SEQUENCE use the existing codec policy.

Google series RRULE replacement preserves non-RRULE recurrence lines such as EXDATE/RDATE. Series delete uses the resolved master ID; CalDAV series delete is the only recurrence path allowed to delete the whole `.ics` resource.

## Conflict and reconciliation

Google uses `If-Match` for the actual instance/master ETag. CalDAV PUT/DELETE uses the cached or freshly fetched resource ETag. HTTP 409/412 is returned to UI as typed `conflict`; auth, permission, network and unsupported outcomes remain CAL-105 typed results. No provider exception body becomes UI text.

Successful mutations do not write directly to the cache. React triggers the existing CAL-104 range refresh, then remote state reconciles cache and views. This is also the boundary that a future recurring edit/Scheduling Assistant UI will call with the selected start/end and explicit scope.

## Deliberate limitations

- `this-and-future` is explicitly unsupported for every current provider.
- Recurring-series creation and the final scope prompt/editor are outside CAL-111.
- Live cloud recurrence mutations are not used for acceptance; provider adapters are verified with deterministic fixtures and conditional-write mocks.
