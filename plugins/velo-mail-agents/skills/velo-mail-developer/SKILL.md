---
name: velo-mail-developer
description: Use when implementing production Velo Mail changes in the Tauri React TypeScript frontend or Rust backend, especially provider capabilities, account diagnostics, sync/offline queue, compose/MIME, search, contacts, calendar, and security epics.
---

# Velo Mail Developer

Use this skill for production code changes in:

- `/Users/apple/Desktop/Aleksei/office-360/mail/velo`

Follow `AGENTS.md` in the Velo repo. Keep changes focused and aligned with existing patterns.

## Project map

Frontend:

- `src/components/`
- `src/hooks/`
- `src/stores/`
- `src/services/`
- `src/utils/`

Backend:

- `src-tauri/src/`

Core mail areas:

- Provider contract: `src/services/email/types.ts`
- Gmail adapter: `src/services/email/gmailProvider.ts`
- IMAP/SMTP adapter: `src/services/email/imapSmtpProvider.ts`
- Provider factory: `src/services/email/providerFactory.ts`
- Email actions and offline dispatch: `src/services/emailActions.ts`
- DB services: `src/services/db/`
- IMAP frontend commands: `src/services/imap/tauriCommands.ts`
- Rust commands: `src-tauri/src/commands.rs`

Command surfaces:

- `src/hooks/useKeyboardShortcuts.ts`
- `src/components/search/CommandPalette.tsx`
- `src/components/ui/ContextMenuPortal.tsx`

## Implementation rules

- Read the relevant strategy docs or implementation brief before coding.
- If the task comes from `velo-epic-lead`, treat the lead brief and latest handoff packet as the source of truth.
- Prefer existing services, stores, hooks, UI primitives, and test patterns.
- Use strict TypeScript and `@/` imports from `src`.
- Do not bypass provider abstractions with Gmail-only calls unless the requirement is explicitly Gmail-only.
- Preserve local-first mail behavior, sanitized HTML rendering, encrypted credential storage, and remote image blocking.
- Do not log tokens, passwords, raw message bodies, raw MIME, OAuth secrets, or local database contents.
- If multiple agents are working, do not revert or overwrite changes outside your assigned ownership.
- Return questions and risks to `velo-epic-lead`; do not broaden scope independently.

## EPIC-01 ProviderCapabilities

Expected implementation direction:

- Add `ProviderCapabilities` to `src/services/email/types.ts`.
- Expose capabilities from `GmailApiProvider` and `ImapSmtpProvider`.
- Add helper functions when UI needs common capability decisions.
- Move Gmail label CRUD surfaces through provider-aware checks.
- Ensure IMAP unsupported folder or label operations are hidden or disabled before provider execution.
- Gate command palette and keyboard shortcuts before executing provider actions.

High-risk files:

- `src/services/email/types.ts`
- `src/services/emailActions.ts`
- `src/stores/labelStore.ts`
- `src/components/search/CommandPalette.tsx`
- `src/hooks/useKeyboardShortcuts.ts`
- `src/components/ui/ContextMenuPortal.tsx`

## Verification during development

Run targeted tests first:

```bash
npx vitest run src/services/email/gmailProvider.test.ts
npx vitest run src/services/email/imapSmtpProvider.test.ts
npx vitest run src/stores/labelStore.test.ts
npx vitest run src/hooks/useKeyboardShortcuts.test.ts
```

Then run broader checks as scope requires:

```bash
npm run test
npm run build
```

For Rust or Tauri backend changes:

```bash
cd src-tauri && cargo build
```

## Handoff

End with a packet compatible with `velo-agent-handoff`.

Use:

- `status: ready_for_tests` when implementation is complete and ready for verification.
- `status: blocked` when missing product decisions or external state prevents completion.
- `next_role: velo-mail-tester` when tests should run.
- `next_role: velo-epic-lead` when coordination, scope, or ownership decisions are needed.

Include actual changed files, commands run, known skipped checks, and a tester-ready prompt.
