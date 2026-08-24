# CAL-131 — Final Calendar Parity Audit

Дата аудита: 2026-08-24 (Asia/Bangkok)
Ветка: `feat/calendar-yandex360`
Аудируемый HEAD: `e627460 docs(calendar): complete CAL-130 live smoke`
Тип работы: audit-only; feature code, schema, runtime DB и provider data не менялись.

## Final verdict

**CAL-131: PASS.** В утверждённой provider-neutral границе Calendar является feature-complete и готов к merge с явно принятыми ограничениями. Открытых P0 нет. Оставшиеся P1/P2 не разрушают основные пользовательские потоки и не требуют feature changes перед merge.

**Calendar DONE: YES — DONE as provider-neutral Office360 Calendar release.**

**Literal Yandex 360 parity: NO.** Это не pixel/feature clone Яндекс 360: standard DAV не подтвердил Yandex ACL writes, отсутствуют mini calendar, полный редактор nth-weekday и часть расширенных interaction patterns.

**Merge recommendation: YES WITH CONDITIONS.** Владелец принимает описанную release boundary, provider/platform limitations и post-merge backlog; merge выполняется только при сохранении текущей зелёной проверки ветки.

## Fresh scoring method

Проценты пересчитаны с нуля по состоянию после CAL-125…CAL-130. Это не перенос старых значений. Каждое измерение оценено отдельно по weighted acceptance groups: подтверждённый production path получает полный вес, автоматизированный destructive/provider path — полный функциональный вес с readiness deduction, documented partial — половину, отсутствующий in-scope path — ноль. Out-of-scope features не маскируются как реализованные и не создают P0.

| Измерение | Весовые группы | Итог | Главные deductions |
| --- | --- | ---: | --- |
| Functional parity | Views/CRUD/recurrence 25; participants/scheduling 20; Mail/reminders 20; permissions/ACL 10; search/time/interactions 15; sync/offline 10 | **96%** | no this-and-future; no directory picker/subscription management; Yandex ACL write unsupported |
| Interaction parity | authoring/manipulation 35; navigation/search 20; keyboard/focus 20; responsive 15; locale/state feedback 10 | **91%** | keyboard drag-selection, drag auto-scroll, live opener-focus evidence gap, limited recurrence authoring |
| Visual parity | hierarchy/consistency 30; light/dark 20; responsive 20; state clarity 15; locale/a11y presentation 15 | **89%** | no formal visual-regression/WCAG certification; no exhaustive density/device matrix; literal Yandex visual parity not targeted |
| Production readiness | correctness/tests 30; provider safety 20; privacy/permissions 15; sync/offline 15; runtime evidence 10; operability/performance 10 | **90%** | safe-smoke policy leaves destructive cloud paths fixture-only; no full DB rollback transaction; terminated-process limits; bundle hardening remains |

## Core flows A–J

| Flow | Verdict | Evidence and boundary |
| --- | --- | --- |
| A. View/navigation | **PASS** | Month/Week/Day, calendar list, RU Monday-first, current-time indicator and view navigation are automated; Month/Week/Day were read-only live-smoked in CAL-129/CAL-130. |
| B. Create → recurrence → participants → reminders → scheduler → Save contract | **PASS** | Unified create contract covers RRULE, required/optional roles, reminders and Scheduling Assistant re-query. Live smoke opened and cancelled forms; provider writes are covered by fixtures by cloud-safety policy. |
| C. Edit/drag/resize/update | **PASS** | Timed/all-day move and resize use provider-neutral capability/permission checks, optimistic rollback and recurrence scope. Automated regressions remained green after CAL-130. |
| D. Recurring single/series | **PASS with limitation** | Single-occurrence and entire-series edit are explicit and tested; exception identity is preserved. `this-and-future` is intentionally unsupported. |
| E. Participant Free/Busy | **PASS** | Participant identity/roles, Scheduling Assistant intervals, Google, generic CalDAV and discovery-gated Yandex RFC 6638 paths share one contract. No unsafe live scheduling POST was sent. |
| F. Shared/read-only/ACL | **PASS in provider-neutral scope** | CAL-119 enforcement and CAL-128 ACL service/UI protect unknown/read-only/owner states. Google and capable generic CalDAV writes are automated. Live Yandex standard DAV discovery returned unsupported and exposed no write controls. |
| G. Mail invite lifecycle | **PASS** | REQUEST/REPLY/CANCEL, automatic ingestion, organizer reconciliation, SEQUENCE/idempotency and existing Mail outbox delivery are automated. No real message was sent during acceptance. |
| H. Reminder lifecycle | **PASS while process/tray runtime is active** | Durable dedupe, mutation reconciliation, native delivery, dismiss, snooze and startup catch-up are implemented. A fully terminated process has no OS background service. |
| I. Search → detail | **PASS** | Permission-scoped local-cache search, recurrence dedupe, keyboard navigation and detail opening passed automated coverage and live Cyrillic Tauri smoke. |
| J. Offline/stale/reconnect/delta | **PASS** | One sync coordinator owns startup/manual/reconnect refresh; Google tokens/410 and RFC 6578/fallback paths are durable and single-flight. Offline reads work; writes fail typed and are never silently queued. |

## Capability audit

| Surface | Verdict | Notes |
| --- | --- | --- |
| Month / Week / Day | PASS | Stable navigation, loading/error/stale feedback, locale-correct range math. |
| Create / edit / delete | PASS | Capability- and permission-gated provider-neutral write paths. |
| Recurring create / edit | PASS with P1 limitation | Presets/custom interval/days/until/count and single/series edits; no this-and-future or full nth-weekday editor. |
| Participants | PASS | Canonical identity, organizer, required/optional, response and resource semantics. |
| RSVP | PASS | Local projection and remote delivery semantics share the participant model. |
| Scheduling Assistant | PASS | Debounced/cancellable role-aware Free/Busy queries and privacy-safe intervals. |
| Free/Busy | PASS | Google, generic CalDAV and discovery-gated Yandex RFC 6638. |
| Mail REQUEST/REPLY/CANCEL | PASS | Durable idempotent lifecycle; no second SMTP queue. |
| Reminders | PASS with platform limit | Provider semantics plus durable native delivery, snooze/dismiss/catch-up. |
| Shared/read-only calendars | PASS | Effective permission and provider-presence enforcement. |
| ACL management | PASS with provider limit | Google/capable CalDAV supported; Yandex unsupported when RFC 3744 write capability is absent. |
| Drag / resize | PASS | Timed and all-day interactions, recurrence scope and rollback. |
| All-day / Month interactions | PASS | Exclusive-end semantics, create-by-selection and overflow popover. |
| Month overflow | PASS | `+N` automated acceptance; no qualifying event density in live fixture. |
| Monday-first RU | PASS | Month and Week use locale boundary helpers. |
| Current-time indicator | PASS | Day/Week position follows display timezone and DST-safe domain. |
| Calendar search | PASS | Local bounded privacy-scoped search; no fuzzy/FTS. |
| Timezone / DST | PASS | UTC, Moscow, New York and Lord Howe matrix; gap/overlap and recurrence wall-clock contract. |
| Privacy / permissions | PASS | Free-busy-only redaction, account/calendar scoping, typed write denial, secret-safe diagnostics. |
| Delta sync | PASS | Google durable tokens/tombstones/410; RFC 6578 when advertised; bounded CalDAV fallback. |
| Offline reads | PASS | Cached views/search/reminders remain available with explicit stale/offline state. |
| Offline write policy | PASS | No hidden queue; event/RSVP/ACL writes are blocked with typed errors. |
| Accessibility / keyboard / focus | PASS for scoped controls | Search, dialogs and popovers support keyboard/focus trap; keyboard drag-selection is not implemented. |
| Responsive / light / dark | PASS | Narrow layouts, wrap/overflow and token-based themes passed CAL-130 acceptance. |

## Provider summary

- **Google:** normalized events, attendees, reminders, Free/Busy, official ACL CRUD and durable delta token/410 recovery are covered by conformance and integration fixtures. No live Google account was available for CAL-128/CAL-130 smoke.
- **Generic CalDAV:** standard discovery, iCalendar mapping, conditional RFC 6638 Free/Busy, conditional RFC 3744 ACL and RFC 6578 delta are capability-driven. The bounded fallback cannot infer tombstones outside its covered window.
- **Yandex:** repeated live read-only Calendar discovery/load, events, Month/Week/Day, search and RFC 6638 capability discovery passed. Standard DAV did not confirm ACL write capability, therefore sharing mutations remain unsupported by design. No provider-name UI bypass or private API is used.

## Lifecycle summaries

### Mail lifecycle

**PASS.** Inbound REQUEST/REPLY/CANCEL is processed during Mail ingestion, not only when ThreadView opens. Durable action identity, UID/RECURRENCE-ID/SEQUENCE/DTSTAMP validation and source fingerprints prevent duplicate/stale application. Outbound lifecycle uses the existing Mail delivery mechanism. Real send/RSVP was intentionally excluded from safe smoke.

### Reminder lifecycle

**PASS within the declared desktop runtime.** Canonical reminders reconcile to privacy-minimal durable delivery rows; delivery keys dedupe; event/reminder changes cancel or replace pending work; native delivery, dismiss, snooze and startup catch-up are covered. Fully terminated application delivery is not supported without an OS background service.

### Search

**PASS.** Search is account/calendar/permission-scoped, excludes removed/cancelled and free-busy-only details, normalizes participants and deduplicates recurrence. Exact substring search is intentional; fuzzy ranking and SQLite FTS are post-merge enhancements.

### ACL

**PASS in capability-driven scope.** Owner/current-user protections, duplicate principals, permission denial and access refresh follow CAL-119. DB is refreshed through provider discovery after mutations, not patched as ACL source of truth. Yandex writes remain an accepted provider limitation.

### Delta/offline

**PASS.** Cache changes precede cursor commit; crash replay is idempotent and cursor-last. This gives durable convergence without claiming a single full SQLite rollback transaction. Offline writes are rejected rather than queued, avoiding ambiguous remote conflict semantics.

### Accessibility

**PASS for release controls; P2 interaction gaps remain.** Dialog/popover traps, Escape, search keyboard navigation, labels and responsive focus handling are automated. CAL-130 live CDP confirmed trap/Escape but did not conclusively observe opener focus restoration; automated coverage does. Keyboard drag-selection and formal WCAG AA certification remain follow-ups.

### Responsive/theme

**PASS.** Month/Week/Day chrome, calendar list, toolbar, create/detail/ACL dialogs and footer were checked at normal and ~900×780 widths. Light/dark themes use shared tokens; live toggle/restoration passed. No exhaustive device/pixel-diff suite was run.

## Remaining limitations and severity

### P0

**None.** No known issue blocks the scoped provider-neutral release or risks silent data mutation/loss in the accepted flows.

### P1

1. Recurring edit has no `this-and-future` scope.
2. Participant authoring has no organization directory/picker; identities are entered directly.
3. Shared-calendar subscription management and an isolated live shared/read-only/free-busy-only acceptance fixture remain absent. Share/ACL management itself is delivered.

### P2

1. No full RFC 5545 nth-weekday recurrence editor.
2. Search has no fuzzy ranking or SQLite FTS index.
3. No keyboard drag-selection and no drag-edge auto-scroll.
4. Delta cache/cursor application uses cursor-last idempotent replay rather than one full SQLite rollback transaction.
5. Formal WCAG AA certification, screenshot visual regression and measured large-calendar/bundle hardening remain.

### Accepted provider/platform limitations

1. Background sync/reminder delivery while the process is fully terminated is unsupported; startup catch-up is mandatory and implemented.
2. Yandex ACL writes are unsupported because public/standard DAV write capability was not confirmed.
3. CalDAV bounded fallback cannot observe provider tombstones outside the covered range when RFC 6578 is unavailable.
4. The live CAL-130 dataset contained no day with more than three events, so `+N` was live N/A; automated interaction coverage passed.
5. Destructive Google/CalDAV mutations, real invitations/RSVP and live ACL writes remain automated-only under cloud-safety policy.

### Out of scope

- Mini calendar, literal Yandex branding/pixel clone and complete Yandex proprietary feature parity.
- Mobile-native/touch redesign, organization directory rewrite, room booking, tasks/templates and provider-private APIs.

## Merge boundary

### Must before merge

1. Record explicit owner acceptance of `DONE as provider-neutral Office360 Calendar release` and `Literal Yandex 360 parity: NO`.
2. Preserve the current green TypeScript/Vitest/TZ/build/Rust state in merge CI; any new product-code change requires its own verification.
3. Keep cloud mutations, production/deploy and secrets outside this docs-only audit/merge step.

There is no required feature fix or P0 code change before merge.

### Acceptable post-merge

- The three P1 items and P2 hardening above.
- Isolated provider fixtures for destructive delta/ACL/Mail scenarios, plus large-calendar performance measurement.
- Broader accessibility/device/visual-regression certification.

## Verification basis

CAL-131 did not rerun or mutate runtime state because audited HEAD contains only the CAL-130 evidence update after the already-verified product commit. Current canonical evidence:

| Check | Current result |
| --- | --- |
| TypeScript | PASS — `npx tsc --noEmit` at CAL-130 |
| Targeted Calendar UI | PASS |
| Calendar battery | PASS — 75 files / 672 tests |
| Full Vitest | PASS — 264 files / 2,564 tests |
| TZ matrix | PASS — 15 files / 186 tests in each of UTC, Europe/Moscow, America/New_York and Australia/Lord_Howe |
| Frontend production build | PASS |
| `cargo check` | PASS; two pre-existing unused-variable warnings in `src/lib.rs:378` |
| Tauri | PASS for safe CAL-130 A–H except live `+N` N/A fixture and inconclusive CDP opener-focus observation; automated paths PASS |

Graphify was queried before the audit across Calendar UX, recurrence, participants, Free/Busy, ACL, reminders, search and sync/offline subgraphs. `graphify diagnose multigraph` reports 7,085 nodes / 18,309 edges with zero unverified nodes, missing/dangling endpoints, self-loops or exact duplicate edges. No graph update is required for docs-only edits; no stale code finding affects this verdict.

## Final answer

- **Feature-complete:** YES, inside the provider-neutral release boundary.
- **Literal Yandex 360 parity:** NO.
- **Calendar DONE:** YES — **DONE as provider-neutral Office360 Calendar release**.
- **Merge recommendation:** **YES WITH CONDITIONS**.
