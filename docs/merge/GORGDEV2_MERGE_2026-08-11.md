# GORGDEV2 merge — 2026-08-11

## Base

| Ref | SHA |
|---|---|
| `origin/main` (PR #2 merge) | `88ee55d6e3234f9de527e6a2ddc6664fd46e1c21` |
| PR #2 head | `ff743135a58a5f4585b51e0de2d61c73ab7e7f59` |
| `origin/GORGDEV` | `f26a3da221d23990e6310cb3473f327aa427ca50` |
| merge-base | `938bd47255433840535ba9b0fcbd71caf5edbd75` |

Ahead/behind `main...GORGDEV` at merge time: **343 / 1** (GORGDEV tip = i18n-only commit after shared mail base).

## Graphify

- `graphify-out/graph.json` **not present** in workspace → Graphify MCP returned no nodes.
- Fallback: git both-changed intersection + known hotspots from prior sessions.

## Semantic overlap (both changed since merge-base)

| Area | File |
|---|---|
| Build | `package.json` |
| i18n | `src/i18n.ts` |
| Mail | `src/components/email/ThreadView.tsx` |
| Mail | `src/components/outbox/OutboxList.tsx` |

GORGDEV-only (16): i18n tooling, `Composer.tsx`, `AskInbox`, `ContextMenuPortal`, `notificationManager`, `pluralRu`, `userFacingError`, date/networkErrors, QA docs.

## Conflicts

### FILE: `package.json`

| | |
|---|---|
| MAIN/EFIM | `"smoke:desktop": "node scripts/desktop-smoke.mjs"` |
| GORGDEV | `"check:i18n": "node scripts/i18n-audit.mjs --fail"` |
| FINAL | **both scripts kept** |
| REASON | Need i18n gate + keep Efim desktop smoke script |

### Auto-merged (no markers)

| FILE | MAIN/EFIM | GORGDEV | FINAL | REASON |
|---|---|---|---|---|
| `src/i18n.ts` | smaller / older dict on main line | full RU (~838 keys) | working tree **838 keys** (= GORGDEV) | Preserve f26a3da localization |
| `ThreadView.tsx` | Telemost/mail folder work on main | `ru-RU` dates | auto-merge; `ru-RU` present | Combine UI + locale |
| `OutboxList.tsx` | main outbox fixes | `ru-RU` | auto-merge; `ru-RU` present | Keep RU locale |

## Protected behaviors retained from GORGDEV

- OAuth/send/outbox/notifications commits already in ancestry via merge-base `938bd47` + main's later Efim mail fixes
- Full RU i18n pass (`f26a3da`) + `check:i18n` scripts
- Native notification path changes from GORGDEV commit

## Efim / main retained

- PR #2 Telemost CEF profile isolation (`ff74313` → merge `88ee55d`)
- Contacts, Calendar, Disk, CEF bootstrap (`scripts/bootstrap-cef.ps1`, `build-cef-host.ps1`)
- Yandex services routes

## CEF notes (main)

- Runtime: `src-tauri/cef-runtime/**/*` (gitignored); build via `scripts/bootstrap-cef.ps1` + `scripts/build-cef-host.ps1`
- `smoke:desktop` still targets macOS `/Applications/Office360.app` — not a Windows gate
