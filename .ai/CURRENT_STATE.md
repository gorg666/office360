# Current State

> Living snapshot for AI sessions. Update when context grows large. Do not invent facts.

## Last updated

2026-08-11 (~22:00 ICT) — GORGDEV2_PROTECTED_BASELINE freeze (pre-Efim HYBRID)

## Project

**YALINUX360** — workspace; Office 360 tooling root: `velo-office360-api-ya-clean`  
Remote GitHub: `gorg666/office360`

## Active focus

- Branch: **`GORGDEV2`**
- Checkpoint: **GORGDEV2_PROTECTED_BASELINE** (SHA after freeze commit)
- Efim HYBRID integration: **approved but NOT started** — wait for post-freeze go-ahead
- Protected: OAuth 17248/PKCE, service client `9a7396…`, Tracker tauriFetch/429/org hybrid/read-only UX, mail send toast, Lucide icons
- Sidebar mail unread badge: still pending (post-baseline)

## Recently done

- AUTH-005 OAuth listener cancel/release
- Tracker org hybrid + 429 + read-only UX (TRACKER-002)
- Disk/Tracker managed auth wiring
- Mail SendFeedbackToast cleanup, FileTypeIcon / emoji cleanup
- QA docs backlog updates
- Full gates green before freeze (i18n / vitest / tsc / cargo / build)

## Next step

- After push: STOP — no Efim merge until explicit command
- Then HYBRID selective port from this baseline SHA
