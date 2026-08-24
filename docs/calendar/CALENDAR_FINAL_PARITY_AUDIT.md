# CAL-124 — Office360 Calendar final parity re-audit

Дата: 2026-08-23 (Asia/Bangkok)

Ветка: `feat/calendar-yandex360`

Production HEAD: `ff9e5fa`

Предыдущий audit: `cf16a16` (CAL-120)

Закрывающие P0 commits: `7839344` (reminder delivery), `c559ccc` (Mail/iTIP lifecycle), `ff9e5fa` (Yandex remote Free/Busy).

CAL-125 (2026-08-23) закрывает recurring create UI и persistent required/optional authoring. CAL-126 (2026-08-24) закрывает Month overflow popover, RU Monday-first week start и Day/Week current-time indicator (display timezone). CAL-127 (2026-08-24) закрывает account/permission-filtered Calendar event search по локальному provider-neutral cache. CAL-128 закрывает ACL management UI/service. CAL-129 закрывает durable delta sync и offline write policy. CAL-130 (2026-08-24) закрывает polish-класс UI (focus, RU copy, responsive, offline/stale banners) без финального parity verdict — это CAL-131. Этот файл остаётся каноническим parity verdict; дельты отмечены ниже. Live Save на real Yandex event по-прежнему запрещён.

## Executive verdict

Все три P0 из предыдущего аудита закрыты. Office360 Calendar имеет provider-neutral Month/Week/Day, CRUD, безопасные single/series recurrence mutations, recurring create и series RRULE editor, persistent required/optional authoring, participant semantics, Scheduling Assistant, Google и discovery-confirmed CalDAV/Yandex remote Free/Busy, application Mail iTIP lifecycle и durable local reminder delivery.

Буквальный продуктовый паритет с Yandex 360 Calendar ещё **не достигнут**: ACL/share management отсутствует, а `this-and-future` намеренно unsupported. Month overflow, RU Monday-first и current-time line закрыты CAL-126; Calendar search закрыт CAL-127. Поэтому итог: **P0 CLOSED; P1 FOLLOW-UP; MERGE YES WITH CONDITIONS**. Ветку можно merge как scoped Calendar release candidate, но нельзя называть полностью parity-complete без явно принятой P1 boundary.

### Recalculated scores

| Dimension | Score | Evidence-based interpretation |
|---|---:|---|
| Functional parity | **94%** | P0 + recurring create + participant roles + Month/locale/current-time + Calendar search закрыты; ACL management остаётся P1 |
| Interaction parity | **89%** | Grid, recurrence, roles, scheduling, reminders, overflow, search и invitations сильные; picker/share interactions остаются |
| Visual parity | **74%** | Coherent Office360 surface, current-time line и RU week grid; не pixel clone; смешанный RU/EN copy вне recurrence/role editor |
| Production readiness | **85%** | Clean full battery и durable local lifecycles; live destructive/shared fixtures и provider delta/offline policy остаются gaps |

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
| Create event | PASS | Provider create, grid drafts, RRULE presets/custom, required/optional roles, reminders, assistant and outbound REQUEST; directory/picker remains P1 |
| Edit event | PASS | Typed provider mutation, ETag when present, attendees/reminders/roles, series RRULE, assistant and outbound update lifecycle |
| Delete event | PASS | Plain/series/single safe paths plus outbound CANCEL; destructive live acceptance intentionally limited |
| Recurring create | PASS | CAL-125: presets, custom interval/days/until/count, all-day, create-by-selection; live evidence is Create → Cancel only |
| Recurring edit | PASS | Explicit single/series scopes, series RRULE editor, occurrence cannot overwrite master; `this-and-future` intentionally unsupported |
| Participants | PARTIAL | Domain/provider/write lifecycle and required/optional rows complete; authoring remains email input without directory/picker |
| Required / optional | PASS | Persistent ROLE authoring, in-place toggle, identity merge and Scheduling Assistant re-query; chair/non-participant remain non-authored |
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
| Search | PASS (CAL-127) | Toolbar search over provider-neutral local cache; title/description/location/participant matching, account/calendar/date filters, privacy boundary, deterministic recurrence result and keyboard navigation |
| Accessibility | PARTIAL | Keyboard create/open/edit, modal/radio semantics and ARIA exist; no WCAG audit or keyboard drag-selection |
| Responsive | PARTIAL | LIVE ~720 px create/assistant smoke; dense Month/Week and toolbar matrix incomplete |
| Dark mode | PARTIAL | Semantic theme tokens are used; dedicated light/dark visual regression is absent |

## Core user flows

### Flow A — Open Calendar → Month/Week/Day → calendars visibility

**PASS (LIVE).** Navigation, multiple calendars and reversible local visibility are confirmed. Visibility is not ACL/subscription mutation.

### Flow B — Create → participants → required/optional → reminders → Scheduling Assistant → Save → outbound invitation

**PASS (AUTOMATED; live Create → Cancel only).** Recurrence presets/custom, required/optional persistence, reminders, assistant re-query and outbound REQUEST with RRULE+ROLE are covered. Real Save/mail was not executed.

### Flow C — Edit → drag/resize → participants/reminders → send update

**PASS with mixed evidence.** Typed edit, drag/resize, reminder preservation and outbound attendee update are automated; prior runtime proved details and one real non-recurring move. A complete destructive provider matrix was not repeated.

### Flow D — Recurring occurrence → edit/delete → single/series

**PASS for create + existing series; `this-and-future` remains unsupported.** Office360 can author a series, edit master RRULE on `scope=series`, and keep occurrence edits from overwriting the master. Live series Save was not executed.

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
| Recurrence | Read + create RRULE + single/series mutations | Read + create RRULE + single/series mutations | Same as CalDAV |
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

1. `this-and-future` remains a declared limitation (not offered as a working option).
2. Participant picker/directory (required/optional authoring is delivered by CAL-125).
3. Shared-calendar subscription management plus isolated live shared/read-only acceptance (share/ACL management delivered by CAL-128).
4. Durable provider delta sync and explicit offline-write policy — **closed by CAL-129**. Isolated large-calendar/provider fixtures remain a broad-release validation item, not a P1 code gap.

### P2 — polish and hardening

1. Richer date navigation beyond RU Monday-first / EN Sunday-first (current-time line delivered CAL-126).
2. Auto-scroll, multi-day all-day create drag and optional keyboard drag-selection.
3. Full WCAG AA certification and visual-regression suite (obvious responsive/focus/RU/offline polish delivered CAL-130; see `CALENDAR_FINAL_UI_POLISH.md`).
4. Measured bundle/code-splitting; CAL-130 only did safe Calendar-local cleanup (`focusTrap`, no `CalendarPage` rewrite).

### Explicitly out of parity scope

1. Pixel-identical Yandex branding/CSS.
2. Organization directory rewrite, room booking/availability, tasks/templates and Alice.
3. Touch/mobile-first behavior unless separately promised.
4. OS-level reminders after full process termination without a background service.

## Focused P1 findings

- **Recurring create: PASS (CAL-125).** Presets, custom weekly days, until/count, all-day and series RRULE edit; occurrence cannot overwrite master.
- **Participant authoring: PARTIAL.** Required/optional persist from create/edit rows. Directory/picker is still absent.
- **ACL management: PASS (CAL-128, automated mutations/read-only live policy).** Effective permissions remain CAL-119-owned; provider-neutral list/grant/update/revoke, owner protection, Google scope gates, RFC 3744 conditional CalDAV/Yandex support and capability-driven UI are implemented. No real cloud ACL was mutated.
- **Calendar search: PASS (CAL-127).** Dedicated bounded local-cache query with account/calendar/date filters; hidden readable calendars included; removed/cancelled/free-busy-only excluded; existing detail modal reused.
- **Month overflow: PASS (CAL-126).** `+N ещё` opens popover with hidden day events; event click routes to detail; create-by-selection guarded.
- **RU localization/week-start: PASS (CAL-126) for grid.** RU Month/Week start Monday via `weekLocale`; non-RU Sunday-first preserved. Editor copy still mixes RU/EN outside recurrence/role surfaces.
- **Current-time indicator: PASS (CAL-126).** Day/Week horizontal marker from display timezone; hidden outside visible today column.
- **Delta sync/offline: PASS (CAL-129).** Coordinator-owned delta, durable Google/CalDAV cursors, explicit offline write block. Isolated large-calendar fixtures remain broad-release validation.
- **UI polish: PASS (CAL-130, automated).** Focus, RU copy, responsive wrap, offline vs stale banners. WCAG AA certification and WebView2 interactive A–H remain outside this ticket. Final parity verdict is CAL-131.

## Test health after CAL-126

| Check | Result |
|---|---|
| TypeScript `npx tsc --noEmit` | PASS |
| Targeted CAL-126 (overflow/week/current-time) | PASS — 5 files / 29 tests |
| Full Calendar UI/provider battery | PASS — 69 files / 660 tests |
| TZ matrix | PASS — 15 files / 186 tests in each of UTC, Europe/Moscow, America/New_York, Australia/Lord_Howe |
| Frontend production build | PASS — main 2,110.48 kB / 626.54 kB gzip; CalendarPage 134.94 kB / 39.25 kB gzip |
| Live Tauri CAL-126 smoke | NOT RUN — no Tauri session at closure |

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
- CAL-129 consolidated foreground/background/startup/manual/reconnect ownership in `CalendarSyncCoordinator`; delta cursor consumption is single-flight per account.
- Google and discovery-confirmed RFC 6578 CalDAV/Yandex cursors are durable. Google 410 clears the cursor and performs one controlled authoritative recovery before replacement-token commit.
- `src/services/google/calendar.ts` remains an unreferenced legacy candidate.
- Main bundle is 2,102.51 kB raw / 623.57 kB gzip; existing chunk warnings remain.
- Graphify index after CAL-125 `graphify update .`: 6,844 nodes / 17,606 edges / 406 communities; 0 unverified/missing/dangling/self-loop/duplicate edges. Saved community labels are stale (414 saved vs 406 communities). Semantic `--update` was not used (openai extra unavailable); code AST index was refreshed.
- Rust retains two pre-existing unused-variable warnings.

These are technical debt unless they directly map to the P1 delta/offline item above.

## Release boundary and merge recommendation

### Must before merge

1. Owner explicitly accepts that this merge is a scoped provider-neutral Calendar release candidate, not a literal full Yandex Calendar parity claim.
2. Preserve the green CI/build gate and docs-only audit commit; no additional P0 code blocker is known.

### Must before broad release

1. Run isolated non-personal live acceptance for provider create/edit/delete/recurrence/RSVP/outbound invitation and shared/read-only roles, or explicitly ship those as automated-only evidence.
2. Select and close or explicitly defer the remaining P1 product boundary: shared-calendar subscription and participant directory (ACL/share management closed by CAL-128; search closed by CAL-127; recurring create and persistent participant roles closed by CAL-125).
3. Durable delta/recovery and explicit offline write policy are closed by CAL-129; broad-release validation should still include isolated large-calendar/provider fixtures.

### Acceptable post-merge

1. Configurable week-start beyond RU Monday / EN Sunday if product expands locale matrix (CAL-126 delivered RU Monday-first).
2. Auto-scroll, multi-day all-day selection and keyboard drag-selection.
3. WCAG AA certification and measured bundle hardening (CAL-130 closed obvious visual/a11y/responsive polish; not a final parity verdict).

### Final classification

- Literal Yandex 360 parity-complete: **NO**.
- Open P0: **NONE**.
- Scoped Calendar foundation/release-candidate merge: **YES WITH CONDITIONS**.
- Feature-complete: **NO** for the literal parity claim; strong release candidate with declared P1 limitations.

## Audit constraints

- Production feature code unchanged.
- No migration, DB mutation, cloud event/RSVP/mail/ACL mutation, deploy or secret access.
- Graphify queried for navigation; no index update is required for docs-only changes.
