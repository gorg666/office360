# Current State

> Living snapshot for AI sessions. Update when context grows large. Do not invent facts.

## Last updated

2026-08-11 (~22:50 ICT) — hybrid checkpoint freeze (MSG-HYBRID-001/HUB closed; MSG-HYBRID-002 open)

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
- Next Calendar step: CAL-104 only by explicit instruction; do not start automatically.
