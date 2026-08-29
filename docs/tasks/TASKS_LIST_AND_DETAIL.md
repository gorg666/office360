# TASKS-005 — Task lists and detail

Статус: implemented

Дата: 2026-08-29

Ветка: `feat/tasks-yandex-tracker`

## Scope

Пользовательский Tasks module поверх provider-neutral Task domain / SQLite projection:

- навигация **Задачи** (существующий `/tasks` + sidebar);
- разделы: **Мои задачи**, **Поставленные мной**, **Завершённые**;
- detail modal/panel;
- mail source block + **Открыть письмо**;
- cache-first lists, offline/stale/error banners;
- LinkedMailTasksBlock открывает **общий** `ProjectedTaskDetailModal`.

Не создаёт второй Tasks backend. Sync coordinator / transitions / settings: см. `TASKS_SYNC_AND_SETTINGS.md` (TASKS-006).

## Entry

- Sidebar `tasks` → `navigateToLabel("tasks")` → `/tasks` → `TasksPage`.
- `TasksPage`: вкладки **Tracker** (projection) и **Локальные** (legacy `LocalTasksView`).

## Data flow

```text
TaskRepository.list(organizationId)
  -> filterTasksBySection (assignee/createdBy/status + org scope)
  -> filterTasksByText (optional)
  -> sortTasksForList
  -> OrganizationTasksView
```

Remote refresh (manual):

```text
TaskService.refreshFromProvider
  -> TaskProvider.listTasks(assigned-to-me | created-by-me)
  -> provider.project upserts cache
  -> reload from repository
```

UI не ждёт Tracker для первого render при наличии cache.

## Sections

| Section | Rule |
|---------|------|
| Мои задачи | `assignee` matches current user, status not done/cancelled |
| Поставленные мной | `createdBy` matches current user, status not done/cancelled |
| Завершённые | status `done` \| `cancelled`, user is assignee or creator |

Current user match: `providerUid` if both set, else normalized email. Not displayName.

Organization scope: `getStoredYandexOrgId(activeAccount)` — задачи других org не смешиваются.

## Sorting

Default order:

1. overdue (active + dueAt &lt; now)
2. nearest dueAt
3. priority (critical → low)
4. updatedAt desc

Tasks without due date sort below dated active tasks.

## Status / priority display

Normalized RU labels for known groups. If status/priority is `unknown`, show provider label / raw priority string. Raw provider fields are preserved on the Task model.

## Detail

`TaskDetailView` / `ProjectedTaskDetailModal`:

title, externalKey, status, priority, assignee, creator, followers, due, description, source, createdAt, updatedAt.

Mail source: snapshot subject/sender + **Открыть письмо**.

## Open source mail

`openTaskSourceMail`:

1. require mail `TaskSource` + local account access;
2. resolve thread via `messageId` → `getMessageById`;
3. fallback `threadId`, then RFC `message_id_header`;
4. `setActiveAccount` if needed + `navigateToLabel("all", { threadId })`.

Missing / no access → typed copy **Исходное письмо недоступно**. Does not expand mailbox permissions.

## States

- loading / offline / sync error («Не удалось обновить задачи») / stale hint;
- read-only Tracker banner when capabilities allow read but not create/transitions;
- cache not cleared on transient refresh errors.

Empty RU:

- У вас пока нет задач
- Вы пока никому не ставили задачи
- Нет завершённых задач

## Files

- `src/services/tasks/taskListView.ts`
- `src/services/tasks/openTaskSourceMail.ts`
- `src/services/tasks/taskService.ts` (`listSection`, `refreshFromProvider`)
- `src/components/tasks/OrganizationTasksView.tsx`
- `src/components/tasks/TaskDetailView.tsx`
- `src/components/tasks/TasksPage.tsx` / `LocalTasksView.tsx`
- `src/components/tasks/LinkedMailTasksBlock.tsx`

## Out of scope (TASKS-006+)

- Full background poll / multi-account fan-out (coordinator covers manual/initial/reconnect)

Detail supports status transitions, field edits, and **assignee change** via `OrganizationPeoplePicker` (TASKS-007). Sections recalculate on `velo-task-updated` without full app reload.

## Related

- Final audit: `TASKS_FINAL_AUDIT.md`
- Sync/transitions/settings: `TASKS_SYNC_AND_SETTINGS.md`
- Status transition / edit UI
- FTS search
- Mobile layout

## Migration

NONE (v41 already shipped in TASKS-002).

## Live mutations

NONE.
