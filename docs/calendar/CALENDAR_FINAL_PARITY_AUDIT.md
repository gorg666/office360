# CAL-124 — Office360 Calendar final parity re-audit

Дата: 2026-08-23 (Asia/Bangkok)

Ветка: `feat/calendar-yandex360`

Production HEAD: `ff9e5fa`

Предыдущий audit: `cf16a16` (CAL-120)

Закрывающие P0 commits: `7839344` (reminder delivery), `c559ccc` (Mail/iTIP lifecycle), `ff9e5fa` (Yandex remote Free/Busy).

## Executive verdict

Все три P0 из предыдущего аудита закрыты. Office360 Calendar имеет provider-neutral Month/Week/Day, CRUD, безопасные single/series recurrence mutations, participant semantics, Scheduling Assistant, Google и discovery-confirmed CalDAV/Yandex remote Free/Busy, application Mail iTIP lifecycle и durable local reminder delivery.

Буквальный продуктовый паритет с Yandex 360 Calendar ещё **не достигнут**: отсутствуют recurring-series authoring, сохраняемое required/optional authoring, Calendar search и ACL/share management; Month overflow и RU week-start остаются незавершёнными. Поэтому итог: **P0 CLOSED; P1 FOLLOW-UP; MERGE YES WITH CONDITIONS**. Ветку можно merge как scoped Calendar release candidate, но нельзя называть полностью parity-complete без явно принятой P1 boundary.

### Recalculated scores

| Dimension | Score | Evidence-based interpretation |
|---|---:|---|
| Functional parity | **88%** | Все P0 outcomes работают; несколько самостоятельных authoring/management/search outcomes остаются P1 |
| Interaction parity | **81%** | Grid, recurrence scope, scheduling, reminders и invitations сильные; missing editor/picker/search/overflow/share interactions заметны |
| Visual parity | **71%** | Coherent Office360 surface, но не pixel clone; смешанный RU/EN copy, нет current-time line и полной visual matrix |
| Production readiness | **84%** | Clean full battery и durable local lifecycles; live destructive/shared fixtures и provider delta/offline policy остаются gaps |

Scores пересчитаны с нуля по текущей матрице. Это audit judgment, а не test-coverage percentage.

## Evidence rules

| Mark | Meaning |
|---|---|
| LIVE | Sanitized Tauri/provider runtime evidence из `CALENDAR_RUNTIME_BASELINE.md` |
| AUTOMATED | Unit/integration/provider-conformance/TZ acceptance |
| CODE | Production source inspection на `ff9e5fa` |

Automated fixture не называется live. CAL-123 live evidence подтверждает discovery contract; VFREEBUSY scheduling POST не выполнялся из-за возможного provider-side effect.

## P0 recheck

| Former P0 | Status | Evidence |
|---|---|---|
| Reminder delivery | **CLOSED** | CAL-121: v38 durable ledger, deterministic dedupe, lease/catch-up, snooze/dismiss, mutation reconciliation, privacy-safe Tauri notification path |
| Mail invitation lifecycle | **CLOSED** | CAL-122: REQUEST/REPLY/CANCEL, Gmail/IMAP automatic ingestion, delivered RSVP, organizer reconciliation, per-recipient outbound lifecycle through existing Mail queue |
| Yandex participant Free/Busy | **CLOSED** | CAL-123: complete RFC 6638 discovery on two account classes; transport/routing/privacy automated; no unsafe live VFREEBUSY POST |

## Parity matrix

| Area | Verdict | Current evidence and remaining delta |
|---|---|---|
| Navigation / sidebar | PASS | LIVE Calendar route, Today, previous/next, view switching and calendar-list toggle |
| Month | PASS | LIVE render/navigation; AUTOMATED spans, all-day projection and moves |
| Week | PASS | LIVE render/navigation; AUTOMATED continuous layout, overlaps, drag/resize |
| Day | PASS | LIVE render/navigation/details; AUTOMATED timed and all-day interaction |
| Create event | PARTIAL | Provider create, grid drafts, participants, reminders, assistant and outbound REQUEST work; no RRULE authoring or persistent optional role UI |
| Edit event | PASS | Typed provider mutation, ETag when present, attendees/reminders, assistant and outbound update lifecycle |
| Delete event | PASS | Plain/series/single safe paths plus outbound CANCEL; destructive live acceptance intentionally limited |
| Recurring create | MISSING | `EventCreateInput` and create UI have no recurrence rule; recurrence write exists only for series mutations |
| Recurring edit | PASS | Explicit single/series scopes and safe provider mapping; `this-and-future` intentionally unsupported |
| Participants | PARTIAL | Domain/provider/write lifecycle complete; authoring remains comma-separated email input without directory/picker |
| Required / optional | PARTIAL | Round-trip and Scheduling Assistant roles work; role toggle is assistant-local and is not persisted by create/edit authoring |
| RSVP | PASS | Provider direct response and Mail METHOD:REPLY use one normalized attendee state with explicit delivery state |
| Mail REQUEST | PASS | Automatic Gmail/IMAP ingestion, trust/sequence/idempotency and projection covered |
| Mail REPLY | PASS | Organizer-side attendee reconciliation and stale/suspicious handling covered |
| Mail CANCEL | PASS | Series/occurrence cancellation reconciliation covered without unsafe whole-series fallback |
| Outbound invitations | PASS | Per-recipient REQUEST/update/CANCEL goes through existing Mail pending-operation queue |
| Free/Busy | PASS | Local self, Google remote and discovery-gated RFC 6638 adapters; unknown/denied never become free |
| Yandex Free/Busy | PASS | LIVE protocol discovery + AUTOMATED transport; live VFREEBUSY POST intentionally not executed |
| Scheduling Assistant | PASS | LIVE create/edit UI; privacy-safe provider-neutral timeline |
| Suggested slots | PASS | Deterministic required/optional ranking and working-hours-aware engine |
| Multiple calendars | PASS | LIVE list, visibility and create target; provider pagination/bounded reads as supported |
| Shared calendars | PARTIAL | Read/discovery/presence and permission semantics implemented; no live shared fixture or subscription management |
| Permissions | PASS | Effective access normalization and service/UI write gates; live owned fixture plus automated shared roles |
| ACL management | MISSING | No add user/change role/remove access/share-management UI or provider mutation adapter |
| Drag/drop | PASS | Day/Week and date-grid moves, recurrence prompt, rollback and DST semantics |
| Resize | PASS | Top/bottom handles, snap/min-duration and rollback; Event Edit is keyboard equivalent |
| Month drag | PASS | Timed/all-day/multi-day moves and timed↔all-day conversions |
| All-day interactions | PASS | Move/conversion/create-click work; multi-day all-day create drag is deferred polish |
| Create by selection | PASS | LIVE Day/Week click+drag, Month/all-day click and keyboard activation |
| Reminder metadata | PASS | Google and VALARM normalized policy with lazy legacy compatibility |
| Desktop reminder delivery | PASS | Durable delivery while process/tray is alive and safe native notification integration |
| Snooze | PASS | Linked local delivery row; provider reminder metadata unchanged |
| Dismiss | PASS | Occurrence-local durable handling |
| Catch-up | PASS | Bounded six-hour startup/resume catch-up and dedupe |
| Timezone | PASS | Provider-neutral timed-zoned/floating/all-day and IANA resolution |
| DST | PASS | Gap shift-forward, overlap earlier-offset and four-zone acceptance |
| ICS / iCalendar | PASS | `ical.js` codec, recurrence, participants, VALARM, VTIMEZONE and malformed isolation |
| Offline / cache | PARTIAL | Cache-first stale/read coverage works; offline event write queue does not exist |
| Provider delta sync | PARTIAL | Google background sync persists tokens, but capability/read owners disagree and expired-token recovery retains stale state; CalDAV remains range refresh without sync-token/ctag delta |
| Search | MISSING | No Calendar event search surface or account/permission-filtered Calendar query path |
| Accessibility | PARTIAL | Keyboard create/open/edit, modal/radio semantics and ARIA exist; no WCAG audit or keyboard drag-selection |
| Responsive | PARTIAL | LIVE ~720 px create/assistant smoke; dense Month/Week and toolbar matrix incomplete |
| Dark mode | PARTIAL | Semantic theme tokens are used; dedicated light/dark visual regression is absent |

## Core user flows

### Flow A — Open Calendar → Month/Week/Day → calendars visibility

**PASS (LIVE).** Navigation, multiple calendars and reversible local visibility are confirmed. Visibility is not ACL/subscription mutation.

### Flow B — Create → participants → required/optional → reminders → Scheduling Assistant → Save → outbound invitation

**PARTIAL.** Create, reminders, assistant, Save and outbound REQUEST are implemented. The flow cannot author RRULE and cannot persist optional attendee role from the current create UI.

### Flow C — Edit → drag/resize → participants/reminders → send update

**PASS with mixed evidence.** Typed edit, drag/resize, reminder preservation and outbound attendee update are automated; prior runtime proved details and one real non-recurring move. A complete destructive provider matrix was not repeated.

### Flow D — Recurring occurrence → edit/delete → single/series

**PASS for existing series; PARTIAL end-to-end recurrence product flow.** Single/series update/delete are safe and explicit. Creating the series in Office360 and `this-and-future` are unavailable.

### Flow E — Add Yandex participant → remote Free/Busy → suggestion → choose slot

**PASS.** CAL-123 confirmed the live RFC 6638 discovery gate; request transport, privacy, errors and slot selection are automated. No live VFREEBUSY POST was sent.

### Flow F — Shared/read-only calendar → view → permission enforcement

**PASS functionally / PARTIAL live evidence.** Automated roles, privacy and pre-provider write gates pass. No isolated live shared/read-only/free-busy-only fixture was available.

### Flow G — Incoming REQUEST → automatic ingestion → RSVP → delivered REPLY → organizer reconciliation → CANCEL

**PASS (AUTOMATED).** Ingestion is outside ThreadView and reuses the existing Mail queue. Real send/RSVP/cancel was intentionally not executed.

### Flow H — Reminder due → notification → snooze/dismiss → restart catch-up

**PASS within desktop process contract.** Native toast integration was smoked locally; due-event lifecycle is fixture-tested. Fully exited app delivery is not supported; restart catch-up is.

## Provider summary

| Capability | Google | Generic CalDAV | Yandex CalDAV |
|---|---|---|---|
| Read / CRUD | PASS contract | PASS contract | PASS read LIVE; writes contract-tested |
| Recurrence | Read + single/series mutations | Read + single/series mutations | Same as CalDAV |
| Attendees / RSVP | PASS normalized/direct | PASS normalized/direct | Same as CalDAV |
| Application Mail iTIP | PASS | PASS | PASS |
| Remote participant Free/Busy | PASS automated | Conditional RFC 6638 | PASS discovery LIVE / query automated |
| Shared/effective access | PASS mapping | PASS partial DAV mapping | Same as CalDAV; owned live only |
| ACL management | MISSING | MISSING | MISSING |
| Delta durability | PARTIAL/inconsistent | MISSING | MISSING |

## Mail lifecycle

CAL-122 closes the previous contradictory `PARTIAL/MISSING` rows. REQUEST, REPLY and CANCEL are ingested at Gmail/IMAP storage boundaries; UID/RECURRENCE-ID/SEQUENCE/DTSTAMP and sender/organizer validation drive durable idempotent reconciliation. Mail RSVP and outbound create/update/cancel use per-recipient `calendar_itip_actions` linked to the existing `sendMessage` queue. Automated acceptance covers delivery/retry/failure; no real email or cloud RSVP was sent.

## Reminder delivery

CAL-121 closes delivery, snooze, dismiss, catch-up and dedupe. Delivery is supported while the Tauri process remains alive in tray/background. If the application is fully terminated, real-time delivery is impossible because Office360 has no OS background service; on restart, the bounded catch-up window runs. This is a declared desktop architecture limitation, not a P0 under the approved tray-resident product contract.

## Remaining gaps

### P0

None.

### P1 — material parity or release-readiness gaps

1. Recurring-series creation/editor; `this-and-future` remains a declared limitation.
2. Participant picker/directory and persistent required↔optional authoring.
3. Shared-calendar subscription/share/ACL management plus isolated live shared/read-only acceptance.
4. Account- and permission-filtered Calendar event search.
5. Month `+N` details interaction and locale/configurable Monday-first week.
6. Consolidated durable provider delta sync and explicit offline-write policy, including Google expired-token recovery and CalDAV sync-token/ctag strategy.

### P2 — polish and hardening

1. Current-time indicator, richer date navigation and consistent RU editor/time labels.
2. Auto-scroll, multi-day all-day create drag and optional keyboard drag-selection.
3. Full responsive-density, light/dark visual regression and WCAG audit.
4. Bundle/code-splitting and Calendar orchestration cleanup.

### Explicitly out of parity scope

1. Pixel-identical Yandex branding/CSS.
2. Organization directory rewrite, room booking/availability, tasks/templates and Alice.
3. Touch/mobile-first behavior unless separately promised.
4. OS-level reminders after full process termination without a background service.

## Focused P1 findings

- **Recurring create: MISSING.** Create UI/provider input has no recurrence rule; existing series mutation support does not close authoring.
- **Participant authoring: PARTIAL.** Email entry adds required attendees. Scheduling Assistant role toggles are local planning state and do not persist optional roles.
- **ACL management: MISSING.** Effective permission discovery/enforcement is PASS, but provider sharing mutations and management UI are absent.
- **Calendar search: MISSING.** Mail/global search is not a Calendar event search substitute.
- **Month overflow: PARTIAL.** `+N ещё` renders but its click only stops propagation and opens no details surface.
- **RU localization/week-start: PARTIAL.** Russian day/month labels exist, but Month/Week arrays and range math are Sunday-first; editor still mixes Russian and English copy.
- **Current-time indicator: MISSING/P2.** Today header styling exists; no Day/Week horizontal current-time marker.
- **Delta sync/offline: PARTIAL.** Cached reads and stale UI are strong. Google background delta token persistence exists but is inconsistent with capabilities and foreground ownership; CalDAV has no delta; offline writes are unsupported.

## Test health on clean `ff9e5fa`

| Check | Result |
|---|---|
| TypeScript `npx tsc --noEmit` | PASS |
| Full Vitest | PASS — 250 files / 2473 tests |
| TZ matrix | PASS — 15 files / 186 tests in each of UTC, Europe/Moscow, America/New_York, Australia/Lord_Howe |
| Frontend production build | PASS — main 2,102.51 kB / 623.57 kB gzip; Calendar 120.84 kB / 35.60 kB gzip |
| `cargo check` | PASS — two pre-existing unused-variable warnings at `src/lib.rs:378` |

Known non-failing test/build noise: existing React `act(...)` warnings, externalized `stream` warning from transitive `sax`, mixed static/dynamic import warnings and main chunk >500 kB.

## Live evidence boundary

- Month/Week/Day, calendar list, event details and local visibility: LIVE from prior read-only Tauri smokes.
- Shared-calendar read: production semantics automated; no live shared/read-only fixture.
- Native notification toast path: LIVE local CAL-121 hook; real due event absent.
- Invitation lifecycle: AUTOMATED only; no live mail/RSVP send.
- Yandex RFC 6638 discovery: LIVE on two account classes.
- VFREEBUSY transport: AUTOMATED; live scheduling POST not executed.

No new Tauri runtime was required for this docs-only re-audit because `ff9e5fa` already has recorded runtime evidence and the current full production-code battery passed unchanged.

## Code health

- `CalendarPage.tsx` remains a 736-line presentation/orchestration owner.
- Foreground `CalendarSyncService` and background `gmail/syncManager` duplicate calendar discovery/reconciliation responsibilities.
- Google delta tokens are stored by the background path, but capabilities say ephemeral and 410 recovery does not clear the stored token.
- `src/services/google/calendar.ts` remains an unreferenced legacy candidate.
- Main bundle is 2,102.51 kB raw / 623.57 kB gzip; existing chunk warnings remain.
- Graphify index is healthy at 6,760 nodes / 17,358 edges / 414 communities, but saved community labels are stale; query tooling package warns that skill 0.9.33 is newer than interpreter package 0.9.31.
- Rust retains two pre-existing unused-variable warnings.

These are technical debt unless they directly map to the P1 delta/offline item above.

## Release boundary and merge recommendation

### Must before merge

1. Owner explicitly accepts that this merge is a scoped provider-neutral Calendar release candidate, not a literal full Yandex Calendar parity claim.
2. Preserve the green CI/build gate and docs-only audit commit; no additional P0 code blocker is known.

### Must before broad release

1. Run isolated non-personal live acceptance for provider create/edit/delete/recurrence/RSVP/outbound invitation and shared/read-only roles, or explicitly ship those as automated-only evidence.
2. Select and close or explicitly defer the promised P1 product boundary: recurring create, persistent participant roles, search and ACL management.
3. Resolve/document the Google token-recovery/capability inconsistency and the CalDAV/offline sync policy before claiming robust offline/delta behavior.

### Acceptable post-merge

1. Month overflow, Monday/configurable week start and current-time line if they are not part of the first release promise.
2. Auto-scroll, multi-day all-day selection and keyboard drag-selection.
3. WCAG, responsive, dark/light and bundle hardening.

### Final classification

- Literal Yandex 360 parity-complete: **NO**.
- Open P0: **NONE**.
- Scoped Calendar foundation/release-candidate merge: **YES WITH CONDITIONS**.
- Feature-complete: **NO** for the literal parity claim; strong release candidate with declared P1 limitations.

## Audit constraints

- Production feature code unchanged.
- No migration, DB mutation, cloud event/RSVP/mail/ACL mutation, deploy or secret access.
- Graphify queried for navigation; no index update is required for docs-only changes.
