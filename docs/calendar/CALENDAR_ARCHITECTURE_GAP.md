# CAL-AUDIT-001 — Calendar architecture gap

Baseline: `GORGDEV2-EFIM-INTEGRATION` @ `10c7a54`
Цель сравнения: текущий Office360 → будущий Calendar parity foundation. Это не аудит веб-версии Яндекс 360.

## Capability matrix

| Возможность | Сейчас | Переиспользовать | Нужно реализовать |
|---|---|---|---|
| Calendar shell | production route/page | Office360 shell, toolbar, semantic UI | hardened loading/error/offline states |
| Month view | basic grid, 3 events/day | date navigation, event cache | multi-day lanes, overflow popover, selection, DnD |
| Week view | 24×7 hour buckets | header/all-day concept | continuous layout, overlap, current-time line, scroll, DnD/resize |
| Day view | 24 hour rows | basic day navigation | same layout engine as Week, resources/timezones |
| Event CRUD | Google/CalDAV + SQLite | provider contract, ETag, editor shell | offline queue, conflicts, scope-aware recurrence CRUD |
| Drag event | absent | `@dnd-kit/core` patterns | accessible time-grid drag + optimistic/provider mutation |
| Resize event | absent | none | handles, snapping, constraints, keyboard operation |
| Multiple calendars | list/visibility/create target | `calendars` table, CalendarList | create/rename/delete/subscription, colors/ordering/provider ACL |
| Attendees | email list + JSON display | contacts/directory, provider payload | normalized attendee entity/picker/delivery |
| Optional attendees | absent | attendee foundation | ROLE/optional/required semantics and UI |
| RSVP | direct provider on event; Mail queue local/blocked | status types/UI/queue | unified direct/iMIP delivery + reconciliation |
| Organizer | parsed/displayed | organizer field and Mail action | organizer authority, invite/update/cancel workflow |
| Free/Busy | absent | account/directory/provider seams | opaque interval service/cache/privacy enforcement |
| Scheduling assistant | absent | participant picker + grid primitives | attendee lanes, zone-aware availability, suggestions |
| Suggested time | absent | none | working-hours/constraints algorithm with explainable results |
| Recurrence | CalDAV RRULE expansion + exceptions read | raw iCal, `rrule`, tests | editor, scope, DST-safe model, Google recurrence mapping |
| Exceptions | read EXDATE/RECURRENCE-ID | parser fixtures | normalized exception/tombstone CRUD |
| Reminders | absent for events | notification/checker patterns | reminder entity, scheduler, actions, catch-up |
| Working hours | absent | settings/DB pattern | per-user/zone weekly rules and exceptions |
| Timezones | system Date + limited TZID warning | Intl + provider fields | event/user TZID, floating/all-day semantics, DST correctness |
| ICS parsing | partial handwritten VEVENT/iTIP | raw iCal, regression fixtures | standards parser: VTIMEZONE, params, folding, robust recurrence |
| ICS generation | basic VEVENT | email builder/raw preservation | RRULE/VALARM/ORGANIZER/roles/privacy/iTIP methods |
| Mail → Calendar | invite card on thread open | attachments/provider fetch, invitation table | sync-time MIME extraction, idempotent import/update/cancel |
| Calendar → Mail | generic `.ics` attachment possible | EmailProvider + RFC2822 builder | generated REQUEST/REPLY/CANCEL and Outbox/Sent tracking |
| Shared calendars | remote list only | calendars table/provider list | subscriptions, owner/role/ACL, delegated calendars |
| Permissions | absent | capability patterns | provider ACL adapter + local projection/UI gates |
| Privacy | absent in event model | security/redaction/account scope | CLASS/visibility/details policy, opaque FreeBusy |
| Search | no Calendar search | SQLite/query patterns | indexed event/attendee/location search with ACL filtering |

## Core architecture matrix

| CURRENT | REQUIRED | GAP | PROPOSED SOLUTION |
|---|---|---|---|
| `CalendarPage` owns fetch/cache/provider orchestration | durable calendar application service | UI lifecycle is sync engine; errors/offline/conflicts weak | `CalendarService` + calendar store selectors; component renders state/actions only |
| range delete then remote upsert | atomic refresh/delta sync | partial cache possible; CalDAV deletes not tracked | staged generation/transaction; provider delta cursor; tombstones and reconciliation |
| `CalendarProvider` CRUD/list/sync | capability-rich provider | no FreeBusy/ACL/reminders/recurrence-scope capabilities | versioned `CalendarProviderCapabilities` + optional typed operations |
| events keyed by provider/instance string | stable master/occurrence identity | instance/master/remote IDs conflated | explicit `event_master_id`, `occurrence_key`, provider resource ID, UID |
| attendees JSON | queryable attendee/role/status model | cannot support optional/freebusy/directory joins | normalized `calendar_attendees` with immutable identity reference |
| raw iCal + regex helpers | RFC round-trip and semantic model | TZID/VTIMEZONE/iTIP edge cases unsafe | standards parser adapter; preserve raw for round-trip/debug, never log it |
| Unix seconds only | UTC + wall time + IANA zone + floating/all-day | DST/zone recurrence unsafe | Temporal-like domain types; persist TZID/local recurrence anchor/exclusive dates |
| generic pending operations + blocked `calendarRsvp` | real calendar operation queue | RSVP decision never delivered | `calendar_pending_operations` or typed extension with provider/iMIP executors |
| Mail ThreadView performs invite detection | ingestion pipeline | unseen invitation not indexed until thread open | parse calendar MIME during sync/fetch; ThreadView only presents DB state |
| basic OS notifications | reliable event reminders | no reminder domain/scheduling/catch-up | reminder table + checker/native scheduler + snooze/acknowledge/deep-link |
| local contacts by email | corporate participant identity | no authoritative user/freebusy ID | directory resolver with account/org/provider IDs and email fallback |

## Events

### Current

`calendar_events` stores title, description, location, start/end epoch, all-day, status, organizer, attendees JSON, calendar, provider remote ID, ETag, raw iCal and UID. CRUD exists for Google/CalDAV.

### Required gap

- master vs occurrence identity;
- event timezone/floating/all-day exclusive date semantics;
- transparency, privacy/classification, availability status;
- conference/attachments/resources;
- mutation version/conflict metadata and offline state;
- normalized attendees/reminders/recurrence.

### Proposed

Keep the table as event master/cache root and add explicit columns/tables. Use provider adapters to map provider-specific resource/version fields. UI mutations produce typed commands and optimistic local state; sync reconciles by UID/resource/version rather than destructive range refresh.

## Recurrence

### Current

CalDAV parser finds a master, reads `RRULE`, `EXDATE`, `RECURRENCE-ID`, expands with `rrule`, overlays/cancels exceptions and creates synthetic instance IDs. Raw series fields are preserved on master edit. Time editing is disabled for recurring events.

### Required gap

- create/edit recurrence;
- instance/series/future scope;
- RDATE, multiple rules/exdates and provider differences;
- DST-safe wall-clock expansion;
- normalized exception/tombstone storage;
- Google recurrence arrays and cancelled instances;
- conflict/idempotency rules.

### Proposed

Store recurrence master rule + original TZID/wall start. Keep exceptions as separate records keyed by recurrence ID. Use a single recurrence engine adapter with bounded expansion/cache and property-based DST tests. Provider mutation command must require explicit scope.

## Attendees / identity

### Current

Create accepts `{email}` only. Parsed attendee JSON contains email/display name/response status. Organizer is a separate email. Mail autocomplete can search local/recent contacts; CardDAV/LDAP/rich contact infrastructure exists.

### Required gap

Required/optional/resource roles, RSVP flags, delegation, comments, stable corporate user identity, directory search, freebusy address, guest permissions and notification delivery.

### Proposed

Introduce `ParticipantIdentity` and normalized attendees. Email remains protocol key/fallback; provider/directory IDs are scoped by account/org. Build participant picker on contact/directory services with role/status chips, not a comma-separated TextField.

## FreeBusy / scheduling

### Current

No FreeBusy symbols, provider methods, DB entity, UI or tests.

### Required gap

Provider fetch, authorization, privacy-safe intervals, attendee lanes, working hours, timezones, resource availability, suggestion algorithm and stale/cache behavior.

### Proposed

```text
Participant picker
  → Identity resolver (account/org/provider)
  → FreeBusy provider adapter
  → short-lived opaque interval cache
  → privacy projection (details | busy-only | unknown)
  → scheduling grid + suggested-time solver
```

The solver intersects required attendees and working hours, treats optional attendees as a score, accounts for travel/buffer/resources and returns reasons. It must never require event summaries for availability.

## ICS / iTIP

### Current

Basic VEVENT generator/parser; invitation parser covers METHOD, UID, SEQUENCE, RECURRENCE-ID, DTSTART/DTEND, ORGANIZER, ATTENDEE/PARTSTAT, STATUS and TZID warning. Attachments can be fetched. Generic outgoing attachments work.

### Required gap

RFC 5545/5546 MIME semantics, VTIMEZONE, folded/quoted parameters, RRULE/RDATE/EXDATE completeness, VALARM, TRANSP, CLASS, roles, RSVP delivery and method-specific validation.

### Proposed

- adopt/validate a standards-oriented parser/serializer behind `ICalendarCodec`;
- retain current fixtures and add real provider fixtures;
- separate semantic domain from raw round-trip representation;
- add `CalendarMimePart` and `ItipMessage` types;
- idempotency by account + UID + recurrence ID + sequence + method;
- sanitize/redact raw iCalendar in diagnostics.

## Mail integration

### Current

ThreadView detects raw VCALENDAR in body and `.ics`/`text/calendar` attachments, persists invitation and renders invite card. RSVP becomes local projection + pending op, then blocks. Calendar event details may respond directly through Calendar provider.

### Required gap

One coherent delivery/reconciliation path, sync-time parsing, organizer outbound messages, cancellation/update propagation and Sent/Outbox state.

### Proposed

```text
Inbound MIME → Calendar invitation ingest → UID/sequence reconciler → Calendar DB/UI
Calendar mutation → provider capability decision
  ├─ direct API/CalDAV scheduling
  └─ iMIP via EmailProvider/Outbox
Delivery result → invitation/event participation reconciliation
```

Do not mark local RSVP as delivered until either direct provider or iMIP send is confirmed.

## Permissions / privacy

### Current

Account-scoped storage and general security patterns exist, but Calendar ACL/CLASS/transparency do not.

### Required gap

Owner/editor/viewer/freebusy-only roles, share/subscription lifecycle, privacy projection per viewer, guest visibility and safe logs/cache.

### Proposed

Provider ACL adapter plus local cached projection. Every read model receives an access context. Event details are omitted when policy returns busy-only. UI capability gates are secondary; authorization must be enforced by provider/server and service boundary.

## Reminders

### Current

No event reminder entity or VALARM. Existing background checker and OS notification infrastructure is reusable.

### Required gap

Multiple reminders, popup/email types, recurring instances, timezone/DST, snooze, dismiss, restart/sleep catch-up and provider sync.

### Proposed

Add reminder table and application service. Start with app-running checker using existing overlap-safe pattern; document delivery limitation. Later add native OS scheduling where product requirements demand reminders while app is closed.

## Timezone contract

Recommended canonical types:

```text
Timed event: instantStart + instantEnd + eventTzid + original local wall fields
Floating event: localStart + localEnd + floating=true (no implied UTC until viewer context)
All-day event: startDate + exclusiveEndDate (no 23:59:59)
Recurring master: local wall DTSTART + TZID + recurrence rule
Occurrence: masterId + recurrenceId + resolved instants
```

Formatting and week-start preferences belong to user/account settings, not provider payload.

## Library decision gate

No new Calendar UI library should be chosen before a time-boxed spike compares:

- custom layout + `@dnd-kit/core`;
- mature Calendar component(s), including licensing;
- recurrence scope API fit;
- a11y/keyboard drag/resize;
- overlap/all-day/multi-zone/resource rendering;
- ability to match Office360 design without fighting generated DOM/CSS;
- bundle/performance cost.

The current Day/Week layout is not an adequate base for drag/resize parity, regardless of library choice.
