# CAL-120 — Office360 Calendar final parity audit

Дата: 2026-08-23 (Asia/Bangkok)

Ветка: `feat/calendar-yandex360`

Production baseline: `4be8742`

Docs-only runtime closure: `8e5201d`

## Executive summary

Office360 Calendar уже является полноценным provider-neutral календарным клиентом: Month/Week/Day, несколько календарей, create/edit/delete, single/series recurrence mutations, participant semantics, reminders metadata, Free/Busy foundation, Scheduling Assistant, drag/resize, all-day conversion, shared-calendar access enforcement, timezone/DST-safe domain, iCalendar codec и cache-first sync работают через единые service boundaries.

Это ещё не полный функциональный паритет с веб-версией Яндекс 360 Календаря. Три ключевых user outcomes не замкнуты end-to-end:

1. reminder metadata сохраняется, но Office360 не доставляет desktop reminders и не имеет snooze/dismiss/catch-up scheduler;
2. Mail приглашения распознаются, но Mail RSVP заканчивается terminal `unsupported`, а outbound `REQUEST` / `REPLY` / `CANCEL` delivery lifecycle отсутствует;
3. Scheduling Assistant существует, но занятость других Yandex-участников остаётся `unsupported`, потому что публичный CalDAV path не подтвердил RFC 6638 remote Free/Busy.

Вердикт: **NEEDS FOLLOW-UP**. Calendar можно считать сильным foundation/release candidate, но нельзя называть feature-complete Yandex parity без закрытия или явного product waiver для P0 gaps.

### Scores

| Dimension | Score | Meaning |
|---|---:|---|
| Functional parity | **79%** | Большинство core event/calendar operations есть; notification, invitation delivery и Yandex participant availability не завершены |
| Interaction parity | **74%** | Grid interactions сильные; recurring create, optional attendee authoring, Month overflow, search и sharing management отсутствуют |
| Visual parity | **66%** | Office360 использует собственную coherent theme; это не pixel clone, но Calendar остаётся проще Яндекса и местами смешивает RU/EN copy |
| Production readiness | **72%** | Test/build health высокий; provider write/live-fixture coverage, notification/iTIP lifecycle и several UX/accessibility gaps мешают parity release |

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
| RSVP | PARTIAL | Existing provider-backed Calendar event RSVP is direct; Mail invitation RSVP is local projection then terminal unsupported |
| Free/Busy | PARTIAL | Self local-derived; Google remote automated; generic CalDAV conditional RFC 6638; Yandex others unsupported |
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
| Reminders | PARTIAL | Provider-neutral metadata, Google/VALARM persistence and editor are implemented; no actual desktop delivery/snooze/dismiss/background catch-up |
| Timezone | PASS | Provider-neutral TZID and IANA `Intl` resolver; editor uses explicit Calendar timezone on submit |
| DST | PASS | Explicit gap shift-forward / overlap earlier-offset plus four-zone matrix including Lord Howe |
| All-day | PASS | Exclusive date model, Google exclusive end and provider/codec/UI tests |
| Floating time | PASS | Explicit floating domain; resolution assumptions are diagnostic/reliability-aware |
| ICS / iCalendar | PASS | `ical.js` codec covers VEVENT, VTIMEZONE, recurrence, participants, VALARM and malformed isolation |
| Mail invite ingestion | PARTIAL | REQUEST/CANCEL/REPLY method and sequence parse exist, but ingestion occurs on ThreadView inspection; REPLY/CANCEL are not a complete organizer/calendar reconciliation lifecycle |
| Mail ↔ Calendar | PARTIAL | Invitation card and provisional projection exist; no delivered Mail RSVP, outbound invitations, updates or cancellations |
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

**PARTIAL.** Grid draft, event editor, attendees, reminder policy and provider create path are covered. Live smoke stopped at Cancel. Required-only email entry is available, but optional-role authoring, participant directory and actual invitation delivery are missing; reminder delivery is also absent after provider metadata save.

### Flow C — open existing → edit → move → drag/resize

**PASS with mixed evidence.** Existing details are LIVE; edit/provider mutation, drag/resize, rollback and conflicts are primarily AUTOMATED. A previous live non-recurring drag wrote remotely, but comprehensive destructive smoke was intentionally not repeated.

### Flow D — recurring occurrence → only this / whole series

**PARTIAL.** `single` and `series` edit/delete are AUTOMATED and capability-driven. No safe live recurring fixture was available. `this-and-future` and recurring-series creation are unsupported.

### Flow E — participants → availability → suggested slot → select time

**PARTIAL; target-provider blocker.** Assistant UI and selection are LIVE/AUTOMATED, and Google/generic RFC 6638 adapters exist. Other Yandex participants remain unknown/unsupported, so the primary Yandex flow cannot promise a genuinely free slot.

### Flow F — shared/read-only calendar → view → attempt edit

**PARTIAL evidence, functionally implemented.** Automated role/privacy/write-gate tests pass and service enforcement precedes provider I/O. No live shared/read-only/free-busy-only calendar was available.

### Flow G — incoming Mail invite → RSVP → Calendar state

**PARTIAL / not end-to-end.** Incoming ICS renders an invitation card and updates local participant semantics. The queued response deliberately becomes `blocked`, removes the provisional Calendar projection and never informs the organizer. Yandex parity requires delivered RSVP and reconciled Calendar state.

## Functional, interaction and visual parity

- **Functional parity** asks whether the same outcome is possible. Grid CRUD, recurrence single/series, time semantics and provider sync are real; notification delivery, invitation lifecycle and Yandex participant availability are not.
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
| Remote Free/Busy others | PASS AUTOMATED | Conditional after RFC 6638 discovery | MISSING / unsupported |
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
| Desktop delivery | MISSING |
| Snooze | MISSING |
| Dismiss / acknowledge | MISSING |
| Background scheduling | MISSING |
| Restart/sleep catch-up and dedupe | MISSING |

Reminder metadata must not be presented as an Office360 notification guarantee.

## Shared calendars and ACL

Discovery, role normalization, local persistence, removed-calendar reconciliation, read-only enforcement and free-busy-only privacy are implemented. Management is not: Office360 cannot invite a user, change a role, remove access, subscribe/unsubscribe, reorder provider calendars or change provider color. The official Yandex web product exposes role-based sharing management, so this is a real parity delta, not a provider capability already hidden elsewhere.

## Remaining gaps and priority

### P0 — blocks full functional parity

1. **Reminder delivery engine:** desktop/background delivery, dedupe/catch-up, snooze and dismiss.
2. **Mail invitation lifecycle:** delivered RSVP plus outbound `REQUEST` / `REPLY` / `CANCEL`, sequence/recurrence reconciliation and visible delivery state.
3. **Yandex participant availability:** a supported privacy-safe provider path, or an explicit product waiver that Scheduling Assistant on Yandex cannot match web Calendar.

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
| Desktop notification delivery/snooze/dismiss | P0 | Yes |
| Live Google Free/Busy fixture unavailable | Evidence gap | Not a code blocker; blocks live claim |
| Live shared/read-only fixture unavailable | Evidence gap / P1 acceptance | Blocks production confidence for shared roles, not automated semantics |
| Yandex RFC 6638 remote Free/Busy unsupported | P0 or accepted waiver | Blocks target-provider scheduler parity |

## Regression and code health

Current HEAD `8e5201d` changes only two Calendar docs after production commit `4be8742`. The last valid production-code battery is therefore applicable:

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

**No** for full Yandex 360 Calendar parity. **Yes** as a provider-neutral Calendar foundation with documented unsupported capabilities.

### Merge recommendation

**NO for a parity-complete release.** A merge as an explicitly scoped foundation is acceptable only if the owner records waivers for P0 gaps and does not market reminders, Mail RSVP or Yandex participant availability as delivered outcomes.

### Required before parity merge

1. Close P0 reminder delivery and Mail invitation lifecycle, or explicitly remove them from the release promise.
2. Resolve Yandex remote availability through a supported provider contract or approve a documented target-provider limitation.
3. Run isolated live provider acceptance for create/edit/delete/RSVP/recurrence and shared/read-only roles without personal-calendar risk.
4. Decide the P1 release boundary for recurring create, participant role authoring, search and ACL management.

### Post-merge backlog

- Search, Monday/configurable week start, Month overflow details and current-time indicator.
- Consolidate Calendar application/discovery orchestration and durable provider delta state.
- WCAG, dark/light, narrow-window and performance/bundle hardening.
- Optional interaction polish: auto-scroll, multi-day all-day selection and keyboard drag-selection.

## Audit constraints

- No production feature code changed.
- No migration, runtime DB mutation, cloud event mutation, ACL mutation, deploy or secret access.
- Graphify was queried for navigation; update is not required for docs-only output.
