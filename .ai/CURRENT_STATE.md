# Current State

> Living snapshot for AI sessions. Update when context grows large. Do not invent facts.

## Last updated

2026-08-11 (~08:20) — Full RU localization static pass; runtime NOT verified

## Project

**YALINUX360** — workspace; Office 360 tooling root: `velo-office360-api-ya-clean`  
Remote GitHub: `gorg666/office360`

## Active focus

- Office 360 **Russian localization** (system UI via `src/i18n.ts` + TranslationLayer)
- Mail + notifications defects (MAIL-016/017, NOTIF-001) still **AWAITING MANUAL VERIFY**
- **Do not** mark localization or mail PASS without runtime/manual retest
- **Do not** implement IMAP IDLE / change polling until separate decision
- Do **not** advance QA to Calendar / Messenger / A3 as primary track (calendar strings covered in i18n dict only)

## Recently done

- MAIL-011…017 + UI-002/003 + NOTIF-001 (prior)
- Localization: merge keys → dict **835**; `check:i18n` **0** missing; `pluralRu`; `toUserFacingError`; dates `ru-RU`; notification RU; audit `docs/qa/LOCALIZATION_AUDIT_2026-08-11.md`
- Graphify queried (i18n subgraph); graphify-out **not** updated

## Open questions / blockers

- Runtime Latin DOM / Tauri walk for localization (required for PASS)
- Manual retest TEST A–D (Outbox ПКМ, Failed Outbox, attachment preview, Windows toast)
- Unrelated dirty tree (`.claude`, bak, mcp, graphify-out) — exclude from commits

## Next step

- Runtime localization QA (Mail→Settings + native notifications) then update AFTER metrics
- Manual retest Mail + NOTIF
- No commit/push unless user asks
