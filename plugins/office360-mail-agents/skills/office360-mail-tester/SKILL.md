---
name: office360-mail-tester
description: "Use when verifying Office360 Mail changes with targeted tests, builds, browser smoke tests, installed Tauri desktop smoke, screenshots, acceptance review, and concise release-readiness reporting."
---

# Office360 Mail Tester

Use this skill to verify Office360 Mail implementation work in:

- `/Users/apple/Desktop/Aleksei/office-360/mail/velo`

## Verification flow

1. Read the brief, handoff, changed files, wiki updates, and acceptance criteria.
2. Inspect `git diff --stat` and targeted diffs for risk.
3. Run focused tests first; expand to build/cargo checks based on touched surfaces.
4. Run Web smoke and Desktop smoke when UI behavior changed.
5. Report pass/fail, evidence, untested risk, and next role.

## Command checks

Frontend and TypeScript:

```bash
npm run test
npm run build
```

Targeted examples:

```bash
npx vitest run src/services/email/providerCapabilities.test.ts
npx vitest run src/services/email/gmailProvider.test.ts
npx vitest run src/services/email/imapSmtpProvider.test.ts
npx vitest run src/stores/labelStore.test.ts
npx vitest run src/hooks/useKeyboardShortcuts.test.ts
```

Backend:

```bash
cd src-tauri && cargo build
```

Prefer the smallest meaningful set first, then broader checks when targeted checks pass.

## Web smoke

Required when frontend UI behavior changed.

- Start the app with the repo's normal Vite/preview flow or use an already running local server.
- Open the product in a browser and exercise the changed workflow.
- Capture screenshots or equivalent UI evidence when possible.
- Check visible regressions: blank screens, layout overlap, stale labels, disabled-but-visible unsupported actions, console errors, and broken navigation.

Provider smoke should cover the relevant account types:

- Yandex and IMAP/POP3 target flows.
- Gmail-only labels, categories, and commands must be hidden by default outside Gmail-scoped behavior.
- Sidebar, settings, command palette, keyboard shortcuts, and context menus must agree.

## Desktop smoke

Required when Tauri, packaging, installed app behavior, native commands, or visible desktop UI changed.

- Build/run or replace the installed app using the repo's normal workflow when available.
- Smoke the same user-facing workflow in the desktop shell.
- Check account switching, sidebar/settings/context menus, native window behavior, logs, and obvious rendering regressions.
- If desktop smoke cannot run locally, state why and keep it as residual risk. Do not call the branch fully verified.

## Review checklist

- Acceptance criteria are verified against behavior, not only implementation details.
- Unsupported provider actions are hidden or blocked before provider execution.
- No Gmail-only behavior leaks into IMAP/POP3 or Yandex defaults.
- Security-sensitive surfaces preserve sanitized HTML, remote image blocking, encrypted credentials, safe URL handling, and no secret/raw-mail logging.
- Wiki updates exist for changed product/system behavior.
- Tests and smoke cover the user issue that motivated the change.

## Output

Return:

- Commands run and pass/fail result.
- Web smoke status with URL/tool/evidence or explicit not-run reason.
- Desktop smoke status with app/build path/evidence or explicit not-run reason.
- Bugs found with file paths and concise rationale.
- Untested residual risks.
- A `Handoff` packet for `office360-epic-lead` or `office360-gitverse-cli`.

Do not claim full verification if required tests, build, Web smoke, or Desktop smoke were skipped without an explicit residual-risk note.

## Handoff

End with a packet compatible with `office360-agent-handoff`.

Use:

- `status: ready_for_pr` only when required checks and smoke passed or skipped checks are explicitly accepted as residual risk.
- `status: blocked` when verification fails and implementation must return to developer.
- `next_role: office360-gitverse-cli` only if the user already requested push or PR.
- `next_role: office360-epic-lead` when the lead must decide whether to fix, narrow scope, or publish.

The tester must not trigger publication directly. It only reports readiness.
