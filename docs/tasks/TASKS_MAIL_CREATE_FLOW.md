# TASKS-004 — Mail → Create Task flow

## Goal

Create a Yandex Tracker task from an open mail message inside Office360, link it via `TaskSource`, and show linked tasks on the message — without parallel task models and without expanding mailbox access through the task.

## Entry point

- Action **«Создать задачу»** in the mail `ActionBar` (`data-testid="create-tracker-task-action"`).
- Enabled only when `evaluateCreateTaskGate` succeeds:
  - online
  - Yandex 360 organization bound
  - `OrganizationTaskSettings.enabled` + `providerOrganizationId`
  - `defaultQueue` configured
  - provider capabilities: `read` + `create`
- Otherwise the control stays visible but **disabled** with RU tooltip (`createTrackerTaskTitle`).

Legacy AI extract (`ListTodo` / `velo-extract-task`) remains a separate path.

## Modal

`CreateTrackerTaskFromMailModal`:

| Field | Behavior |
| --- | --- |
| Title | Prefill = mail subject |
| Description | Short safe prefill `Задача создана из письма «…»`; **no** full body/quoted thread |
| Assignee | `OrganizationPeoplePicker` / `PeoplePicker` — organization-directory only |
| Due date | Optional date (`YYYY-MM-DD` → local noon unix) |
| Priority | Normalized RU labels (low/normal/high/critical) |
| Source | Non-editable subject + sender |

Followers UI is omitted until `capabilities.followers` is productized.

## Assignee policy

- Strict **organization-only** (`source === "organization-directory"`).
- Manual arbitrary email: **not allowed**.
- Directory `permission-denied`: show «Не удалось подтвердить сотрудника организации» — do not fall back to local contacts.
- Tracker UID unresolved → typed `assignee-unresolved`.

## Create pipeline

1. Generate `clientTaskId` once per modal mount (`newClientTaskId`).
2. Build unique: `office360:v1:<org>:mail:<account>:<message>:<clientTaskId>`.
3. Resolve assignee UID via provider.
4. `provider.createTask` → canonical task.
5. `TaskRepository.addSource` (`type=mail`, account/message/thread/RFC/subject/sender snapshots).
6. Success only after remote create + local source link; then close modal and refresh linked block.

Retry of the **same** form keeps the same unique key. A new open of the form gets a new `clientTaskId` (multiple tasks per mail).

## Linked tasks

`LinkedMailTasksBlock` lists tasks for `(accountId, messageId)`:

- title, assignee, due, status, optional provider key
- **Открыть** → shared `ProjectedTaskDetailModal` (TASKS-005), not a mail-only mini detail

Empty list → block hidden. Offline: show cached projection only; create remains disabled.

Mail source **Открыть письмо** from task detail uses `openTaskSourceMail` → existing mail thread navigation.

## Security

- Task create does **not** attach mail body/attachments to Tracker.
- Source linkage does not grant mailbox access to assignees who lack mailbox permission (unchanged mailbox boundary).

## Live smoke (TASKS-004)

Mail → Create task → fill → Cancel. **No live Tracker mutations** without explicit user permission.

## Files

- `src/services/tasks/mailCreateFlow.ts`
- `src/services/tasks/organizationDirectorySearch.ts`
- `src/components/tasks/CreateTrackerTaskFromMailModal.tsx`
- `src/components/tasks/OrganizationPeoplePicker.tsx`
- `src/components/tasks/LinkedMailTasksBlock.tsx`
- `src/components/email/ActionBar.tsx` / `ThreadView.tsx`
