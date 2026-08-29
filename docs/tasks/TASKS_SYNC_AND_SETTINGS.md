# TASKS-006 — Sync, Transitions & Settings

## Scope (v1)

- Provider-neutral **task sync coordinator** with single-flight per `provider::account::organization`
- Manual / initial / reconnect refresh into `TaskRepository` projections
- Bounded pagination (`maxPages`, `perPage`) for assigned / created / completed-recent
- Task detail: real **workflow transitions** (provider transition id), optional field edits (title/description/priority/due)
- Settings → **Задачи**: enabled, org, default queue discovery/save
- Typed remote availability: `unavailable` | `removed` | `permission-denied` (no silent delete)
- Read-only / offline: lists readable; mutations disabled with RU reason

Out of v1 UI: none remaining for assignee — see TASKS-007 / `TASKS_FINAL_AUDIT.md`.

Assignee edit in Task detail uses `OrganizationPeoplePicker` → `resolveAssignee` → `updateTask` → projection + `velo-task-updated`.

## Sync coordinator

`src/services/tasks/taskSyncCoordinator.ts`

| Trigger | When |
|---------|------|
| `initial` | Tasks module first open (online) |
| `manual` | Refresh button |
| `reconnect` | `window` online |
| `startup` | optional lifecycle hook |
| `after-mutation` | reserved |

`TaskService.refreshFromProvider` delegates here. Failures set stale/error status; **cache is not cleared**.

`listTasks` → provider `project()` already upserts and **preserves TaskSource**.

## Transitions

Detail loads `listTransitions` when `capabilities.transitions`. Execute uses `transitionTask({ transitionId })` then canonical refresh. Custom Tracker statuses show provider labels; normalized groups only for list semantics.

## Settings

`Settings → Задачи` (`TasksSettingsPanel`):

- Tasks enabled
- Provider = Yandex Tracker
- Current organization id
- Default queue dropdown from `listQueues()`
- Read/write / directory capability diagnostics

Persisted fields only (`organization_task_settings`): org, provider, enabled, provider org id, queue. **No OAuth secrets.**

## Mail linkage

After sync/update/transition: sources remain. Mail linked block opens shared `ProjectedTaskDetailModal` and listens to `velo-task-updated`.

## Live mutations

Automated / agent live Tracker writes: **NONE** for this ticket. Read-only smoke allowed.
