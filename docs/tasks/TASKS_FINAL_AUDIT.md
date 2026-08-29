# TASKS-007 — Final Tasks Audit

Статус: PASS — AUTOMATED/READ-ONLY ACCEPTANCE  
Дата: 2026-08-29  
Ветка: `feat/tasks-yandex-tracker`  
База: TASKS-002…006 PASS

## Scores (post assignee edit)

| Dimension | Score | Notes |
|-----------|-------|-------|
| Functional completeness | **9/10** | v1 create/list/detail/sync/settings/transitions/assignee edit |
| Interaction completeness | **9/10** | Mail↔Tasks roundtrip; sections refresh via `velo-task-updated` |
| Provider readiness | **9/10** | Tracker provider + caps + typed errors |
| Production readiness | **8/10** | Live mutation acceptance **NOT RUN** until explicit user OK |

## Audit matrix (A–P)

| Area | Status | Notes |
|------|--------|-------|
| A Mail → Create | PASS | Gate + modal + idempotency |
| B Org-only assignee | PASS | OrganizationPeoplePicker |
| C Default queue | PASS | Settings → Задачи |
| D Create + unique | PASS | TASKS-004 |
| E TaskSource/Mail | PASS | Preserved on update/sync |
| F My Tasks | PASS | listSection |
| G Created by me | PASS | |
| H Completed | PASS | transitions → done |
| I Detail | PASS | |
| J Transitions | PASS | real transition ids |
| K Title/desc/prio/due | PASS | caps-gated |
| L Assignee edit | PASS | TASKS-007 |
| M Sync/reconnect | PASS | coordinator single-flight |
| N Offline/read-only | PASS | typed RU |
| O Settings | PASS | no secrets |
| P Mail roundtrip | PASS | shared detail + source open |

## P0 / P1 / P2 (after assignee)

**P0:** none for automated v1 scope.

**P1:**
- Live mutation acceptance smoke (create/transition/assignee) — requires user confirmation
- Followers UI partial (capability-only)

**P2:**
- Comments/attachments UI
- Background sync when process killed
- Assignee clear / unassign UX
- cargo local `cef-runtime` env gap

## LIVE MUTATION READY (STOP — no auto execute)

Do **not** run cloud Tracker writes until the user explicitly confirms.

Discovery checklist (read-only allowed):

- organization binding + default queue
- capabilities read/write/assign/transitions
- directory resolution
- list My / Created / Completed
- detail transitions list (read-only)

Proposed reversible smoke (only after approval):

1. Create task title `Office360 TASKS acceptance test`
2. Appear in Tasks + optional Mail link
3. Priority/due update
4. Safe test assignee change
5. One transition
6. Close/cancel cleanup — never touch real work issues

## Accepted limitations

- Followers partial
- Comments/attachments capability-only
- No durable background sync when app killed
- cargo check may BLOCK on missing `cef-runtime`
- Known Vitest baseline outside Tasks (gmail/oauth)
- Tracker/Directory entitlements required for live
- Live cloud mutation coverage: NOT RUN until approval

## Feature-complete (v1 UI)

**YES** — pending optional live acceptance.

## Tasks DONE

**YES** for automated/read-only path. Live mutation path: approval required.
