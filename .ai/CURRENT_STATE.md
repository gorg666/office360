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
