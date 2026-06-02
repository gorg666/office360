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
4. Run Web smoke when browser-only evidence is useful.
5. Rebuild and refresh the installed desktop app for the current OS.
6. Run Desktop smoke against the refreshed installed app.
7. Report pass/fail, evidence, untested risk, and next role.

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

## Installed App Refresh

Required after tests/build for any change that can affect the user-facing desktop app, Tauri runtime, frontend bundle, provider behavior, local database, settings, or packaging. Do not treat a Vite-only smoke test as enough for Office360 Mail release readiness.

Default sequence:

1. Run the selected tests.
2. Run `npm run build`.
3. Run `npm run tauri build`.
4. If `npm run tauri build` produces the OS app bundle but fails only on secondary packaging such as DMG creation, report that packaging failure separately and continue installed-app refresh from the produced app bundle.
5. Stop the currently installed app before replacement.
6. Replace or install the freshly built desktop artifact for the current OS.
7. Verify the installed app path, executable timestamp, and source artifact path.
8. Run desktop smoke against the installed app, not only the dev server.

OS-specific refresh guidance:

| OS | Fresh artifact | Installed app refresh |
| --- | --- | --- |
| macOS | `src-tauri/target/release/bundle/macos/Office360.app` | Quit `Office360`, replace `/Applications/Office360.app` with the fresh `.app` bundle using a metadata-preserving copy such as `ditto --rsrc --extattr`, then verify `/Applications/Office360.app/Contents/MacOS/office360`. |
| Windows | `src-tauri/target/release/bundle/msi/*.msi` or `src-tauri/target/release/bundle/nsis/*.exe` | Stop `Office360.exe`, run the fresh installer silently when supported, otherwise document the manual installer step. Verify the installed executable under `%LOCALAPPDATA%\Programs\Office360\` or `%ProgramFiles%\Office360\` according to the installer target. |
| Linux | `src-tauri/target/release/bundle/appimage/*.AppImage`, `src-tauri/target/release/bundle/deb/*.deb`, or `src-tauri/target/release/bundle/rpm/*.rpm` | Prefer the native package for the distro (`apt install ./...deb`, `dnf install ./...rpm`, or equivalent). For AppImage-only builds, replace the local executable copy used for smoke tests and mark it executable. Verify the installed command or AppImage path. |

If the current OS does not support installing the produced artifact in the local environment, state the exact blocker and keep Desktop smoke as residual risk. Do not report `status: ready_for_pr` unless this residual risk is explicit and acceptable for the requested publication.

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

Required after installed app refresh, and whenever Tauri, packaging, installed app behavior, native commands, provider behavior, local database behavior, settings, or visible desktop UI changed.

- Build and replace the installed app using the OS-specific Installed App Refresh workflow above.
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
- Installed app refresh status with OS, source artifact, installed path, timestamp/version evidence, and any packaging-only failures.
- Desktop smoke status with installed app path/evidence or explicit not-run reason.
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
