---
name: velo-epic-lead
description: Use when coordinating Velo Mail delivery work from a strategy epic, a direct user prompt, or an approved plan/discovery result. Creates an implementation brief, branch plan, agent ownership, acceptance criteria, and verification path before implementation.
---

# Velo Epic Lead

Use this skill as the lead workflow for Velo Mail feature delivery.

## Source of requirements

Requirements may come from any of these sources:

1. A delivery epic under `/Users/apple/Desktop/Aleksei/office-360/mail/strategy/delivery/epics`.
2. A direct user prompt that defines the desired behavior.
3. A previously approved plan, discovery result, or implementation brief.

Precedence:

- The newest explicit user prompt overrides older strategy documents.
- An approved plan overrides the original prompt when they conflict.
- Epic and strategy docs are the baseline when the prompt does not narrow or change scope.

## Required intake

Before implementation, produce or confirm a short implementation brief:

- Goal and user-visible outcome.
- In scope and out of scope.
- Acceptance criteria.
- Primary files and subsystems.
- Branch name, normally `feat/epic-XX-short-name` for epic work.
- Test plan.
- Agent ownership if subagents are used.

If the request is unclear, inspect the repository and strategy docs first. Ask only for missing product intent that cannot be inferred from local context.

## Local context

Velo repo:

- `/Users/apple/Desktop/Aleksei/office-360/mail/velo`

Strategy and benchmarks:

- `/Users/apple/Desktop/Aleksei/office-360/mail/strategy`
- `/Users/apple/Desktop/Aleksei/office-360/mail/comm-central`

Read these when relevant:

- `../strategy/delivery/README.md`
- `../strategy/p0-requirements.md`
- `../strategy/gap-priority-matrix.md`
- `../strategy/provider-capabilities-spec.md`
- `../strategy/connection-diagnostics-spec.md`
- `../strategy/offline-sync-health-spec.md`
- `../strategy/compose-mime-fixtures-spec.md`
- `../strategy/security-warning-spec.md`

## Agent coordination

Use subagents only when the user asks for agent teamwork or when the current workflow explicitly calls for it. Split by ownership, not by vague role.

Recommended roles:

- `thunderbird-benchmark-analyst`: read-only benchmark research in `comm-central`.
- `velo-mail-developer`: implementation in Velo code.
- `velo-mail-tester`: verification, regression checks, and test report.
- `gitverse-cli`: final GitVerse context, push, and PR workflow when requested.
- `velo-agent-handoff`: structured packet for passing work between roles.

The user normally gives the task to this lead role only. The lead owns the full sequence and asks the user only for blocking product decisions. Specialist roles return handoff packets to the lead instead of independently driving the user conversation.

Default sequence:

1. Lead creates the implementation brief.
2. Lead calls `thunderbird-benchmark-analyst` when benchmark evidence is useful.
3. Lead passes the brief and any benchmark notes to `velo-mail-developer`.
4. Lead passes developer output to `velo-mail-tester`.
5. Lead uses `gitverse-cli` only when publication was explicitly requested.

Do not assign overlapping write ownership. Any change touching these files requires extra review:

- `src/services/email/types.ts`
- `src/services/emailActions.ts`
- `src/services/db/migrations.ts`
- `src-tauri/src/commands.rs`
- `src/services/imap/tauriCommands.ts`

## Delivery loop

1. Confirm branch and worktree state in `/Users/apple/Desktop/Aleksei/office-360/mail/velo`.
2. Build the implementation brief from epic, prompt, or approved plan.
3. Assign ownership if using agents.
4. Collect benchmark analysis when needed and convert it into acceptance criteria.
5. Implement focused changes.
6. Run targeted tests first, then broader checks.
7. Summarize changed behavior, files, verification, and handoff state.
8. Use `gitverse-cli` only when the user asks to push or create a PR.

## Handoff protocol

Require each specialist result to end with a `Handoff` packet. Use `velo-agent-handoff` for the exact schema.

The lead must stop and ask the user when a packet has:

- `status: blocked`
- unresolved `open_questions` that affect product behavior
- risks involving security, privacy, migrations, data loss, or provider compatibility
- a request to publish without an explicit user gate

The lead may continue automatically when a packet is `ready_for_implementation`, `ready_for_tests`, or `ready_for_pr` and there are no blocking questions or high-risk items.

## EPIC-01 quick anchor

For ProviderCapabilities, start with:

- `src/services/email/types.ts`
- `src/services/email/gmailProvider.ts`
- `src/services/email/imapSmtpProvider.ts`
- `src/services/email/providerFactory.ts`
- `src/stores/labelStore.ts`
- `src/components/layout/Sidebar.tsx`
- `src/components/settings/LabelEditor.tsx`
- `src/components/labels/LabelForm.tsx`
- `src/components/search/CommandPalette.tsx`
- `src/hooks/useKeyboardShortcuts.ts`
- `src/components/ui/ContextMenuPortal.tsx`

Acceptance baseline:

- Gmail label create, rename, delete are exposed only when capability allows them.
- IMAP folder create, rename, delete are hidden or disabled with a clear reason until IMAP commands exist.
- Command palette and shortcuts check capabilities before executing provider actions.
- Tests cover Gmail supported label CRUD and IMAP unsupported folder CRUD.
