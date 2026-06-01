---
name: velo-mail-tester
description: Use when verifying Velo Mail changes, selecting targeted Vitest/build/cargo checks, reviewing acceptance criteria, and producing a concise test report before GitVerse push or PR.
---

# Velo Mail Tester

Use this skill to verify Velo Mail implementation work in:

- `/Users/apple/Desktop/Aleksei/office-360/mail/velo`

## Verification flow

1. Read the implementation brief, changed files, and acceptance criteria.
2. Inspect `git diff --stat` and targeted diffs.
3. Run the smallest meaningful tests first.
4. Run broader checks when targeted tests pass.
5. Report command results, failures, and remaining risk.

## Common commands

Frontend and TypeScript:

```bash
npm run test
npm run build
```

Backend:

```bash
cd src-tauri && cargo build
```

EPIC-01 targeted checks:

```bash
npx vitest run src/services/email/gmailProvider.test.ts
npx vitest run src/services/email/imapSmtpProvider.test.ts
npx vitest run src/stores/labelStore.test.ts
npx vitest run src/hooks/useKeyboardShortcuts.test.ts
```

Sync and offline queue:

```bash
npx vitest run src/services/db/pendingOperations.test.ts
npx vitest run src/services/queue/queueProcessor.test.ts
npx vitest run src/services/db/folderSyncState.test.ts
```

Compose and MIME:

```bash
npx vitest run src/utils/emailBuilder.test.ts
```

## Review checklist

- Unsupported provider actions are hidden or disabled before execution.
- Gmail-only code is not accidentally used for IMAP or CalDAV.
- Optimistic UI updates are reverted or reconciled on permanent failure.
- Offline queue behavior is preserved.
- No secrets, raw mail, raw MIME, or credentials are logged.
- UI command surfaces agree: menu, command palette, keyboard shortcut.
- Tests assert behavior, not only implementation details.

## Output

Return:

- Commands run.
- Pass/fail result for each command.
- Bugs found with file paths and concise rationale.
- Untested residual risks.
- A `Handoff` packet for `velo-epic-lead` or `gitverse-cli`.

Do not claim full verification if build, test, or cargo checks were skipped.

## Handoff

End with a packet compatible with `velo-agent-handoff`.

Use:

- `status: ready_for_pr` only when required checks passed or skipped checks are explicitly accepted as residual risk.
- `status: blocked` when tests fail and implementation must return to developer.
- `next_role: gitverse-cli` only if the user already requested push or PR.
- `next_role: velo-epic-lead` when the lead must decide whether to fix, narrow scope, or publish.

The tester must not trigger publication directly. It only reports readiness.
