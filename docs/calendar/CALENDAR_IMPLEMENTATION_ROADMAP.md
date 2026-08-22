# CAL-AUDIT-001 — Calendar implementation roadmap

Baseline: `10c7a54`; CAL-101 runtime baseline approved on feature branch.
Roadmap state: CAL-101A, CAL-101B, CAL-101C, CAL-102, CAL-103 and CAL-104 completed; CAL-105 requires a separate explicit start.

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
CAL-101 Git/runtime gate
  → CAL-102 domain + timezone contracts
    ├─ CAL-103 iCalendar codec
    └─ CAL-104 normalized DB + sync state
      → CAL-105 provider capabilities/sync
        ├─ CAL-106 Yandex/CalDAV runtime
        ├─ CAL-107 Mail inbound
        │   → CAL-108 outbound iTIP/RSVP
        └─ CAL-109 event application service
            → CAL-110 time-grid layout
              → CAL-111 drag/resize
            → CAL-112 editor/recurrence/reminders/privacy
            → CAL-113 participant identity/picker
              → CAL-114 FreeBusy service
                → CAL-115 scheduling assistant
        → CAL-116 shared calendars/permissions
        → CAL-117 reminder delivery
  → CAL-118 search/performance/a11y
  → CAL-119 end-to-end parity release gate
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

## CAL-105 — Provider/write readiness and durable delta sync

**Цель:** завершить provider-specific write/conflict readiness и durable delta sync поверх CAL-104 service/cache boundary.

**Основные файлы/модули:** `providerFactory.ts`, `types.ts`, Google/CalDAV providers, new calendar sync manager/store, DB sync state.

**Зависимости:** CAL-102, CAL-104.

**Definition of Done:**

- typed capability matrix (CRUD, recurrence scope, RSVP, FreeBusy, ACL, reminders);
- durable Google sync-token adoption/recovery; CalDAV ctag/sync-collection/fallback policy;
- provider write conflict/retry policy and truthful mutation capabilities;
- offline/error/conflict states surfaced to UI;
- provider contract and sync tests.

**Риски:** provider divergence, rate limits, ETag conflicts.

## CAL-106 — Yandex/CalDAV production readiness

**Цель:** обеспечить reproducible Yandex calendar auth/discovery/list/fetch/CRUD на живом account.

**Основные файлы/модули:** `yandex.ts`, `yandexCalDavAuth.ts`, `autoDiscovery.ts`, OAuth token manager, account setup/diagnostics.

**Зависимости:** CAL-101, CAL-105.

**Definition of Done:**

- scope/capability diagnostics without exposing tokens;
- token refresh/re-auth flow;
- list/fetch/create/update/delete smoke in Tauri;
- provider-specific errors localized/actionable;
- historical A2/CAL-001 closed with evidence.

**Риски:** Yandex OAuth application configuration and undocumented/provider-specific CalDAV behavior.

## CAL-107 — Mail inbound calendar MIME ingestion

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

## CAL-108 — Outbound invitations, updates, cancellations and RSVP

**Цель:** объединить direct provider and iMIP delivery with truthful queue states.

**Основные файлы/модули:** invitations service, Calendar provider capabilities, email builder, composer/send orchestrator, pending operations/Outbox/Sent.

**Зависимости:** CAL-103, CAL-105, CAL-107.

**Definition of Done:**

- generate/send `METHOD:REQUEST|REPLY|CANCEL` with correct UID/SEQUENCE/RECURRENCE-ID;
- direct API/CalDAV scheduling when supported, iMIP fallback otherwise;
- local RSVP state reconciled only after confirmed delivery;
- organizer update/cancel flows and retries visible;
- provider + MIME integration tests; safe dry-run fixtures.

**Риски:** duplicate invitations, incorrect sequence semantics, mail deliverability.

## CAL-109 — Calendar application service and UI state

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

## CAL-110 — Accessible Month/Week/Day layout engine

**Цель:** заменить hourly bucket prototype единым calendar layout engine.

**Основные файлы/модули:** MonthView, WeekView, DayView, EventCard, new layout utilities/components.

**Зависимости:** CAL-102, CAL-109; library spike decision.

**Definition of Done:**

- continuous timed positioning and duration height;
- deterministic overlapping columns;
- multi-day/all-day lanes and overflow;
- current-time indicator, configurable week start, correct locale/zone labels;
- keyboard navigation and screen-reader semantics;
- visual/unit tests at multiple densities and dark/light themes.

**Риски:** accessibility, layout complexity, bundle size.

## CAL-111 — Event drag, resize and selection

**Цель:** добавить safe drag/resize/create-by-selection поверх нового layout.

**Основные файлы/модули:** layout engine, DnD provider/hooks, mutation service, event editor.

**Зависимости:** CAL-109, CAL-110.

**Definition of Done:**

- drag across time/day/all-day with snap and auto-scroll;
- resize start/end with minimum duration;
- keyboard equivalents and announcements;
- optimistic update + rollback/conflict handling;
- recurrence scope prompt where required;
- pointer/touch/keyboard tests and Tauri smoke.

**Риски:** accidental mutation, DST boundary drag, recurring scope, touch behavior.

## CAL-112 — Full event editor: recurrence, reminders, privacy, timezone

**Цель:** заменить basic modal полноценным Office360 event editor.

**Основные файлы/модули:** EventCreateModal/EventDetailModal replacement, reusable UI primitives, domain commands.

**Зависимости:** CAL-102, CAL-103, CAL-104, CAL-109.

**Definition of Done:**

- all-day, event timezone, recurrence presets/custom rule, instance/series scope;
- reminders, availability/transparency, privacy/classification;
- calendar selector, organizer/participants, validation and unsaved changes guard;
- provider capability-based fields;
- localization, keyboard/a11y and tests.

**Риски:** oversized component; use compound sections/provider-decoupled state.

## CAL-113 — Participant identity and picker

**Цель:** объединить local/recent/CardDAV/LDAP/provider directory identities and attendee roles.

**Основные файлы/модули:** contacts DB/services, AddressInput-derived picker, calendar attendees repositories.

**Зависимости:** CAL-102, CAL-104.

**Definition of Done:**

- debounced multi-source directory search;
- stable account/org/provider identity + normalized email fallback;
- required/optional/resource roles and duplicate prevention;
- status/avatar/display name with privacy-safe data;
- account isolation tests.

**Риски:** global contact email uniqueness, directory latency, identity collisions.

## CAL-114 — Privacy-safe FreeBusy service

**Цель:** получить занятость участников без раскрытия event details.

**Основные файлы/модули:** provider contracts/adapters, new FreeBusy service/cache, permissions and attendee identity.

**Зависимости:** CAL-104, CAL-105, CAL-113, privacy decisions.

**Definition of Done:**

- opaque busy interval contract and short-lived scoped cache;
- provider implementations/fallback status (`busy`, `free`, `unknown`, permission denied);
- no summary/location in busy-only records/logs;
- batching/rate-limit/cancellation behavior;
- privacy/ACL tests and live corporate smoke where supported.

**Риски:** provider support, authorization, inference/privacy leakage.

## CAL-115 — Scheduling assistant and suggested time

**Цель:** визуализировать participant schedules and recommend common free slots.

**Основные файлы/модули:** new scheduling UI, working-hours repository, solver, FreeBusy service.

**Зависимости:** CAL-110, CAL-113, CAL-114.

**Definition of Done:**

- attendee lanes with per-person timezone/working hours;
- required attendees as hard constraints, optional attendees as score;
- duration/buffer/resource constraints;
- suggested slots with reason/explanation and stale/unknown states;
- performance, a11y, zone/DST and privacy tests.

**Риски:** combinatorial UX, false certainty from unknown availability.

## CAL-116 — Shared calendars, subscriptions and permissions

**Цель:** поддержать provider calendars beyond visibility toggles.

**Основные файлы/модули:** calendar list/settings, provider ACL/subscription adapters, permissions tables.

**Зависимости:** CAL-104, CAL-105, privacy model.

**Definition of Done:**

- owner/editor/viewer/freebusy-only projections;
- subscribe/unsubscribe, ordering/color and writable-state UI;
- CRUD controls hidden and service-blocked without permission;
- provider mismatch states and tests.

**Риски:** provider ACL incompatibility, stale permissions, accidental writes.

## CAL-117 — Event reminders and notification actions

**Цель:** добавить reliable in-app/desktop reminders.

**Основные файлы/модули:** reminder DB/service, backgroundCheckers, notificationManager, deep-link navigation.

**Зависимости:** CAL-104, CAL-109, CAL-112.

**Definition of Done:**

- multiple relative reminders per event/occurrence;
- trigger, snooze, dismiss, open event actions;
- restart/sleep catch-up and dedupe;
- timezone/recurrence correctness;
- documented app-closed guarantee and native follow-up if needed;
- tests + desktop smoke.

**Риски:** missed/duplicate notifications, OS permission differences.

## CAL-118 — Calendar search, performance and accessibility hardening

**Цель:** подготовить product-scale data/UI after core features stabilize.

**Основные файлы/модули:** DB indexes/search, Calendar store/selectors, layout/scheduling UI, command palette.

**Зависимости:** CAL-109–CAL-117 as applicable.

**Definition of Done:**

- account/permission-filtered event search;
- bounded occurrence expansion and cache;
- measured large-calendar and large-attendee performance;
- virtualization only where measurements justify it;
- WCAG keyboard/focus/color/announcement audit;
- bundle/chunk review.

**Риски:** indexing sensitive fields, premature virtualization, bundle growth.

## CAL-119 — End-to-end parity release gate

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

## Recommended first implementation ticket

**CAL-101 — Approve clean baseline and reproduce Calendar runtime.**

Это engineering gate, а не UI feature. После него первый code foundation ticket — **CAL-102 — Calendar domain and timezone contracts**. Начинать с drag/resize или redesigned views до CAL-102–CAL-104 рискованно: UI закрепит неверные identity/time/recurrence semantics.
