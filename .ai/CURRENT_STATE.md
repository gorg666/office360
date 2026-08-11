# Current State

> Living snapshot for AI sessions. Update when context grows large. Do not invent facts.

## Last updated

2026-08-11 (~22:20 ICT) — Efim HYBRID integration checkpoint on `GORGDEV2-EFIM-INTEGRATION`

## Project

**YALINUX360** — workspace; Office 360 tooling root: `velo-office360-api-ya-clean`  
Remote GitHub: `gorg666/office360`

## Active focus

- Branch: **`GORGDEV2-EFIM-INTEGRATION`** (from protected baseline `2aaa905…`)
- Protected baseline: **GORGDEV2_PROTECTED_BASELINE** = `2aaa905b245519e42284da9ddac09027682b6d4e` (do not rewrite)
- Efim pin: `aa39e9a04a01218c584ff85284b4fd977084e747`
- Push / merge back to `GORGDEV2`: **NO** until explicit command

## Hybrid auth (landed)

- **Core/Mail:** keep GORGDEV2 OAuth (PKCE, 17248, refresh/rotation)
- **Work:** maps to service client `9a7396c327984bd6afc75debf275850f` via existing Disk/Tracker auth
- **Communications:** Messenger + Telemost grant (ownership UID/email checks)
- **Admin:** progressive only; no forced consent
- Secrets: no Client Secret in frontend; Efim `build.rs` embed not ported

## Features landed

- Multi-grant unified OAuth (`yandexUnifiedAuth` / `yandexScopes`)
- Yandex Messenger widget + CSP + session isolation from bot tokens
- Telemost prefers communications grant; CEF interstitial detection from Efim
- Yandex360AccountHub grant UX (Почта / Диск и Трекер / Мессенджер и Телемост)
- Sidebar canonical `serviceNavRegistry` + Lucide icons + `NavBadge`
- Mail unread / Outbox / Tasks badges; Messenger badge **NO SOURCE**

## Gates (pre-commit)

- `check:i18n` / `vitest` (1953) / `tsc` / `cargo check` / `build` — green
- Graphify AST update run; semantic LLM optional/off

## Next step

- Manual runtime QA matrix (AUTH / Sidebar / Messenger / Telemost open-only)
- Do not push until approved
