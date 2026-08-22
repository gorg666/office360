# Calendar provider capabilities and write paths

Дата: 2026-08-22 (Asia/Bangkok)
Контракт: `src/services/calendar/domain/capabilities.ts` (`version: 3`)

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
| Invitation delivery | `none` | `none` | `none` |
| Sync mode | `sync-token`, paginated | `range-refresh`, not paginated | `range-refresh`, not paginated |
| Sync durability | `ephemeral` | `ephemeral` | `ephemeral` |
| Free/Busy (self) | `local-derived` | `local-derived` | `local-derived` |
| Free/Busy (others) | `remote` | `none` → `remote` after RFC 6638 discovery | `none` |
| Permissions / ACL | `none` | `none` | `none` |
| Shared calendars | `read` | `read` | `read` |
| Reminders | `none` | `none` | `none` |
| Conflict detection | `etag` when cached ETag exists | `etag` when cached ETag exists | `etag` when cached ETag exists |

`partial` recurrence write means Office360 supports explicit single/series update and delete, including series RRULE replacement, while preserving existing EXDATE/RDATE/RECURRENCE-ID data. `this-and-future` and recurring-series creation remain unsupported. Details: `CALENDAR_RECURRENCE_MUTATIONS.md`.

`freeBusy` splits into `self` and `others` in `version: 3`. `self = local-derived` means CAL-107 computes the signed-in account's availability from synced cache/coverage. Google `others = remote` uses only the official privacy-limited batch endpoint. Generic CalDAV starts at `none` and changes to `remote` only after RFC 6638 scheduling discovery proves an outbox, user address and auto-schedule support. Yandex stays `none`: its web UI feature is not proof of public CalDAV scheduling support. Details: `CALENDAR_FREE_BUSY_MODEL.md` and `CALENDAR_REMOTE_FREE_BUSY.md`.

`rsvp.remote = direct` means the adapter performs a remote provider/API mutation. Google uses its attendee update path; CalDAV updates the remote resource. CAL-105 did not perform live mutations, so organizer delivery side effects were not confirmed for CalDAV/Yandex. General invitation and outbound iTIP delivery therefore remain `none`.

## Runtime ownership

| Operation | UI/service entry | Provider operation | Remote result | Cache/UI reconciliation |
| --- | --- | --- | --- | --- |
| Create | `CalendarPage.handleCreate` → `CalendarMutationService.create` | `createEvent` | typed `CalendarWriteResult<CalendarEventData>` | `CalendarSyncService.loadRange`; no ad-hoc event upsert |
| Update | `EventDetailModal.handleSave` → `CalendarMutationService.update` | `updateEvent` | typed result; ETag forwarded | `CalendarSyncService.loadRange`; no local overwrite |
| Delete | `EventDetailModal.handleDelete` → `CalendarMutationService.delete` | `deleteEvent` | typed result; ETag forwarded | authoritative range reconciliation; no manual DB delete |
| Calendar-event RSVP | `EventDetailModal.handleRsvp` → `CalendarMutationService.respond` | `respondToEvent` | typed result; ETag forwarded | range refresh after confirmed remote success |
| Mail-invitation RSVP | invitation projection → queue | no remote locator/provider call exists | terminal typed `unsupported` | provisional projection removed; queue blocked without retry |

There is no new optimistic Calendar write path. Provider failure therefore cannot leave a newly fabricated remote row in the Calendar cache. The existing Mail RSVP projection is explicitly provisional and is removed when delivery is unsupported.

## Typed mutation result

`CalendarMutationService` is the only UI-facing write boundary. It returns:

- `success`;
- `unsupported`;
- `permission-denied`;
- `auth-required`;
- `conflict`;
- `network-error`;
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

- Remote Free/Busy exists for Google and discovery-confirmed generic CalDAV. Yandex remote Free/Busy, ACL management, reminders, provider-native invitation delivery and outbound email iTIP remain unsupported.
- Mail invitation queue items contain UID/recurrence identity but no provider calendar/resource locator. They cannot be routed safely to `respondToEvent`; they end as terminal unsupported instead of retrying forever.
- Google sync tokens and CalDAV delta state are not durably adopted yet. Google fetch pagination remains complete, while the capability honestly reports ephemeral sync state; CalDAV reports bounded `range-refresh`.
- `src/services/google/calendar.ts` has no imports in the current application graph and is legacy candidate code. It remains untouched to avoid unrelated destructive cleanup. The proven unreachable duplicate Gmail branch in `calendar/providerFactory.ts` was removed.

## Conformance coverage

The shared provider conformance suite checks Google and CalDAV capability facts, zoned/all-day normalization and recurrence occurrence identity. Provider, mutation and codec suites cover single/series routing, original RECURRENCE-ID preservation after a move, typed EXDATE values, existing exception preservation, DST-zone writes, master resolution, ETag propagation, typed unsupported `this-and-future`, and whole-resource delete safety. Yandex reuses the tested CalDAV implementation and has separate read-only runtime acceptance.
