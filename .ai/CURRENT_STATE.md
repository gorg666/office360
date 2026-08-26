# Current State

> Living snapshot for AI sessions. Update when context grows large. Do not invent facts.

## Last updated

2026-08-22 (Asia/Bangkok) — Calendar CAL-105 local validation complete; legacy hybrid checkpoint remains unchanged

## Project

**YALINUX360** — workspace; Office 360 tooling root: `velo-office360-api-ya-clean`  
Remote GitHub: `gorg666/office360`

## Active focus

- Branch: **`GORGDEV2-EFIM-INTEGRATION`** (checkpoint after `3c592fe` + MSG/HUB fixes)
- Protected baseline: `2aaa905…` (ancestor; not rewritten)
- Push integration branch: yes (this checkpoint)
- Merge back to `GORGDEV2`: **NO**

## Integration verdict

**INTEGRATION PARTIAL — NOT READY TO MERGE BACK TO GORGDEV2**

| Area | Status |
|---|---|
| Mail | PASS |
| Sidebar icons | PASS |
| Mail unread badge | PASS |
| Outbox badge | PASS |
| Tasks badge | PASS |
| Disk | PASS |
| Tracker | PARTIAL (TRACKER-003/004 etc.) |
| Telemost smoke | PASS |
| Account Hub | PASS |
| Messenger | PARTIAL / P1 **MSG-HYBRID-002** |

## Bugs

- MSG-HYBRID-001 — **CLOSED/PASS** (tabs + NEEDS ACCESS CTA)
- HUB-HYBRID-001 — **CLOSED/PASS** (RU «Подключено» / «Требуется доступ»)
- MSG-HYBRID-002 — **OPEN P1** — after communications consent, Yandex Messenger endless loader; widget/iframe content missing

## Next step

- Diagnose MSG-HYBRID-002 only when explicitly requested
- Do not merge back to GORGDEV2 until Messenger widget usable (or waiver)

## Calendar feature checkpoint

2026-08-22 (Asia/Bangkok) — branch `feat/calendar-yandex360`.

- CAL-101A/B/C: PASS; CAL-BUG-101 and CAL-BUG-103 closed.
- CAL-102: PASS locally. Provider-neutral time/occurrence domain, Google/CalDAV conformance, wall-clock recurrence, ParticipantRef/capabilities, append-only migration v34 and lazy legacy reads implemented. CAL-102F isolates malformed CalDAV objects/components and uses duration-aware recurrence lookback.
- Verification: TypeScript/build PASS; full Vitest 200 files / 2025 tests PASS; four-host-TZ matrix 33/33 per zone PASS; SQLite fresh/existing/legacy/new semantic row PASS; cargo check PASS; read-only Yandex Tauri Month/Week/Day/calendar-list smoke PASS.
- Local development DB only applied v34. No production/deploy/seed/reset/cloud event mutation.
- Canonical detail: `docs/calendar/CALENDAR_TIME_MODEL.md` and `docs/calendar/CALENDAR_RUNTIME_BASELINE.md`.
- CAL-103: PASS locally. `ical.js` 2.2.1 is isolated behind the Calendar codec; handwritten production parser/serializer helpers were removed. CAL-102 time/occurrence rules remain authoritative; VTIMEZONE aliases, provider-neutral unsupported-TZID diagnostics, recurrence preservation, malformed isolation, Mail invitations, and provider conformance are covered.
- CAL-103 verification: TypeScript PASS; targeted Calendar/legacy DB 184/184; four-host-TZ codec/domain matrix 45/45 per zone; full Vitest 201 files / 2037 tests; production build and cargo check PASS; read-only Yandex Month/Week/Day/two-calendar-list Tauri smoke PASS. Existing live recurrence was not identifiable; recurrence is covered by fixtures/provider tests.
- CAL-104: PASS locally. A single cache-first sync service now owns provider fetch, coverage accounting, authoritative/degraded reconciliation, cache reload and safe UI status. Google bounded fetch consumes every page; generic CalDAV advertises range-refresh. Stable local RSVP projections and stale request fencing are covered.
- Migration v35: append-only and applied only to local development DB. Runtime schema/version and aggregate-only verification PASS: version 35, 3 semantic event columns, 10 coverage columns, 6 complete coverage rows, 3 remote events. No production/deploy/seed/reset/delete/backfill/cloud event mutation.
- CAL-104 verification: TypeScript PASS; targeted Calendar/provider/UI 163/163; four-host-TZ matrix 45/45 per zone; full Vitest 203 files / 2055 tests; v34+v35 fresh/existing migration verifier PASS; production build and cargo check PASS; read-only Yandex Month/Week/Day/calendar-list/switch/refresh Tauri smoke PASS. Only one Calendar account was available live; account/range race fencing is automated.
- CAL-105: PASS locally. Capability v2 truthfully declares Google/CalDAV/Yandex CRUD, recurrence scopes, attendee/RSVP, sync durability, Free/Busy/ACL/reminders and ETag behavior. Typed mutation service blocks unsupported scopes, protects CalDAV occurrence delete, sanitizes write results and reconciles successful writes through CAL-104. Mail RSVP without remote locator is terminal unsupported without retry. No migration or real cloud mutation.
- CAL-105 verification: TypeScript PASS; targeted 13 files / 215 tests; four-host-TZ matrix 45/45 per zone; full Vitest 205 files / 2071 tests; production build and cargo check PASS; read-only Yandex Month/Week/Day/two-calendar-list/capability-resolution Tauri smoke PASS.
- Next Calendar step after CAL-105 acceptance: CAL-106 only by explicit instruction; do not start automatically.

## Calendar CAL-128 checkpoint

2026-08-24 (Asia/Bangkok) — branch `feat/calendar-yandex360`.

- CAL-128: PASS locally. Provider-neutral ACL list/grant/update/revoke, normalized roles, Google official ACL adapter with persisted OAuth-scope gating, RFC 3744 conditional CalDAV/Yandex adapter, owner/current-user protection, capability-driven UI and CAL-119 refresh reconciliation are implemented.
- Migration: NONE. ACL entries remain provider-owned; no production/deploy/secrets or real cloud ACL mutation.
- Verification: TypeScript PASS; targeted 22 files / 207 tests; TZ matrix 186/186 per zone; full Vitest 263 files / 2548 tests; production build and cargo check PASS.
- Read-only Tauri: Month/Week/Day and two Yandex collections PASS; live RFC 3744 discovery returned unsupported and UI disabled all mutation controls.
- Graphify: 7028 nodes / 18173 edges / 419 communities; integrity PASS.
- Next Calendar step: delta/offline sync only by explicit instruction; do not start automatically.
