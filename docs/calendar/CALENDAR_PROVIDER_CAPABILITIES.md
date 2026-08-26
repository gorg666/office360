# Calendar provider capabilities and write paths

Дата: 2026-08-24 (Asia/Bangkok)
Контракт: `src/services/calendar/domain/capabilities.ts` (`version: 5`)

Этот документ фиксирует только реально подключённые runtime-paths. Capability не означает, что provider API теоретически умеет функцию: она означает, что Office360 имеет работающий adapter и service boundary для этой функции.

## Capability matrix

Yandex использует тот же `CalDAVProvider`, что generic CalDAV, с отдельным OAuth credential/session path. Поэтому его write semantics совпадают с CalDAV.

| Capability | Google | CalDAV | Yandex |
| --- | --- | --- | --- |
| Calendar read | `full` | `full` | `full` |
| Event read | `full` | `full` | `full` |
| Create | `remote` | `remote` | `remote` |
| Update | `remote` | `remote` | `remote` |
| Delete | `remote` | `remote` | `remote` |
| Recurrence read | `full` | `full` | `full` |
| Recurrence write | `partial` | `partial` | `partial` |
| Update scopes | `single`, `series` | `single`, `series` | `single`, `series` |
| Delete scopes | `single`, `series` | `single`, `series` | `single`, `series` |
| Attendee read | `partial` | `partial` | `partial` |
| Attendee write | `partial` | `partial` | `partial` |
| Local RSVP | provisional projection | provisional projection | provisional projection |
| Remote RSVP | `direct` | `direct` | `direct` |
| Provider-native invitation delivery | `none` | `none` | `none` |
| Application Mail iTIP | `email-itip` | `email-itip` | `email-itip` |
| Sync mode | `sync-token`, paginated | RFC 6578 `sync-token` when advertised; bounded fallback | same standard CalDAV discovery/fallback |
| Sync durability | `durable` | `durable` when RFC 6578 is available | `durable` when RFC 6578 is available |
| Free/Busy (self) | `local-derived` | `local-derived` | `local-derived` |
| Free/Busy (others) | `remote` | `none` → `remote` after RFC 6638 discovery | `none` → `remote` after RFC 6638 discovery |
| Effective calendar access | `full` | `partial` | `partial` |
| Ownership | `partial` | `partial` | `partial` |
| ACL read / write | `partial` / `partial` after OAuth scope check | `partial` / `partial` after RFC 3744 discovery | `partial` / `partial` after RFC 3744 discovery |
| Shared calendars | `manage` when ACL scope is granted | `read`; manage only after discovery | `read`; manage only after discovery |
| Reminder read/write | `full` / `full` | `partial` / `partial` | `partial` / `partial` |
| Reminder methods | notification, email | notification write; DISPLAY/EMAIL read | notification write; DISPLAY/EMAIL read |
| Reminder defaults | `inherit` | `none` | `none` |
| Multiple reminders | yes, max 5 | yes | yes |
| Conflict detection | `etag` when cached ETag exists | `etag` when cached ETag exists | `etag` when cached ETag exists |

`partial` recurrence write means Office360 supports recurring-series creation plus explicit single/series update and delete, including series RRULE replacement, while preserving existing EXDATE/RDATE/RECURRENCE-ID data. `this-and-future` remains unsupported. Details: `CALENDAR_RECURRENCE_MUTATIONS.md` and `CALENDAR_RECURRING_CREATE.md`.

`freeBusy` splits into `self` and `others` in `version: 3`. `self = local-derived` means CAL-107 computes the signed-in account's availability from synced cache/coverage. Google `others = remote` uses only the official privacy-limited batch endpoint. CalDAV and Yandex start at `none` and change to `remote` only after RFC 6638 scheduling discovery proves inbox, outbox, user address and auto-schedule support. CAL-123 confirmed that exposed contract live for personal-domain and custom-domain Yandex accounts; no provider-name bypass exists. Details: `CALENDAR_FREE_BUSY_MODEL.md`, `CALENDAR_REMOTE_FREE_BUSY.md` and `CALENDAR_YANDEX_FREE_BUSY_DECISION.md`.

`rsvp.remote = direct` means the adapter performs a remote provider/API mutation. Google uses its attendee update path; CalDAV updates the remote resource. Provider-native RFC 6638 scheduling is still not claimed. CAL-122 adds a separate application-level `email-itip` lifecycle using the existing Mail queue for REQUEST/REPLY/CANCEL; it does not inflate the provider adapter's native capability.

`version: 4` adds structured reminder facts. Google supports provider defaults, explicit none and up to five popup/email overrides. CalDAV/Yandex can read multiple DISPLAY/EMAIL `VALARM` values, but Office360 only writes DISPLAY/notification alarms; RFC EMAIL support alone is not evidence of provider delivery. Mutation service validation rejects unsupported defaults, methods, multiplicity and counts before provider I/O. Details: `CALENDAR_REMINDERS.md`.

`version: 5` adds per-calendar access discovery facts. Google CalendarList effective roles are full; ownership is partial because CalendarList is not a complete owner/ACL directory. CalDAV/Yandex privilege discovery is partial because servers may omit or incompletely implement WebDAV ACL properties. CAL-128 adds dynamic ACL management without changing that static contract: Google requires a saved compatible OAuth grant; generic CalDAV/Yandex require the complete RFC 3744 read/write discovery contract. Unknown is never writable. Details: `CALENDAR_SHARED_ACCESS.md` and `CALENDAR_ACL_MANAGEMENT.md`.

## Runtime ownership

| Operation | UI/service entry | Provider operation | Remote result | Cache/UI reconciliation |
| --- | --- | --- | --- | --- |
| Create | `CalendarPage.handleCreate` → `CalendarMutationService.create` | `createEvent` | typed `CalendarWriteResult<CalendarEventData>` | `CalendarSyncService.loadRange`; no ad-hoc event upsert |
| Update | `EventDetailModal.handleSave` → `CalendarMutationService.update` | `updateEvent` | typed result; ETag forwarded | `CalendarSyncService.loadRange`; no local overwrite |
| Delete | `EventDetailModal.handleDelete` → `CalendarMutationService.delete` | `deleteEvent` | typed result; ETag forwarded | authoritative range reconciliation; no manual DB delete |
| Calendar-event RSVP | `EventDetailModal.handleRsvp` → `CalendarMutationService.respond` | `respondToEvent` | typed result; ETag forwarded | range refresh after confirmed remote success |
| Mail-invitation RSVP | normalized invitation + local attendee state | METHOD:REPLY through existing Mail queue | queued/retry/delivered/failed ledger | Calendar projection remains reconciled; delivery is explicit |

There is no new optimistic Calendar write path. Provider failure therefore cannot leave a newly fabricated remote row in the Calendar cache. The existing Mail RSVP projection is explicitly provisional and is removed when delivery is unsupported.

## Typed mutation result

`CalendarMutationService` is the only UI-facing write boundary. It returns:

- `success`;
- `unsupported`;
- `permission-denied`;
- `read-only`;
- `calendar-unavailable`;
- `auth-required`;
- `conflict`;
- `network-error`;
- `offline` (explicitly not queued);
- `partial`;
- `provider-error`.

Raw provider response bodies are not passed to React. HTTP 409/412 map to `conflict`, 401 to `auth-required`, auth-independent 403 to `permission-denied`, and retryable transport/server failures to `network-error`.

## Recurrence and delete safety

Every recurring update/delete command carries an explicit provider-neutral scope: `single`, `series`, or `this-and-future`. The service rejects a missing or undeclared scope before calling a provider.

This is critical for CalDAV/Yandex: expanded occurrences share the series `.ics` resource URL. A single delete updates that resource with EXDATE and never calls `deleteCalendarObject`; only an explicit series delete removes the resource. Google expanded instances use provider instance IDs for `single`, while series operations resolve the master ID. `this-and-future` remains unsupported for all adapters.

## Conflict and precondition behavior

- Google update, delete and RSVP send `If-Match` when a cached ETag is supplied. A provider 409/412 becomes typed `conflict`.
- CalDAV update/RSVP and single-occurrence exclusion forward the cached or freshly fetched ETag to `updateCalendarObject`; series delete forwards the cached ETag to `deleteCalendarObject`.
- CalDAV create uses the existing `tsdav.createCalendarObject` path and does not explicitly set `If-None-Match`; a duplicate/create race remains provider-defined.
- If a legacy row has no ETag, the write is unconditional. The capability says `etag` because the normal remote cache carries ETags, not because every legacy write is guarded.

## Deliberate unsupported states

- Remote Free/Busy exists for Google and discovery-confirmed CalDAV/Yandex. Missing discovery properties remain an intentional provider limitation. ACL management is dynamic: Google is scope-gated and CalDAV/Yandex are RFC 3744 discovery-gated. Provider-native invitation delivery remains unsupported. Application email iTIP is supported by CAL-122 through Mail queue semantics. Reminder metadata and desktop delivery follow CAL-118/CAL-121.
- Mail invitation queue items use UID, recurrence identity, sequence and per-recipient durable action keys. Provider-backed Calendar RSVP uses direct provider delivery; Mail invitations use METHOD:REPLY rather than fabricating a provider resource locator.
- CAL-129 durably adopts Google sync tokens and discovery-confirmed RFC 6578 CalDAV/Yandex tokens. Servers without `sync-collection` retain a bounded fallback that is authoritative only inside a successfully parsed coverage window. Details: `CALENDAR_DELTA_OFFLINE_SYNC.md`.
- `src/services/google/calendar.ts` has no imports in the current application graph and is legacy candidate code. It remains untouched to avoid unrelated destructive cleanup. The proven unreachable duplicate Gmail branch in `calendar/providerFactory.ts` was removed.

## Conformance coverage

The shared provider conformance suite checks Google and CalDAV capability facts, zoned/all-day normalization and recurrence occurrence identity. Provider, mutation and codec suites cover single/series routing, original RECURRENCE-ID preservation after a move, typed EXDATE values, existing exception preservation, DST-zone writes, master resolution, ETag propagation, typed unsupported `this-and-future`, and whole-resource delete safety. Yandex reuses the tested CalDAV implementation and has separate read-only runtime acceptance.
