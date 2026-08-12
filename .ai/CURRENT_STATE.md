# Current State

> Living snapshot for AI sessions. Update when context grows large. Do not invent facts.

## Last updated

2026-08-12 — macOS stabilization; MAC-001 fix applied, awaiting manual runtime verification

## Project

**Office360** — macOS stabilization workspace
Remote GitHub: `gorg666/office360`

## Active focus

- Branch: **`macos/office360-stabilization`**
- Baseline: `745cc44d60db4021492aaf6d1383ed96d0536dbe`
- Current batch: **MAC-001 — Telemost macOS browser fallback**
- Commit/push: **NO** until review

## Integration verdict

**MAC-001 FIX APPLIED / AWAITING MANUAL VERIFY**

| Area | Status |
|---|---|
| Mail | PASS |
| Sidebar icons | PASS |
| Mail unread badge | PASS |
| Outbox badge | PASS |
| Tasks badge | PASS |
| Disk | PASS |
| Tracker | PARTIAL (TRACKER-003/004 etc.) |
| Telemost macOS fallback | FIX APPLIED / AWAITING MANUAL VERIFY |
| Account Hub | PASS |
| Messenger | PARTIAL / P1 **MSG-HYBRID-002** |

## Bugs

- MSG-HYBRID-001 — **CLOSED/PASS** (tabs + NEEDS ACCESS CTA)
- HUB-HYBRID-001 — **CLOSED/PASS** (RU «Подключено» / «Требуется доступ»)
- MSG-HYBRID-002 — **OPEN P1** — after communications consent, Yandex Messenger endless loader; widget/iframe content missing
- MAC-001 — **FIX APPLIED / AWAITING MANUAL VERIFY** — macOS uses Tauri opener; Windows embedded CEF preserved

## Next step

- Complete MAC-001 macOS runtime retest and report before commit/push
- Do not investigate Sent/CalDAV, notifications, app menu, or Messenger in this batch
- Telemost Phase 1 committed/pushed as `65b507f`; Phase 2 API integration is applied locally and awaiting runtime grant verification.
- Telemost Phase 2 capability fallback: exact organization restriction maps to account-scoped WEB_ONLY; native join remains available and API mode is preserved for eligible Business accounts.
