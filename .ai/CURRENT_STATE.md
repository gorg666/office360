# Current State

> Living snapshot for AI sessions. Update when context grows large. Do not invent facts.

## Last updated

2026-08-11 — GORGDEV snapshot (OAuth + send pipeline); B2 manual retest still required

## Project

**velo-office360-api-ya-clean** — Office360 (Tauri). Remote: `gorg666/office360`.

## Active focus

- Send UX / Outbox / Sent reconciliation — **MAIL-008/009/010 fix applied, awaiting manual retest**
- Do **not** mark B2 Send as PASS until Tauri retest
- Do **not** advance to A3 / Calendar until B2 PASS

## Recently done (code)

- Yandex OAuth: callback, login_hint, embedded window, token refresh lifecycle
- SMTP/send error handling + compose send orchestrator state machine
- Outbox dedupe + open-on-click; local Sent placeholder after SMTP
- Recipient suggestions; RU Cc/Bcc
- Graphify-first workflow in `office360-project` skill + `30-graphify-first.mdc`

## QA truth

**Confirmed PASS:** MAIL-001 callback; MAIL-002 login_hint; embedded OAuth initial flow

**FIX APPLIED / AWAITING MANUAL RETEST:** AUTH-001, MAIL-003, MAIL-008, MAIL-009, MAIL-010, B2 Send/Outbox/Sent

## Next step

Manual retest B2 (one send → one Outbox → open → recipient → Sent → Outbox gone → final toast).
