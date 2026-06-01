---
name: velo-agent-handoff
description: Use when Velo Mail agent work needs a structured handoff between orchestrator, analyst, developer, tester, and GitVerse publisher roles without losing scope, ownership, verification state, or unresolved questions.
---

# Velo Agent Handoff

Use this skill to pass Velo Mail work between specialist roles. The handoff is a text contract that the orchestrator can paste into the next role prompt or use directly as implementation context.

## Control model

- `velo-epic-lead` is the orchestrator and single user-facing owner of the flow.
- Specialist roles return handoff packets to the orchestrator; they do not ask the user low-level questions directly unless the orchestrator explicitly delegated that.
- The orchestrator decides whether to continue, ask the user, narrow scope, or stop.
- `gitverse-cli` may push or create a PR only when the user explicitly requested publication in the starting task or in a later command.

## Standard packet

Every specialist role should end with this block:

```text
Handoff:
status: ready | blocked | needs_review | ready_for_implementation | ready_for_tests | ready_for_pr
next_role: thunderbird-benchmark-analyst | velo-mail-developer | velo-mail-tester | gitverse-cli | velo-epic-lead | user
summary: <1-3 sentences>
changed_files: <paths or none>
commands_run: <commands or none>
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

- Do not mark `ready_for_pr` if tests failed or were skipped without an explicit risk note.
- Do not route to `gitverse-cli` if `open_questions` contains unresolved product scope.
- Do not hide security, privacy, data-loss, migration, or credential risks in summary text; list them under `risks`.
- If code changed, `changed_files` must list the actual paths or state that the work happened in a forked agent workspace.
- If no commands ran, write `none` under `commands_run`.

## Typical chain

1. `velo-epic-lead`: intake, branch, brief, ownership.
2. `thunderbird-benchmark-analyst`: optional benchmark notes and scenarios.
3. `velo-mail-developer`: implementation and local targeted checks.
4. `velo-mail-tester`: verification against acceptance criteria.
5. `gitverse-cli`: push and PR only after explicit publication gate.

## Handoff prompts

Keep `handoff_prompt` direct and executable. Include:

- Role to use.
- Goal.
- Brief or relevant acceptance criteria.
- Paths or ownership boundaries.
- Required tests or checks.
- Any risks or unanswered questions.
