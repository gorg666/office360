# Current State

> Living snapshot for AI sessions. Update when context grows large. Do not invent facts.

## Last updated

2026-08-11 (~08:00) — MAIL-016/017 + NOTIF-001 FIX APPLIED / AWAITING MANUAL VERIFY

## Project

**velo-office360-api-ya-clean** — Office360 (Tauri). Remote: `gorg666/office360`. Branch: `GORGDEV`.

## Active focus

- Office 360 **Mail + Windows notifications**: MAIL-011…017, UI-002/003, NOTIF-001 code applied
- **Do not** mark PASS without manual retest
- **Do not** implement IMAP IDLE / change polling intervals until separate decision
- Do **not** advance QA to Calendar / Messenger / A3

## Recently done (code)

- Yandex OAuth + SMTP/send pipeline (prior GORGDEV)
- MAIL-011…015 + UI-002/003 (Outbox reconcile, ПКМ, titles, unread, folder tree, sync measure)
- MAIL-016: Outbox ПКМ via shared context-menu + `outboxContextMenuActions`
- MAIL-017: raster image thumbnails in message `AttachmentList` + preview cache
- NOTIF-001: native WinRT toast + AUMID registry (`com.office360.desktop`); bypass plugin PowerShell path in `target/debug|release`

## QA truth

**Confirmed PASS:** MAIL-001; MAIL-002

**FIX APPLIED / AWAITING MANUAL VERIFY:** AUTH-001, MAIL-003, MAIL-008…017, UI-002/003, NOTIF-001 (and earlier send/Outbox bugs still pending retest)

## Next step

Manual retest TEST A–D (Outbox ПКМ, Failed Outbox, attachment preview, Windows toast = Office360). No Calendar/Messenger/A3.
