---
name: office360-project
description: Project memory for Office 360 (Velo) — architecture, mail interaction model, conventions, security, and Definition of Done. Use for any Office 360 feature, bugfix, or review in this repository.
---

# Office 360 — project skill

**Canonical root for this tooling setup:**  
`C:\Users\gosha\OneDrive\Документы\CR\YALINUX360\velo-office360-api-ya-clean`

Other sibling clones under `YALINUX360` (`velo`, `velo-office360-i18n`, baselines) may exist — do not confuse them; prefer this root when GitHub `gorg666/office360` + mail workflow are in scope.

## Project overview

Office 360 (npm name `office360`, product UI **Офис360**, upstream docs often say **Velo**) is a **keyboard-first, local-first desktop email client**.

| Layer | Stack |
|-------|--------|
| Shell | Tauri v2 + Rust |
| UI | React 19, TypeScript, Zustand 5, Tailwind CSS v4 |
| Editor | TipTap v3 |
| Data | SQLite via tauri-plugin-sql, FTS5 |
| Mail | Gmail API and IMAP/SMTP providers |
| Extra | Calendar, contacts, attachments, AI assists, Yandex 360 admin surfaces |

### Main directories

- `src/components/` — UI (email, composer, layout, calendar, settings, …)
- `src/services/` — business logic (email, db, gmail, imap, ai, calendar, …)
- `src/stores/` — Zustand stores
- `src-tauri/` — Rust/Tauri
- `docs/` — architecture, development, QA
- `.agents/skills/`, `.claude/skills/` — agent skills

## Graphify-first (mandatory for non-trivial existing-code work)

**Canonical rule:** Office360 uses Graphify (`graphify-out/`, MCP `user-graphify`) as the primary code-navigation index. For non-trivial existing-code tasks, query Graphify first, then read only the minimal source required. After architecture-significant changes, incrementally refresh the affected graph.

### Order

```
TASK
→ Graphify query (MCP / graphify query)
→ minimal relevant subgraph
→ pick concrete files/symbols
→ read only those ranges
→ edit
→ tests
→ incremental Graphify update for touched area
```

Principle: `graph → symbol → relevant lines` — **not** `directory → files → full contents`.

### Do first (bugs / features in existing code)

Find the chain via graph relationships **before** mass source reads. Example Mail Send:

`Composer → composeSendOrchestrator → pendingOperations → sendStatusStore → SMTP → IMAP Sent → sync events → OutboxList`

Query by: bug area, UI component, store, event, Tauri command, Rust handler, service, DB op, tests.

### Token economy — do not without need

- Whole large directories / full repo scans / full graph dumps
- Re-reading already studied files
- generated / build / vendor / lockfiles
- Re-deriving architecture already in this skill or `.ai/CURRENT_STATE.md`
- Huge command/log dumps (prefer filter / tail / top matches; stop after 5–10 enough hits)

### Source of truth

Graphify is an **index**, not truth. Before editing a symbol, read current source. If graph ≠ source → **source wins**; mark stale and refresh graph.

### After changes

Incremental update preferred (`graphify … --update` or equivalent for touched paths). Full rebuild only when needed (new module boundaries, large moves, known stale index).

Refresh when architecture-significant: relationships, imports, events, Tauri commands, service boundaries, stores, API/DB access, tests, add/remove files/symbols.

### Tooling discipline

| Tool | Use when |
|------|----------|
| Graphify | Code navigation / blast radius / callers in this repo |
| `.ai/CURRENT_STATE.md` + this skill + `office360-testing` | Session facts & DoD — do not re-invent |
| GitHub MCP | Remote-only: history, PR, issue, branch compare — **not** local files |
| Context7 | External libs/APIs only — **not** Office360 source |
| Chrome / Playwright | After implementation + type/build checks — **not** for pure navigation |

### Reporting

In `APOSTLE_CHECK`:

```
Graphify: READ | UPDATED | NOT NEEDED | BLOCKED
```

- `READ` — queried existing `graphify-out/graph.json` (or MCP with this package `project_path`)
- `UPDATED` — ran incremental `graphify update` after architecture-significant edits
- `NOT NEEDED` — one-line reason (docs-only / trivial typo)
- `BLOCKED` — expected graph artifact missing/unusable; do **not** pretend READ; restore AST index (`graphify update .`) before navigation-heavy work

MCP: always pass `project_path` to this Office360 package root. Launcher default may point at another project’s graph.

Architectural task final report (compact):

```
GRAPHIFY:
- queried: YES/NO
- affected subgraph: …
- updated: YES/NO
- stale findings: NONE | …
```

## Architecture (confirmed)

Three layers (see `docs/architecture.md`):

1. **UI** — React + Zustand (ephemeral UI state; rebuild from SQLite).
2. **Services** — EmailProvider abstraction (`src/services/email/`), sync, drafts, search, filters.
3. **Native** — Tauri commands, OAuth, SQLite, notifications.

Providers:

- `GmailApiProvider` (`gmail_api`)
- `ImapSmtpProvider` (`imap`)
- Factory: `getEmailProvider(accountId)` in `providerFactory.ts`

`EmailProvider` capabilities include folders/sync, archive/trash/star/labels, `sendMessage`, `createDraft` / `updateDraft` / `deleteDraft`, attachments, connection test.

## Mail interaction model (from code)

| Capability | Status | Primary locations |
|------------|--------|-------------------|
| Reply | Implemented | `InlineReply`, `Composer`, context menu, shortcuts |
| Reply All | Implemented | mode `"replyAll"` throughout |
| Forward | Implemented | mode `"forward"` |
| Inline Reply | Implemented | `src/components/email/InlineReply.tsx` |
| Full Composer | Implemented | `src/components/composer/Composer.tsx`, `ComposerWindow.tsx` |
| Send | Implemented | Composer + InlineReply send paths |
| Undo Send | Implemented | `undo_send_delay_seconds` setting, `UndoSendToast`, composerStore timers |
| Send and Archive | Implemented | `useUIStore.sendAndArchive` after successful send |
| Draft / auto-save | Implemented | `src/services/composer/draftAutoSave` + draft provider APIs |
| Error handling | Partial/present | send catch paths keep UI usable; verify draft retention per change |

Do **not** invent missing reply modes — check `mode: "reply" \| "replyAll" \| "forward"` in stores/components.

## Coding conventions (observed)

- TypeScript + React function components; colocated `*.test.ts(x)` with Vitest.
- Zustand stores in `src/stores/*Store.ts` with `setState` reset in tests.
- Services own side effects; components call services/stores, not raw SQL.
- Prefer existing patterns in `InlineReply` / `Composer` for mail UX changes.
- i18n strings appear in `src/i18n.ts` (RU mappings for many EN labels).
- Keyboard shortcuts: `src/hooks/useKeyboardShortcuts.ts`, `docs/keyboard-shortcuts.md`.

## Testing rules

Order for meaningful UI/mail changes:

1. Implement  
2. `npx tsc --noEmit` (and targeted Vitest)  
3. `npm run test` for affected area (or full when core mail paths change)  
4. Code review skill  
5. Runtime: Tauri preferred (`npm run tauri dev`) + Chrome DevTools MCP  
6. Playwright MCP / `webapp-testing` regression for mail flows  

Vite-only preview is **not** a full substitute for Tauri (expect `invoke` errors).

## Definition of Done (UI)

Not done if only `npm run build` / `tsc` succeeded.

For interactive features, require:

- Targeted unit tests where logic changed  
- Runtime verification in browser/Tauri  
- No new unexplained console errors in the exercised path  
- No secrets committed  

## Security

- Never read/commit `.env*`, OAuth client secrets, refresh tokens, passwords.
- Email HTML: DOMPurify + sandboxed iframes; remote images blocked by default.
- Phishing heuristics / auth badges exist — do not weaken without review.
- Attachments and filesystem: use Tauri plugins; no broad FS MCP to `C:\`.
- Do not send real mail to external recipients in automated tests unless user requests.

## Known technical debt / notes (non-invented)

- Multiple workspace clones of the same app exist under `YALINUX360` — tooling docs target `velo-office360-api-ya-clean`.
- Active mail branch observed: `office360-mail-workflow`.
- Remotes: GitHub `origin` → `https://github.com/gorg666/office360.git`, GitVerse `gitverse` → `mega_team/velo`.
- Dirty tree may include prior Cursor rule/skill edits and `src-tauri/Cargo.toml` line-ending noise — avoid unrelated reformats.

## References

- `docs/architecture.md`
- `docs/development.md`
- `README.md`
- `docs/ai-tooling/` (MCP/skills setup)
