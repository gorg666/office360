---
name: office360-epic-lead
description: Use when coordinating Office360 Mail delivery work from a strategy epic, direct user prompt, approved plan, or prior handoff. Creates an implementation brief, ownership plan, acceptance criteria, security/wiki expectations, and Web/Desktop verification path before implementation.
---

# Office360 Epic Lead

Use this skill as the lead workflow for Office360 Mail feature delivery.

## Source of requirements

Requirements may come from:

1. A delivery epic under `/Users/apple/Desktop/Aleksei/office-360/mail/strategy/delivery/epics`.
2. A direct user prompt that defines desired behavior.
3. A previously approved plan, discovery result, or handoff.
4. Current system/product notes under `/Users/apple/Desktop/Aleksei/office-360/mail/velo/wiki`.

Precedence:

- The newest explicit user prompt overrides older strategy documents.
- An approved plan overrides the original prompt when they conflict.
- Wiki captures current product/system decisions after implementation.
- Epic and strategy docs are the baseline when the prompt does not narrow or change scope.

## Required intake

Before implementation, produce or confirm a short implementation brief:

- Goal and user-visible outcome.
- In scope and out of scope.
- Acceptance criteria.
- Primary files and subsystems.
- Branch name, normally `feat/epic-XX-short-name` for epic work.
- Security/privacy concerns.
- Wiki pages to update.
- Required current docs to check for fast-moving dependencies or APIs.
- Test plan with targeted checks, Web smoke, and Desktop smoke.
- Agent ownership if subagents are used.

If the request is unclear, inspect the repository, wiki, and strategy docs first. Ask only for missing product intent that cannot be inferred from local context.

## Local context

Office360 Mail repo:

- `/Users/apple/Desktop/Aleksei/office-360/mail/velo`

Strategy and benchmarks:

- `/Users/apple/Desktop/Aleksei/office-360/mail/strategy`
- `/Users/apple/Desktop/Aleksei/office-360/mail/comm-central`

Read these when relevant:

- `wiki/`
- `AGENTS.md`
- `../strategy/delivery/README.md`
- `../strategy/p0-requirements.md`
- `../strategy/gap-priority-matrix.md`
- `../strategy/provider-capabilities-spec.md`
- `../strategy/connection-diagnostics-spec.md`
- `../strategy/offline-sync-health-spec.md`
- `../strategy/compose-mime-fixtures-spec.md`
- `../strategy/security-warning-spec.md`

## Agent coordination

Use subagents only when the user asks for agent teamwork or when the workflow benefits from specialist ownership.

Recommended roles:

- `office360-thunderbird-benchmark-analyst`: read-only benchmark research in `comm-central`.
- `office360-mail-developer`: senior implementation in Office360 code.
- `office360-mail-tester`: verification, browser smoke, desktop smoke, and test report.
- `office360-gitverse-cli`: final GitVerse context, push, and PR workflow when requested.
- `office360-agent-handoff`: structured packet for passing work between roles.

Default sequence:

1. Lead creates the implementation brief.
2. Lead calls `office360-thunderbird-benchmark-analyst` when benchmark evidence is useful.
3. Lead passes the brief and benchmark notes to `office360-mail-developer`.
4. Lead passes developer output to `office360-mail-tester`.
5. Lead uses `office360-gitverse-cli` only when publication was explicitly requested.

Do not assign overlapping write ownership. Any change touching these areas requires extra review:

- Provider contracts and adapters.
- Local DB services and migrations.
- Tauri/Rust commands.
- Credential, OAuth, HTML rendering, remote image, and URL-opening surfaces.
- Packaging, license, release metadata, and installed-app workflows.

## Delivery loop

1. Confirm branch and worktree state in `/Users/apple/Desktop/Aleksei/office-360/mail/velo`.
2. Build the implementation brief from prompt, epic, wiki, or approved plan.
3. Assign ownership if using agents.
4. Collect benchmark or current-doc analysis when needed and convert it into acceptance criteria.
5. Implement focused changes.
6. Run targeted tests first, then broader checks.
7. Run Web and Desktop smoke when UI or installed-app behavior changed.
8. Summarize changed behavior, files, wiki updates, verification, and handoff state.
9. Use `office360-gitverse-cli` only when the user asks to push or create a PR.

## Handoff protocol

Require each specialist result to end with a `Handoff` packet. Use `office360-agent-handoff` for the exact schema.

The lead must stop and ask the user when a packet has:

- `status: blocked`
- unresolved `open_questions` that affect product behavior
- risks involving security, privacy, migrations, data loss, licensing, or provider compatibility
- missing required Web/Desktop smoke without an accepted risk
- a request to publish without an explicit user gate

The lead may continue automatically when a packet is `ready_for_implementation`, `ready_for_tests`, or `ready_for_pr` and there are no blocking questions or high-risk items.

## Provider capabilities anchor

For provider capability work, verify:

- IMAP/POP3 and Yandex are target provider defaults.
- Gmail labels, categories, and special actions are Gmail-scoped.
- Unsupported provider actions are hidden or blocked across sidebar, settings, context menus, command palette, and shortcuts.
- Tests cover provider-supported and provider-unsupported behavior.
- Web/Desktop smoke covers the account/provider that previously exposed the issue.
