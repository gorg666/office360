# CAL-AUDIT-001 — Calendar implementation roadmap

Baseline: `10c7a54`; CAL-101 runtime baseline approved on feature branch.
Roadmap state: CAL-101A, CAL-101B, CAL-101C, CAL-102, CAL-102F, CAL-103, CAL-104, CAL-105, CAL-106, CAL-107, CAL-108, CAL-109, CAL-110 and CAL-111 completed. This document is the source of truth for Calendar ticket numbering.

**Numbering corrected on 2026-08-22.** Delivered tickets keep the numbers they shipped under: CAL-106 is the participant identity/attendee model, CAL-107 is the Free/Busy foundation, CAL-108 is the Scheduling Assistant engine. Only unstarted sections were renumbered; no completed ticket history was rewritten. Where an earlier section's scope was partly delivered under a different number, the remaining section was narrowed to the outstanding work and says so explicitly.

## ID convention


Existing QA history already uses `CAL-001` for the Yandex Calendar runtime failure. Чтобы не создать два разных `CAL-001`, новый implementation roadmap начинается с **CAL-101**. Historical bug `CAL-001` должен быть закрыт или перенесён в этот roadmap как acceptance dependency, а не переиспользован молча.


## Delivery principles


- Branch only after dirty-worktree cleanup and baseline approval.
- Domain/time/privacy contracts precede rich UI.
- DB migrations are append-only.
- Provider features are capability-driven; direct API and iMIP delivery are explicit alternatives.
- Each ticket includes targeted tests and docs; interactive UI also needs Tauri runtime smoke.
- No ticket claims Yandex support without a live provider smoke.
- Provider contracts, DB migrations and recurrence/timezone changes should not be developed in overlapping write branches.


## Dependency outline

```text
CAL-101 gate  ->  CAL-102 time/occurrence  ->  CAL-103 codec
                                          ->  CAL-104 persistence/sync  ->  CAL-105 provider/write
CAL-106 participant identity  ->  CAL-107 Free/Busy foundation  ->  CAL-108 scheduling engine
                                                                ->  CAL-109 Scheduling Assistant UI
                                                                ->  CAL-110 remote Free/Busy adapters
CAL-105 provider/write  ->  CAL-111 recurrence mutation backend  ->  CAL-112 recurring edit UX
CAL-113 Mail inbound  ->  CAL-114 outbound iTIP/RSVP
CAL-115 application service/UI state  ->  CAL-116 layout engine  ->  CAL-117 drag/resize
                                      ->  CAL-118 event editor
CAL-119 shared calendars/permissions
CAL-120 reminders
CAL-121 search/performance/a11y
CAL-122 end-to-end parity release gate
```

## CAL-101 — Approve clean baseline and reproduce Calendar runtime


**Цель:** создать безопасную отправную точку и закрыть неопределённость historical `A2/CAL-001`.

**Основные файлы/модули:** Git/worktree docs, `src/services/calendar/yandex*.ts`, `caldavProvider.ts`, account OAuth services, QA docs. Код меняется только в отдельном follow-up, если reproduction найдёт defect.

**Зависимости:** решение владельца по dirty files/stash; тестовый Yandex/CalDAV account без публикации secrets.

**Definition of Done:**

- clean `git status` или документированный isolated worktree;
- baseline commit/branch утверждены;
- live Tauri: account auth → list calendars → load events;
- результат historical CAL-001 = PASS либо новый точный blocker с sanitized evidence;
- no tokens/raw calendar data in logs.

**Риски:** OAuth scopes/client configuration, network/provider availability, unrelated EFIM integration blocker.

### CAL-101 delivery status

- **CAL-101A — completed:** read-only Yandex CalDAV runtime chain verified; historical A2/CAL-001 not reproduced; sanitized response-level evidence recorded in `CALENDAR_RUNTIME_BASELINE.md`.
- **CAL-101B — completed:** `CAL-BUG-101` closed with explicit `loading | fresh | stale | error` UI semantics shared by Google and CalDAV/Yandex, cached stale-data notice, no-cache error state, Retry and targeted A–D tests.
- **CAL-101C — completed:** `CAL-BUG-103` closed with expiry-aware CalDAV/Yandex session reuse, provider/session single-flight creation, failed-creation recovery and one bounded auth invalidation/retry. Live read-only smoke confirmed one login/discovery chain across six session requests.
- Empty cached ranges remain indistinguishable from a cache miss until a later persistence ticket introduces range-completeness metadata; CAL-101B deliberately treats an empty result as no usable cache and does not change the DB schema.
- **Next:** CAL-103 may start only by explicit instruction; it is not started by CAL-102.


## CAL-102 — Calendar domain and timezone contracts


**Цель:** определить стабильные модели timed/floating/all-day events, recurrence masters/occurrences, privacy и participant roles.

**Основные файлы/модули:** `src/services/calendar/types.ts`, новый `domain/`, time utilities, ADR/wiki.

**Зависимости:** CAL-101; product decisions on week start, default timezone and privacy levels.

**Definition of Done:**

- provider-neutral timed-zoned/floating/all-day and occurrence identity contracts;
- IANA TZID + wall-time + exclusive all-day rules documented and TZ-pinned;
- Google/CalDAV mapping conformance and wall-clock recurrence fixtures;
- minimal participant identity and explicit provider capabilities;
- approved append-only v34 with lazy legacy compatibility.

**Риски:** backward compatibility with existing epoch/raw iCal records.

**Implementation (2026-08-22):** минимальный provider-neutral `domain/` различает timed-zoned, floating и all-day values; IANA resolver централизует DST gap/overlap policy; wall-clock recurrence формирует стабильный `occurrenceKey` для RRULE/EXDATE/RECURRENCE-ID/RDATE. Google и CalDAV проходят единый mapping contract, а `fetchEvents`/`syncEvents` используют один expansion path. Append-only migration v34 сохраняет TZID/wall/date/series/occurrence/TRANSP/SEQUENCE; legacy rows выводят semantics лениво без массового backfill. Канон: `CALENDAR_TIME_MODEL.md`.

**Acceptance:** PASS. Four-host-TZ matrix, provider conformance, 2025-test full Vitest, production build, cargo check, in-memory SQLite fresh/existing/legacy/new-row smoke, and read-only Tauri Yandex Month/Week/Day/calendar-list smoke passed. Local development DB applied v34 with all ten semantic columns; subsequent normal sync populated semantic fields. CAL-102F additionally isolated malformed objects/components with safe degraded-read diagnostics and made recurrence range lookback duration-aware. No cloud mutations were performed.


## CAL-103 — Standards-oriented iCalendar codec


**Цель:** заменить regex helpers как authoritative semantic parser/serializer, сохранив compatibility.

**Основные файлы/модули:** `icalHelper.ts`, new codec adapter, fixtures/tests.

**Зависимости:** CAL-102; dependency/license decision.

**Definition of Done:**

- VEVENT, RRULE/RDATE/EXDATE, RECURRENCE-ID, VTIMEZONE/TZID, ORGANIZER/ATTENDEE roles, STATUS/TRANSP/CLASS, VALARM;
- folding, escaping, quoted params and multi-event fixtures;
- round-trip provider fixtures;
- current helper tests retained or migrated;
- raw calendar content redacted from diagnostics.

**Риски:** malformed real-world ICS, library bundle/license/security.

**Acceptance:** PASS. `ical.js` 2.2.1 (MPL-2.0) is isolated in `src/services/calendar/ical/codec.ts`; handwritten production parsing/serialization was removed. CAL-102 time/occurrence semantics, malformed isolation, Mail invitations, CalDAV/Yandex paths, Google conformance, legacy lazy reads, recurrence metadata, VTIMEZONE preservation, and provider-neutral unknown-TZID diagnostics are covered. The four-host-TZ command now includes codec tests. Details and limitations: `CALENDAR_ICAL_CODEC.md`.


## CAL-104 — Normalize Calendar persistence and sync state


**Цель:** добавить additive schema для attendees, recurrence exceptions, reminders, permissions/subscriptions, working hours, FreeBusy cache and pending ops.

**Основные файлы/модули:** `src/services/db/migrations.ts`, Calendar repositories/tests.

**Зависимости:** CAL-102; explicit migration approval required before execution against real DB.

**Definition of Done:**

- append-only migration and repository APIs;
- existing events readable/backfilled lazily or by safe migration strategy;
- account/org scope on every new table/index;
- raw iCal remains available but not sole semantic store;
- migration tests and rollback/recovery notes.

**Риски:** data migration, duplicate identities/occurrences, DB growth. This ticket requires APOSTLE migration confirmation.

**Acceptance:** PASS. Approved append-only v35 adds explicit local projection lifecycle and durable per-calendar range coverage without rewriting existing rows. `CalendarSyncService` owns cache-first bounded refresh, authoritative/degraded reconciliation, safe deletion ordering, offline state and diagnostics; `CalendarPage` keeps presentation state with generation guards. Google bounded fetch pagination, honest CalDAV `range-refresh` capability, RSVP projection cleanup, synced-empty semantics and bounded legacy normalization cache are covered. Canonical model: `CALENDAR_SYNC_CACHE_MODEL.md`.


## CAL-105 — Provider/write readiness


**Цель:** завершить provider-specific write/conflict readiness поверх CAL-104 service/cache boundary и честно объявить текущий sync mode/durability.

**Основные файлы/модули:** `providerFactory.ts`, `types.ts`, Google/CalDAV providers, new calendar sync manager/store, DB sync state.

**Зависимости:** CAL-102, CAL-104.

**Definition of Done:**

- typed capability matrix (CRUD, recurrence scope, RSVP, FreeBusy, ACL, reminders);
- explicit Google sync-token and CalDAV range-refresh capability/durability facts;
- provider write conflict/retry policy and truthful mutation capabilities;
- offline/error/conflict states surfaced to UI;
- provider contract and sync tests.

**Риски:** provider divergence, rate limits, ETag conflicts.

**Acceptance:** PASS. Capability contract v2 now covers read/CRUD, recurrence scopes, attendees, local/remote RSVP, invitation delivery, sync mode/durability, Free/Busy, ACL, shared calendars, reminders and conflict detection. React uses capabilities instead of method presence, while `CalendarMutationService` gates writes and returns safe typed results. Google and CalDAV/Yandex use ETag preconditions where a cached ETag exists; CalDAV/Yandex occurrence deletion is rejected before the shared series resource can be deleted. Successful writes reconcile only through the CAL-104 range-refresh owner. Canonical matrix: `CALENDAR_PROVIDER_CAPABILITIES.md`.

Durable Google sync-token persistence and CalDAV sync-collection/ctag deltas were not part of the approved CAL-105 implementation scope and remain explicit limitations for CAL-106/provider-readiness follow-up. No migration was needed.


## CAL-106 (delivered) — Participant identity and attendee model

**Participant-domain acceptance (2026-08-22):** PASS. The owner-approved CAL-106 scope established provider-neutral participant identity, organizer/attendee separation, roles, response status, RSVP, CUTYPE/resource semantics, delegation, deterministic duplicate merge, Google/CalDAV conformance and legacy JSON compatibility. It required no migration: the existing event-scoped JSON column stores a versioned canonical envelope without backfill or N+1 reads. Month/Week/Day, event details, organizer and optional-attendee rendering were confirmed live — see `CALENDAR_RUNTIME_BASELINE.md`. Canon: `CALENDAR_PARTICIPANT_MODEL.md`.

## CAL-107 (delivered) — Provider-neutral Free/Busy foundation


**Цель:** ответить «кто / на какой интервал / в какой timezone / занят или свободен / почему / насколько можно доверять», не строя Scheduling Assistant.

**Основные файлы/модули:** `src/services/calendar/freeBusy/`, `domain/capabilities.ts` (`version: 3`).

**Зависимости:** CAL-102 time foundation, CAL-104 coverage metadata, CAL-106 `ParticipantRef`.

**Acceptance (2026-08-22):** PASS. Availability state и reliability разделены; `unknown`, `partial`, `unsupported`, `permission-denied` и `error` структурно не сводятся к `free`. Проекция событий учитывает `TRANSP`, `STATUS:CANCELLED`, tentative, declined-самого-себя и unconfirmed local projections; recurrence/EXDATE/RDATE/RECURRENCE-ID берутся из уже нормализованных occurrences. Занятость собирается по всем календарям аккаунта независимо от UI-видимости. Local-derived adapter реализован для текущего аккаунта; остальные identity честно возвращают `unsupported`. Миграция не потребовалась. Канон: `CALENDAR_FREE_BUSY_MODEL.md`.

**Не входило:** Scheduling Assistant UI, group slot recommendation, working hours, remote Google/Yandex Free/Busy, participant picker, room booking, permissions/ACL.


## CAL-108 (delivered) — Scheduling Assistant foundation and group availability engine

**Цель:** provider-neutral групповой scheduling engine: групповой timeline, классификация слотов, поиск кандидатов и детерминированный ranking поверх CAL-107.

**Основные файлы/модули:** `src/services/calendar/scheduling/`.

**Зависимости:** CAL-106 `ParticipantRef`, CAL-107 `FreeBusyService`.

**Acceptance (2026-08-22):** PASS. Engine потребляет только `ParticipantAvailability` и никогда не пересчитывает события. Required/optional разделены: optional конфликт ухудшает ranking, но не отменяет слот. `unknown`, `unsupported`, `permission-denied` и `error` структурно не сводятся к `free` — такой слот не может стать `confirmed`. Tentative отличается от hard busy отдельной policy. Working hours — независимый constraint с собственной причиной недоступности, применяется только когда данные предоставлены. Multi-day и DST-переходы обрабатываются через CAL-102 resolver, без host timezone. Канон: `CALENDAR_SCHEDULING_ASSISTANT_MODEL.md`.

**Не входило:** визуальный Scheduling Assistant, remote Free/Busy adapters, participant picker, настройки рабочего времени, room booking.

## CAL-109 (delivered) — Scheduling Assistant UI

**Цель:** визуальный Scheduling Assistant уровня Яндекс 360 поверх готового CAL-108 engine.

**Основные файлы/модули:** `src/components/calendar/scheduling/`, `EventCreateModal`, `EventDetailModal` (режим редактирования), `CalendarPage`.

**Зависимости:** CAL-108.

**Acceptance (2026-08-22):** PASS. Assistant встроен в create/edit event. UI — thin consumer `planMeeting` / `GroupSchedulingResult`. Required/optional, busy/tentative/unknown, group row, suggestions и синхронизация start/end работают без повторного расчёта занятости в React. Unknown/unsupported не рисуются как free. Канон UI: `CALENDAR_SCHEDULING_ASSISTANT_UI.md`.

**Не входило:** remote Free/Busy adapters, новый participant picker backend, room booking, drag/resize сетки календаря.

## CAL-110 (delivered) — Remote Free/Busy provider adapters

**Цель:** реальные remote Free/Busy adapters, чтобы занятость других участников перестала быть `unsupported`.

**Основные файлы/модули:** provider adapters, `freeBusy/` port implementations, capability matrix.

**Зависимости:** CAL-107 port; existing provider auth/discovery readiness.

**Definition of Done:**

- Google `freeBusy.query` adapter;
- CalDAV/Yandex RFC 6638 free-busy `REPORT` adapter либо документированное отсутствие поддержки;
- capability `freeBusy.others` переводится в `remote` только при рабочем adapter;
- `permission-denied` и `error` не сводятся к `unsupported` или к свободному времени;
- opaque intervals без event details; batching, rate-limit, отмена;
- privacy/ACL тесты и live corporate smoke, где возможно.

**Риски:** provider support, авторизация, утечка через inference.

**Acceptance (2026-08-22):** PASS. Google uses the official 50-item batch endpoint with per-participant failures, cancellation and privacy projection. Generic CalDAV is enabled only after RFC 6638 principal/outbox/auto-schedule discovery and posts VFREEBUSY to the outbox. Yandex discovery is read-only and remains unsupported. Account/provider-scoped 60-second cache and exact-request coalescing require no migration. Canonical contract: `CALENDAR_REMOTE_FREE_BUSY.md`.

## CAL-111 (delivered) — Recurring event mutation semantics

**Цель:** безопасные provider-neutral `single` / `series` / `this-and-future` mutation semantics до recurring edit UI.

**Основные файлы/модули:** `CalendarMutationService`, Google/CalDAV providers, `ical.js` codec, occurrence identity.

**Зависимости:** CAL-102 occurrence identity, CAL-103 codec, CAL-104 reconciliation, CAL-105 typed writes/capabilities.

**Acceptance (2026-08-22):** explicit scope and canonical series/occurrence identity reach the provider. Google and CalDAV/Yandex support safe single/series update/delete; CalDAV single delete is EXDATE PUT rather than resource delete. Google series operations resolve the master and its ETag. `this-and-future` is truthfully unsupported. RRULE/RDATE/EXDATE/overrides, TZID and original RECURRENCE-ID are covered by fixtures. No migration and no live cloud mutation. Canonical contract: `CALENDAR_RECURRENCE_MUTATIONS.md`.

## CAL-112 — Recurring edit UX

**Цель:** финальный prompt «только это / это и последующие / вся серия» и подключение Scheduling Assistant start/end к CAL-111 contract.

**Зависимости:** CAL-111.

**Definition of Done:** capability-driven scope choices; unsupported scopes disabled/explained; no implicit scope inference; single move keeps original identity; Month/Week/Day runtime acceptance without accidental remote writes.

**Не входит:** backend split-series implementation, participant directory, room booking.

### Pending backlog without a reassigned ticket number

- Participant picker/directory over CAL-106 identity (debounced multi-source search, roles, dedupe, privacy and account isolation).
- Yandex/CalDAV production readiness (reproducible auth/discovery/list/fetch/CRUD and provider diagnostics).

These scopes were previously labeled CAL-111/CAL-112 before the explicit owner handoff assigned those numbers to recurrence backend/UI. They stay pending and must receive new numbers before implementation; completed ticket history is unchanged.


## CAL-113 — Mail inbound calendar MIME ingestion


**Цель:** reliably ingest calendar parts during mail sync, not only when a thread is opened.

**Основные файлы/модули:** Gmail/IMAP parsers, `EmailProvider` parsed message contract, sync paths, invitations service/DB, ThreadView.

**Зависимости:** CAL-103, CAL-104.

**Definition of Done:**

- recursive MIME extraction for `text/calendar` and `.ics` across mixed/alternative/related;
- body/attachment/inline calendar parts modeled uniformly;
- REQUEST/update/CANCEL idempotency by UID/recurrence/sequence;
- invitation visible before opening source message where sync payload permits;
- Gmail and IMAP fixture tests; no raw MIME logging.

**Риски:** provider attachment lazy-fetch cost, malformed MIME, duplicate events.


## CAL-114 — Outbound invitations, updates, cancellations and RSVP


**Цель:** объединить direct provider and iMIP delivery with truthful queue states.

**Основные файлы/модули:** invitations service, Calendar provider capabilities, email builder, composer/send orchestrator, pending operations/Outbox/Sent.

**Зависимости:** CAL-103, CAL-105, CAL-113.

**Definition of Done:**

- generate/send `METHOD:REQUEST|REPLY|CANCEL` with correct UID/SEQUENCE/RECURRENCE-ID;
- direct API/CalDAV scheduling when supported, iMIP fallback otherwise;
- local RSVP state reconciled only after confirmed delivery;
- organizer update/cancel flows and retries visible;
- provider + MIME integration tests; safe dry-run fixtures.

**Риски:** duplicate invitations, incorrect sequence semantics, mail deliverability.


## CAL-115 — Calendar application service and UI state


**Цель:** отделить CalendarPage from provider/DB orchestration and establish optimistic/offline commands.

**Основные файлы/модули:** CalendarPage, new calendar service/store/hooks, provider sync manager.

**Зависимости:** CAL-104, CAL-105.

**Definition of Done:**

- Page is presentation/composition layer;
- explicit load/sync/mutation/error/offline states;
- cache-first behavior without swallowed failures;
- account/calendar switching race-safe;
- focused service/store/component tests.

**Риски:** duplicate fetches, stale account closures, large rerender surface.


## CAL-116 — Accessible Month/Week/Day layout engine


**Цель:** заменить hourly bucket prototype единым calendar layout engine.

**Основные файлы/модули:** MonthView, WeekView, DayView, EventCard, new layout utilities/components.

**Зависимости:** CAL-102, CAL-115; library spike decision.

**Definition of Done:**

- continuous timed positioning and duration height;
- deterministic overlapping columns;
- multi-day/all-day lanes and overflow;
- current-time indicator, configurable week start, correct locale/zone labels;
- keyboard navigation and screen-reader semantics;
- visual/unit tests at multiple densities and dark/light themes.

**Риски:** accessibility, layout complexity, bundle size.


## CAL-117 — Event drag, resize and selection


**Цель:** добавить safe drag/resize/create-by-selection поверх нового layout.

**Основные файлы/модули:** layout engine, DnD provider/hooks, mutation service, event editor.

**Зависимости:** CAL-115, CAL-116.

**Definition of Done:**

- drag across time/day/all-day with snap and auto-scroll;
- resize start/end with minimum duration;
- keyboard equivalents and announcements;
- optimistic update + rollback/conflict handling;
- recurrence scope prompt where required;
- pointer/touch/keyboard tests and Tauri smoke.

**Риски:** accidental mutation, DST boundary drag, recurring scope, touch behavior.


## CAL-118 — Full event editor: recurrence, reminders, privacy, timezone


**Цель:** заменить basic modal полноценным Office360 event editor.

**Основные файлы/модули:** EventCreateModal/EventDetailModal replacement, reusable UI primitives, domain commands.

**Зависимости:** CAL-102, CAL-103, CAL-104, CAL-115.

**Definition of Done:**

- all-day, event timezone, recurrence presets/custom rule, instance/series scope;
- reminders, availability/transparency, privacy/classification;
- calendar selector, organizer/participants, validation and unsaved changes guard;
- provider capability-based fields;
- localization, keyboard/a11y and tests.

**Риски:** oversized component; use compound sections/provider-decoupled state.


## CAL-119 — Shared calendars, subscriptions and permissions


**Цель:** поддержать provider calendars beyond visibility toggles.

**Основные файлы/модули:** calendar list/settings, provider ACL/subscription adapters, permissions tables.

**Зависимости:** CAL-104, CAL-105, privacy model.

**Definition of Done:**

- owner/editor/viewer/freebusy-only projections;
- subscribe/unsubscribe, ordering/color and writable-state UI;
- CRUD controls hidden and service-blocked without permission;
- provider mismatch states and tests.

**Риски:** provider ACL incompatibility, stale permissions, accidental writes.


## CAL-120 — Event reminders and notification actions


**Цель:** добавить reliable in-app/desktop reminders.

**Основные файлы/модули:** reminder DB/service, backgroundCheckers, notificationManager, deep-link navigation.

**Зависимости:** CAL-104, CAL-115, CAL-118.

**Definition of Done:**

- multiple relative reminders per event/occurrence;
- trigger, snooze, dismiss, open event actions;
- restart/sleep catch-up and dedupe;
- timezone/recurrence correctness;
- documented app-closed guarantee and native follow-up if needed;
- tests + desktop smoke.

**Риски:** missed/duplicate notifications, OS permission differences.


## CAL-121 — Calendar search, performance and accessibility hardening


**Цель:** подготовить product-scale data/UI after core features stabilize.

**Основные файлы/модули:** DB indexes/search, Calendar store/selectors, layout/scheduling UI, command palette.

**Зависимости:** CAL-115–CAL-120 as applicable.

**Definition of Done:**

- account/permission-filtered event search;
- bounded occurrence expansion and cache;
- measured large-calendar and large-attendee performance;
- virtualization only where measurements justify it;
- WCAG keyboard/focus/color/announcement audit;
- bundle/chunk review.

**Риски:** indexing sensitive fields, premature virtualization, bundle growth.


## CAL-122 — End-to-end parity release gate


**Цель:** собрать provider, Mail, time, privacy and UI flows into verified release candidate.

**Основные файлы/модули:** cross-cutting tests, docs/wiki, desktop smoke scenarios.

**Зависимости:** all accepted feature tickets; separate Yandex UX comparison/acceptance spec.

**Definition of Done:**

- traceable parity matrix and accepted exclusions;
- Google + Yandex/CalDAV provider smoke;
- Mail REQUEST/REPLY/CANCEL round-trip;
- recurring/DST/FreeBusy/privacy/shared-calendar scenarios;
- clean build/test/cargo checks, installed Tauri smoke, no new console errors;
- migration/recovery/security review and release notes.

**Риски:** provider test accounts, platform-specific notifications, unresolved product parity decisions.


## Historical note — first implementation ticket


**CAL-101 — Approve clean baseline and reproduce Calendar runtime.**

Это engineering gate, а не UI feature. После него первый code foundation ticket — **CAL-102 — Calendar domain and timezone contracts**. Начинать с drag/resize или redesigned views до CAL-102–CAL-104 рискованно: UI закрепит неверные identity/time/recurrence semantics.
