---
name: office360-release-pr
description: Finalize an implemented Office360 Mail epic or feature by marking delivery/OpenSpec status complete, rebuilding and refreshing the installed desktop app, writing user test steps, pushing the branch to GitVerse, and creating a PR. Use when the user asks to "отметить выполненное", "обновить десктопный клиент", "развернуть новую desktop версию", "написать как проверить", "запушить", or "создать PR" after implementation.
---

# Office360 Release PR

Use this skill after implementation is complete and the user asks to publish or hand off the work.

## Workflow

1. Confirm scope and repo state.
   - Work from `/Users/apple/Desktop/Aleksei/office-360/mail`.
   - Treat `velo/` as the Git repository for code publication.
   - Check `git -C velo status --short --branch`.
   - If OpenSpec is involved, run `openspec status --change <change> --json`.

2. Mark delivery status complete.
   - Update the relevant `strategy/delivery/epics/*.md` status to `выполнен`.
   - Add implementation notes and verification commands.
   - Mark all tasks in `openspec/changes/<change>/tasks.md` as complete.
   - Run OpenSpec status again and confirm `isComplete: true`.

3. Verify before publication.
   - Run focused tests for touched files first.
   - Run `cd velo && npm run test`.
   - Run `cd velo && npm run build`.
   - Run `cd velo && npm run tauri build`.
   - Record warnings separately from failures.

4. Refresh installed desktop app on macOS.
   - Fresh artifact: `velo/src-tauri/target/release/bundle/macos/Office360.app`.
   - Stop the installed app before replacement.
   - Replace `/Applications/Office360.app` with the fresh bundle using `ditto --rsrc --extattr`.
   - Verify `/Applications/Office360.app/Contents/MacOS/office360` timestamp.
   - Verify signing with `codesign -vvv --strict /Applications/Office360.app`.
   - If local `.app` signing is invalid after replacement, run `codesign --force --deep --sign - /Applications/Office360.app` and repeat strict validation.
   - Run installed desktop smoke. Use `npm run smoke:desktop` for generic visibility and a feature-specific `--scenario` for UI changes, for example `npm run smoke:desktop -- --restart --scenario add-account-exchange --screenshot artifacts/desktop-smoke/add-account-exchange.png`.
   - If replacement requires approval, request escalation rather than skipping it.

5. Write user test steps.
   - Include exact app path and feature workflow.
   - Include at least one positive check and one regression check.
   - For search/smart-folder work, include:
     - search `labelid:<id>` and `folderpath:"<path>"`;
     - unsupported token such as `priority:high` remains text search;
     - Help lists all supported operators;
     - smart folders with missing references stay visible with warning state.

6. Push and create GitVerse PR only after verification.
   - Use `gvc meta context --json-compact` to confirm auth/repo.
   - Use `git -C velo push -u origin <branch>`.
   - Create the PR with `gvc pr create -R mega_team/velo --head <branch> --base main --title <title> --body <body> --json-compact`.
   - Include verification commands and desktop refresh evidence in the PR body.
   - Do not include secrets or raw tokens.

## Final Report

Report:

- What was marked complete.
- Installed app source and destination paths.
- How the user can test the updated desktop client.
- Commands run and pass/fail results.
- Feature-specific desktop smoke scenario and screenshot path for UI changes.
- Branch, commit, and PR URL.
- Any residual risk or skipped smoke check.
