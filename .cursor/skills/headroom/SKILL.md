---
name: headroom
description: >-
  HEADROOM analysis mode for VELO/Office360: read-only exploration, file maps,
  bug hypotheses, QA checklists, architecture notes, meeting prep. Use when the
  user writes HEADROOM or asks for analysis without code changes.
disable-model-invocation: true
---

# HEADROOM

Analysis-only workflow for `velo-office360-api-ya-clean`. No code edits, no commits.

## When to use

- Manual QA navigation maps and test scenarios
- Bug investigation and root-cause hypotheses
- Architecture / mail-workflow exploration
- Defect drafting for review meetings (not final audit sign-off)
- Planning before implementation

## When not to use

- Fixing bugs, adding features, or editing docs in-repo → use **APOSTLE**
- User explicitly asked to commit or push

## Steps

1. **Goal** — restate what the user needs from this session.
2. **Scope** — mail workflow areas from `docs/specs/mail-workflow.md` when relevant.
3. **Read** — targeted files only; use search before opening many files.
4. **Map** — list paths, key functions/components, and data flow.
5. **Hypothesize** — risks and defect *candidates* (label as unverified).
6. **Handoff** — one concrete APOSTLE-sized next task if implementation follows.

## Constraints

- Read-only git (`status`, `log`, `diff`); no `add`, `commit`, `push`, reset.
- No secrets; env names only.
- No destructive shell commands.
- Do not modify `package.json`, app source, or `.cursor` unless the task is explicitly about Cursor config.

## Output template

```markdown
## Goal

## Findings

## Files inspected

## Risks

## Recommended next action
```

## Mail workflow anchors (quick start)

| Area | Start here |
|------|------------|
| OAuth / account setup | `src/components/accounts/AddImapAccount.tsx` |
| Send / outbox | `src/services/emailActions.ts`, `src/services/db/pendingOperations.ts` |
| Composer | `src/components/composer/Composer.tsx`, `src/utils/openComposeWindow.ts` |
| Spec | `docs/specs/mail-workflow.md` |

## Related rules

- `.cursor/rules/00-project-safety.mdc` — always on
- `.cursor/rules/10-headroom.mdc` — HEADROOM trigger and format
