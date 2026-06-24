---
name: apostle
description: >-
  APOSTLE execution mode for VELO/Office360: small targeted fixes, docs commits,
  tests, safe git workflow. Use when the user writes APOSTLE or asks to implement
  a concrete change with minimal diff.
disable-model-invocation: true
---

# APOSTLE

Execution workflow for `velo-office360-api-ya-clean`. One small task per session.

## When to use

- Single bug fix or small feature in mail workflow
- Targeted test additions or fixes
- Docs / `.cursor` config updates (when requested)
- Commit after explicit user request and passing checks

## When not to use

- Exploration-only, QA maps, architecture review → use **HEADROOM**
- Large multi-file refactors without user approval

## Preflight checklist

```
- [ ] git status -sb
- [ ] Task is one clear outcome
- [ ] ≤3 files (or user approved more)
- [ ] No secrets in diff
```

## Implementation

1. Read surrounding code; match conventions.
2. Minimal diff; no unrelated formatting.
3. Stage explicit paths: `git add path/to/file` — never `git add .`.
4. Run smallest relevant checks:
   - TS/TSX: `npx tsc --noEmit` or `npm run lint` on touched scope
   - Tests: `npx vitest run path/to/file.test.ts`
   - Rust (if `src-tauri/` changed): `cargo check` in `src-tauri/`

## Git policy

| Action | Rule |
|--------|------|
| Commit | Only if user explicitly asked in this task |
| Push | Only if user sent a separate explicit push request |
| `git add .` | Forbidden |
| `main` | Do not switch or commit there unless asked |

## Output template

```markdown
## Plan

## Files changed

## Checks

## Commit

## Remaining issues
```

## Example task sizes (good for APOSTLE)

- Fix one i18n key in `src/i18n.ts`
- Add one vitest case for `handleSendEmailResult`
- Patch `OutboxList` copy to use existing i18n helper
- Update one section of `docs/specs/mail-workflow.md`

## Related rules

- `.cursor/rules/00-project-safety.mdc` — always on
- `.cursor/rules/20-apostle.mdc` — APOSTLE trigger and format
