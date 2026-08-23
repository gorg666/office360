# CAL-120 — Office360 Calendar final parity audit

Дата: 2026-08-23 (Asia/Bangkok)

Ветка: `feat/calendar-yandex360`

Production baseline: `4be8742`

Docs-only runtime closure: `8e5201d`

## Executive summary

Office360 Calendar уже является полноценным provider-neutral календарным клиентом: Month/Week/Day, несколько календарей, create/edit/delete, single/series recurrence mutations, participant semantics, reminders metadata, Free/Busy foundation, Scheduling Assistant, drag/resize, all-day conversion, shared-calendar access enforcement, timezone/DST-safe domain, iCalendar codec и cache-first sync работают через единые service boundaries.

Это ещё не полный функциональный паритет с веб-версией Яндекс 360 Календаря, но оба P0 из первоначального CAL-120 закрыты. CAL-121 закрыл reminder delivery, CAL-122 — Mail/iTIP lifecycle, а CAL-123 подтвердил live exposed RFC 6638 contract и подключил существующий remote Free/Busy adapter для Yandex без private API.

Вердикт после CAL-123: **P0 CLOSED; P1 FOLLOW-UP**. Calendar является сильным provider-neutral release candidate. Оставшиеся различия — product interaction/management scope, а не отсутствующий Yandex provider outcome.

### Scores

Численные scores ниже — исторический снимок CAL-120 и не пересчитывались механически после CAL-121/CAL-122; актуальные строковые verdicts в матрице уже включают оба closure ticket.

| Dimension | Score | Meaning |
|---|---:|---|
| Functional parity | **79%** | Historical CAL-120 score; subsequent CAL-122/CAL-123 closed its two recorded P0 outcomes |
| Interaction parity | **74%** | Grid interactions сильные; recurring create, optional attendee authoring, Month overflow, search и sharing management отсутствуют |
| Visual parity | **66%** | Office360 использует собственную coherent theme; это не pixel clone, но Calendar остаётся проще Яндекса и местами смешивает RU/EN copy |
| Production readiness | **72%** | Test/build health высокий; provider write/live-fixture coverage, iTIP lifecycle и several UX/accessibility gaps мешают parity release |

Оценки — evidence-weighted audit judgment, а не coverage percentage. `PASS` требует работающий runtime path или автоматический contract с честно указанным provenance; mocks не называются live evidence.

## Evidence model

| Mark | Evidence |
|---|---|
| LIVE | Tauri runtime evidence from `CALENDAR_RUNTIME_BASELINE.md` |
| AUTOMATED | unit/integration/provider-conformance/TZ tests |
| CODE | current production source inspection on `8e5201d` |
| PROVIDER DOC | official Yandex 360 help, used only to define comparison capability |

Official comparison anchors:

- [Создать событие](https://yandex.ru/support/yandex-360/customers/calendar/web/ru/plan-events/events/event-create)
- [Ответить на приглашение](https://yandex.ru/support/yandex-360/customers/calendar/web/ru/plan-events/events/event-invite)
- [Выдать доступ к календарю](https://yandex.ru/support/yandex-360/customers/calendar/web/ru/collaboration/sharing)
- [Найти событие](https://yandex.ru/support/yandex-360/customers/calendar/web/ru/event-search)
- [События и напоминания](https://yandex.ru/support/yandex-360/customers/calendar/app/ru/events-and-notifications)
- [Повторяющиеся события](https://yandex.ru/support/yandex-360/customers/calendar/app/ru/series)

## Parity matrix

| Area | Verdict | Evidence and delta |
|---|---|---|
| Navigation / sidebar | PASS | LIVE route/sidebar, Today, previous/next and view switching; Office360 chrome differs visually by design |
| Month | PASS | LIVE render/navigation; AUTOMATED multi-day spans, drag and all-day projection. `+N` overflow has no open action (P1 interaction delta) |
| Week | PASS | LIVE grid; AUTOMATED continuous duration/overlap/drag/resize. RU week is hard-coded Sunday-first (P1 delta) |
| Day | PASS | LIVE grid and event details; AUTOMATED continuous timed layout and selection |
| Create event | PARTIAL | CODE/AUTOMATED provider create, grid draft, participants and reminders; no recurring-series authoring, optional-role authoring or invitation delivery; live smoke cancelled before Save |
| Edit event | PASS | CODE/AUTOMATED typed mutation, ETag conflict, reminder preservation, Scheduling Assistant; live detail/edit shell exists |
| Delete event | PASS | AUTOMATED provider delete, explicit recurrence scope and CalDAV resource safety; destructive live smoke intentionally absent |
| Recurring events | PARTIAL | Full read/expansion and single/series update/delete; recurring create and `this-and-future` absent |
| Participants | PARTIAL | Normalized identity/status/type/delegation and provider conformance; create input is comma-separated email text, no directory/picker or invitation delivery |
| Required / optional | PARTIAL | Existing roles survive provider/domain/codec round-trip and scheduler distinguishes them; create UI cannot persist optional role explicitly |
| RSVP | PASS | Provider-backed Calendar RSVP is direct and ledgered; Mail RSVP queues METHOD:REPLY with explicit delivery state |
| Free/Busy | PASS | Self local-derived; Google remote automated; CalDAV/Yandex remote only after complete RFC 6638 discovery; Yandex contract confirmed LIVE by CAL-123 |
| Scheduling Assistant | PASS | LIVE create/edit assistant; AUTOMATED provider-neutral privacy-safe timeline and stale-response cancellation |
| Suggested slots | PASS | AUTOMATED deterministic required/optional ranking and working-hours-aware engine; result quality depends on availability reliability |
| Multiple calendars | PASS | LIVE two-calendar list, visibility toggle and create target; provider reads are paginated/bounded as applicable |
| Shared calendars | PARTIAL | Discovery/read and removed reconciliation implemented; no live shared fixture, subscriptions or sharing management |
| Permissions | PASS | AUTOMATED Google roles and DAV privilege normalization; service + UI gates; live account only covered owned calendars |
| Read-only behavior | PASS | AUTOMATED no create/edit/delete/drag/resize plus free-busy-only privacy; no live read-only fixture |
| Drag/drop | PASS | AUTOMATED Day/Week cross-day wall-clock move, recurrence prompt and rollback; one earlier live non-recurring move proved remote path |
| Resize | PASS | AUTOMATED top/bottom handles, snap/min duration, rollback; Event Edit is keyboard equivalent |
| Month drag | PASS | AUTOMATED timed/all-day/multi-day moves, recurrence and DST semantics |
| All-day interactions | PASS | AUTOMATED all-day row moves and timed ↔ all-day conversion; multi-day all-day create drag is absent |
| Create by selection | PASS | LIVE Day/Week click+drag, Month/all-day click and keyboard slot/cell activation; no auto-scroll or keyboard drag-selection |
| Reminders | PASS | Provider-neutral metadata, Google/VALARM persistence, durable desktop delivery, snooze/dismiss, bounded catch-up, local v38 schema and native Tauri toast smoke are covered by CAL-118/CAL-121 |
| Timezone | PASS | Provider-neutral TZID and IANA `Intl` resolver; editor uses explicit Calendar timezone on submit |
| DST | PASS | Explicit gap shift-forward / overlap earlier-offset plus four-zone matrix including Lord Howe |
| All-day | PASS | Exclusive date model, Google exclusive end and provider/codec/UI tests |
| Floating time | PASS | Explicit floating domain; resolution assumptions are diagnostic/reliability-aware |
| ICS / iCalendar | PASS | `ical.js` codec covers VEVENT, VTIMEZONE, recurrence, participants, VALARM and malformed isolation |
| Mail invite ingestion | PASS | REQUEST/CANCEL/REPLY ingest at Gmail/IMAP store boundary; ThreadView is not required; sender and sequence are reconciled |
| Mail ↔ Calendar | PASS | Delivered RSVP, organizer-side REPLY, inbound CANCEL and outbound REQUEST/update/CANCEL share one durable lifecycle |
| Provider sync | PARTIAL | Cache-first bounded reconciliation and Google pagination; Google sync token and CalDAV delta/ctag durability remain ephemeral/range-refresh |
| Offline / cache / stale | PARTIAL | Cached stale state, retry and degraded parse preservation work; offline event writes/queue are absent |
| Errors / conflicts | PASS | Typed auth/permission/conflict/network states, ETag when available, rollback and safe user copy; legacy no-ETag writes remain unconditional |
| Accessibility | PARTIAL | Keyboard create/open/edit, modal/radio semantics, ARIA labels/live regions; no keyboard drag-selection, no dedicated WCAG audit, pointer resize handles are hidden |
| Responsive | PARTIAL | LIVE create/assistant usable around 720 px with local scrolling; narrow toolbar/sidebar and dense Month/Week states lack complete matrix |
| Dark mode | PARTIAL | Calendar consistently uses Office360 semantic color tokens; no dedicated light/dark visual acceptance matrix |

## User flow verdicts

### Flow A — Open Calendar → Month/Week/Day → choose/hide/show calendar

**PASS (LIVE).** Route, views, list, two present calendars and reversible local visibility toggle were exercised. Visibility does not mutate provider ACL/subscription state.

### Flow B — grid click/drag → create → participants → reminder → Save

**PARTIAL.** Grid draft, event editor, attendees, reminder policy, provider create path and local reminder delivery are covered. Live event creation smoke stopped at Cancel. Required-only email entry is available, but optional-role authoring, participant directory and actual invitation delivery are missing.

### Flow C — open existing → edit → move → drag/resize

**PASS with mixed evidence.** Existing details are LIVE; edit/provider mutation, drag/resize, rollback and conflicts are primarily AUTOMATED. A previous live non-recurring drag wrote remotely, but comprehensive destructive smoke was intentionally not repeated.

### Flow D — recurring occurrence → only this / whole series

**PARTIAL.** `single` and `series` edit/delete are AUTOMATED and capability-driven. No safe live recurring fixture was available. `this-and-future` and recurring-series creation are unsupported.

### Flow E — participants → availability → suggested slot → select time

**PASS within provider permissions.** Assistant UI and selection are LIVE/AUTOMATED. Google and discovery-confirmed CalDAV/Yandex use remote adapters; per-recipient denial/error remains unknown and can never be promoted to free.

### Flow F — shared/read-only calendar → view → attempt edit

**PARTIAL evidence, functionally implemented.** Automated role/privacy/write-gate tests pass and service enforcement precedes provider I/O. No live shared/read-only/free-busy-only calendar was available.

### Flow G — incoming Mail invite → RSVP → Calendar state

**PASS (automated, no live send).** Incoming ICS is ingested at message storage, renders an invitation card and updates Calendar participant semantics. RSVP uses the existing Mail queue with separate local and delivery state; fixtures cover success/retry/failure without sending real mail.

## Functional, interaction and visual parity

- **Functional parity** asks whether the same outcome is possible. Grid CRUD, recurrence single/series, time semantics, provider sync, local reminder delivery, application iTIP lifecycle and discovery-gated Yandex participant availability are real. Remaining deltas are listed as P1/P2 product scope.
- **Interaction parity** asks whether the user can discover and complete the workflow safely. Office360 intentionally differs in layout, but grid selection, drag/resize, scope prompts and scheduler are equivalent. Missing Month overflow action, search, recurring create and participant/ACL editors are interaction gaps.
- **Visual parity** does not require Yandex branding or exact CSS. Office360 has a coherent semantic theme and readable calendar surfaces, but less dense feature chrome, mixed Russian/English editor copy, no dedicated current-time indicator and incomplete light/dark/responsive visual acceptance.

## Provider matrix

| Capability | Google | Generic CalDAV | Yandex CalDAV |
|---|---|---|---|
| Read | PASS, paginated | PASS, bounded range | PASS LIVE read-only |
| Write | PASS contract | PASS contract | PASS contract; destructive live suite not run |
| Recurrence | Full read; partial write | Full read; partial write | Same as CalDAV |
| Single occurrence | Update/delete | Update/delete; EXDATE for delete | Same as CalDAV |
| This-and-future | MISSING | MISSING | MISSING |
| Reminders | Full defaults/overrides | Partial DISPLAY/EMAIL read; DISPLAY write | Same as CalDAV |
| Remote Free/Busy others | PASS AUTOMATED | Conditional after RFC 6638 discovery | PASS LIVE DISCOVERY / AUTOMATED QUERY |
| Shared calendars | Read | Read | Read discovery |
| Effective permissions | Full role mapping | Partial DAV privileges | Partial DAV privileges; LIVE owned only |
| ACL management | MISSING | MISSING | MISSING |
| Calendar-event RSVP | Direct | Direct | Direct contract; organizer side effects not live-confirmed |
| Mail-invite RSVP | MISSING delivery | MISSING delivery | MISSING delivery |
| ICS | Provider mapping | Full codec/resource path | Full codec/resource path |

## Mail ↔ Calendar audit

| Method / flow | Status | Evidence |
|---|---|---|
| `METHOD:REQUEST` parse/card | PARTIAL | Parsed and persisted when ThreadView inspects body/attachment; not a sync-time MIME ingestion pipeline |
| `METHOD:REPLY` parse | PARTIAL | Codec fixture/parser accepts it; no organizer-side attendee reconciliation/delivery lifecycle |
| `METHOD:CANCEL` parse/card | PARTIAL | Cancellation status is shown; no complete removal/update propagation to provider Calendar state |
| Mail RSVP UI | PARTIAL | Accept/tentative/decline updates local invitation participant state |
| Remote RSVP delivery | MISSING | Pending operation intentionally terminates `unsupported` and removes provisional projection |
| Calendar projection | PARTIAL | Provisional accepted/tentative projection exists only until unsupported queue execution |
| Outbound invite/update/cancel | MISSING | Provider capabilities declare invitation delivery `none`; no iMIP REQUEST/REPLY/CANCEL Outbox/Sent path |

## Notifications audit

| Layer | Verdict |
|---|---|
| Reminder model | PASS |
| Google/CalDAV/Yandex persistence | PASS within documented capability limits |
| Desktop delivery | PASS |
| Snooze | PASS |
| Dismiss / acknowledge | PASS |
| Background scheduling | PASS while tray process is alive |
| Restart/sleep catch-up and dedupe | PASS (6-hour bounded catch-up) |

Concrete notification reminders now have a local Office360 delivery guarantee while the tray process is alive, plus bounded startup catch-up. Fully terminated real-time delivery remains explicitly unsupported without an OS background service.

## Shared calendars and ACL

Discovery, role normalization, local persistence, removed-calendar reconciliation, read-only enforcement and free-busy-only privacy are implemented. Management is not: Office360 cannot invite a user, change a role, remove access, subscribe/unsubscribe, reorder provider calendars or change provider color. The official Yandex web product exposes role-based sharing management, so this is a real parity delta, not a provider capability already hidden elsewhere.

## Remaining gaps and priority

### P0 — blocks full functional parity

None. CAL-122 closed Mail invitation lifecycle. CAL-123 closed Yandex participant availability through the exposed privacy-safe RFC 6638 provider contract. See `CALENDAR_INVITATION_LIFECYCLE.md` and `CALENDAR_YANDEX_FREE_BUSY_DECISION.md`.

### P1 — important parity gaps

1. Recurring-series creation/editor. Keep `this-and-future` as a documented limitation unless product scope expands beyond the currently evidenced Yandex single/all interaction.
2. Participant directory/picker and persistent required/optional authoring; organizer invitation delivery is coupled to P0 #2.
3. Shared-calendar/ACL management and live shared/read-only acceptance fixture.
4. Calendar event search with account/permission filtering.
5. Month `+N` details surface; currently the button stops propagation and performs no action.
6. Locale/configurable week start; RU Month/Week are currently Sunday-first.
7. Durable Google sync-token and CalDAV delta state, plus explicit offline-write policy.

### P2 — polish / hardening

1. Current-time indicator, richer date navigation and consistent RU editor copy.
2. Auto-scroll during selection/drag, multi-day all-day create drag and optional keyboard drag-selection.
3. Full responsive density matrix, light/dark visual regression and WCAG audit.
4. Provider/live destructive test fixtures isolated from personal calendars.

### P3 — intentional or separately scoped

1. Pixel-perfect Yandex branding/CSS clone.
2. Room search/booking, organization directory rewrite, tasks/templates/Alice parity.
3. Touch-first/mobile interaction parity unless Office360 defines it as a desktop requirement.
4. Unsupported VALARM shapes and CalDAV EMAIL authoring until provider delivery is validated.

## Known limitations classification

| Known limitation | Classification | Blocking? |
|---|---|---|
| `this-and-future` unsupported | Documented limitation | No for the currently evidenced Yandex single/all interaction; no silent fallback exists |
| All-day create drag-selection absent | P2 | No; click create is understandable equivalent |
| Keyboard drag-selection absent | P2 | No; slot/cell create and Event Edit provide accessible completion |
| Auto-scroll absent | P2 | No for normal viewport; friction for long drag |
| Fully terminated real-time reminder delivery | Documented platform limitation | No; tray runtime plus startup catch-up is the approved contract |
| Live Google Free/Busy fixture unavailable | Evidence gap | Not a code blocker; blocks live claim |
| Live shared/read-only fixture unavailable | Evidence gap / P1 acceptance | Blocks production confidence for shared roles, not automated semantics |
| Yandex RFC 6638 remote Free/Busy | Closed by CAL-123 | No; complete discovery contract confirmed on personal-domain and custom-domain accounts |

## Regression and code health

CAL-123 changes the CalDAV discovery gate, diagnostics, scheduler limitation copy and tests. Its current production-code battery is recorded in `CALENDAR_RUNTIME_BASELINE.md`; the older CAL-119 figures below remain historical context:

- TypeScript: PASS.
- Targeted CAL-119: 13 files / 188 tests PASS.
- Full Vitest: 241 files / 2409 tests PASS.
- TZ matrix: 168/168 in each of UTC, Europe/Moscow, America/New_York and Australia/Lord_Howe.
- Frontend production build: PASS; main 2,047.06 kB raw / 609.64 kB gzip, Calendar chunk 126.92 kB / 37.04 kB gzip; existing large-chunk warnings remain.
- `cargo check`: PASS with two pre-existing unused-variable warnings in `src/lib.rs:360`.
- Tauri CAL-119: Month/Week/Day/list/create-cancel/details/visibility PASS; live shared/read-only fixture unavailable; cloud event/ACL mutations NONE.

Technical debt, not parity blockers by itself:

- `src/services/google/calendar.ts` is unreferenced legacy candidate code.
- Calendar discovery/upsert/reconciliation logic exists in `CalendarSyncService`, `calendarAccessService` and background `syncManager`; ownership should be consolidated before expanding sync policy.
- `CalendarPage` still owns substantial presentation orchestration despite `CalendarSyncService`; the old CAL-115 application-state cleanup remains incomplete.
- Graphify graph integrity is clean, but saved community labels are stale relative to 401 communities.
- React tests emit some pre-existing `act(...)` warnings even though the suite passes.
- Main bundle retains existing dynamic-import/chunk-size warnings.

## Production readiness and merge recommendation

### Feature complete?

**No** for literal full Yandex 360 Calendar product parity because P1/P2 interaction and management scope remains. **Yes** as a provider-neutral Calendar release candidate with no open P0 provider outcome.

### Merge recommendation

**YES for the current scoped Calendar foundation/release candidate.** A literal feature-complete Yandex product claim still requires an explicit P1 release boundary, but no P0 provider waiver remains.

### Required before parity merge

1. Run isolated live provider acceptance for create/edit/delete/RSVP/recurrence and shared/read-only roles without personal-calendar risk.
2. Decide the P1 release boundary for recurring create, participant role authoring, search and ACL management.

### Post-merge backlog

- Search, Monday/configurable week start, Month overflow details and current-time indicator.
- Consolidate Calendar application/discovery orchestration and durable provider delta state.
- WCAG, dark/light, narrow-window and performance/bundle hardening.
- Optional interaction polish: auto-scroll, multi-day all-day selection and keyboard drag-selection.

## Audit constraints

- No production feature code changed.
- No migration, runtime DB mutation, cloud event mutation, ACL mutation, deploy or secret access.
- Graphify was queried for navigation; update is not required for docs-only output.
