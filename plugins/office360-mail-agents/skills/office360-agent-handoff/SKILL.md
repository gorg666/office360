---
name: office360-agent-handoff
description: Use when Office360 Mail work needs a structured handoff between lead, analyst, developer, tester, and GitVerse publisher roles without losing scope, ownership, verification, security review, wiki updates, smoke status, or unresolved questions.
---

# Office360 Agent Handoff

Use this skill to pass Office360 Mail work between specialist roles. The handoff is a text contract that the orchestrator can paste into the next role prompt or use directly as implementation context.

## Control model

- `office360-epic-lead` is the orchestrator and single user-facing owner of the flow.
- Specialist roles return handoff packets to the orchestrator; they do not ask the user low-level questions directly unless delegated.
- The orchestrator decides whether to continue, ask the user, narrow scope, or stop.
- `office360-gitverse-cli` may push or create a PR only when the user explicitly requested publication.

## Standard packet

Every specialist role should end with this block:

```text
Handoff:
status: ready | blocked | needs_review | ready_for_implementation | ready_for_tests | ready_for_pr
next_role: office360-thunderbird-benchmark-analyst | office360-mail-developer | office360-mail-tester | office360-gitverse-cli | office360-epic-lead | user
summary: <1-3 sentences>
changed_files: <paths or none>
commands_run: <commands or none>
wiki_updates: <paths updated, not needed, or needed but not done>
current_docs_checked: <sources checked, not needed, or needed but not done>
security_review: <passed, concerns listed, not applicable, or not done>
smoke_status: <web passed/skipped/failed; desktop passed/skipped/failed; evidence or reason>
open_questions: <items or none>
risks: <items or none>
handoff_prompt: <ready-to-send prompt for the next role>
```

## Status meanings

- `ready`: Work is complete and no immediate next role is required.
- `blocked`: Work cannot continue without user input or external state.
- `needs_review`: Human or lead review is needed before implementation continues.
- `ready_for_implementation`: Analysis or planning is ready for developer work.
- `ready_for_tests`: Implementation is ready for verification.
- `ready_for_pr`: Tester verified the branch and publication can be considered.

## Required safeguards

- Do not mark `ready_for_pr` if required tests or smoke checks failed or were skipped without an explicit risk note.
- Do not route to `office360-gitverse-cli` if `open_questions` contains unresolved product scope.
- Do not hide security, privacy, data-loss, migration, licensing, or credential risks in summary text; list them under `risks`.
- If code changed, `changed_files` must list actual paths or state that the work happened in a forked agent workspace.
- If no commands ran, write `none` under `commands_run`.
- If no wiki update is needed, write `not needed`; do not omit `wiki_updates`.

## Typical chain

1. `office360-epic-lead`: intake, branch, brief, ownership.
2. `office360-thunderbird-benchmark-analyst`: optional benchmark notes and scenarios.
3. `office360-mail-developer`: implementation and local targeted checks.
4. `office360-mail-tester`: tests, Web smoke, Desktop smoke, and readiness report.
5. `office360-gitverse-cli`: push and PR only after explicit publication gate.

## Handoff prompts

Keep `handoff_prompt` direct and executable. Include:

- Role to use.
- Goal.
- Brief or relevant acceptance criteria.
- Paths or ownership boundaries.
- Required tests, Web smoke, and Desktop smoke.
- Wiki/security/current-doc requirements.
- Any risks or unanswered questions.
