# TASKS-002 — provider-neutral Task domain and SQLite cache

Статус: implemented

Дата: 2026-08-29

Ветка: `feat/tasks-yandex-tracker`

## Boundary

TASKS-002 развивает существующий Tasks subsystem. Нового параллельного списка задач,
нового React state и прямой зависимости UI от Yandex Tracker JSON нет.

Поток данных:

```text
existing Tasks UI
  -> legacy DB API / taskStore
  -> tasks table
  -> localTaskAdapter
  -> provider-neutral Task
  -> SqliteTaskRepository / TaskService
```

Будущий remote flow:

```text
TaskProvider
  -> provider-neutral Task
  -> SQLite projection/cache
  -> TaskService
  -> UI
```

## Source of truth

- `provider = local`: SQLite является source of truth. Существующий CRUD продолжает
  работать и синхронизирует legacy completion с normalized `status`.
- `provider != local`: remote provider является source of truth, SQLite хранит
  projection/cache и source links.
- Remote create/update/transition в TASKS-002 не реализованы. `TaskService` возвращает
  `TaskProviderUnavailableError`, поэтому silent success и новая offline write queue невозможны.

## v41 migration

Migration v41 additive и использует существующий runner. Она не удаляет и не
перестраивает таблицы.

В `tasks` добавлены:

- `provider` с safe default `local`;
- `provider_task_id`, `external_key`, `organization_id`;
- normalized `status` и raw `provider_status`;
- raw `provider_priority` при сохранении совместимого legacy `priority`;
- `assignee_json`, `creator_json`, `followers_json`;
- `provider_updated_at`, `sync_state`.

Legacy строки получают `provider = local`, `sync_state = fresh`, а status безопасно
вычисляется из `is_completed`. Старые priority значения адаптируются без изменения
данных: `none/medium -> normal`, `urgent -> critical`.

Индексы ограничены lookup/idempotency путями:

- unique partial `(provider, provider_task_id)`;
- unique partial `(provider, organization_id, external_key)`;
- `(organization_id, status)`;
- source lookup индексы, описанные ниже.

Номера v34–v39 зарезервированы Calendar, v40 — macOS accounts migration. Поэтому
Tasks использует следующий глобально уникальный номер v41 даже до merge параллельных веток.

## Task domain

`src/services/tasks/domain.ts` определяет:

- extensible `TaskProviderId` с известными `local` и `yandex-tracker`;
- normalized statuses `open`, `in_progress`, `done`, `cancelled`, `unknown`;
- normalized priorities `low`, `normal`, `high`, `critical`, `unknown`;
- raw provider status `{ id, key, displayLabel }` и raw provider priority;
- `fresh`, `stale`, `syncing`, `error` cache states;
- assignee, creator, followers, organization and provider timestamps.

Незнакомые provider status/priority не отбрасываются: normalized значение становится
`unknown`, raw metadata остаётся в projection.

## People identity

`TaskPrincipalRef` содержит ссылку на канонический PEOPLE-001 `PersonIdentity`, а также
email/display name, optional provider UID и organization ID. Второй Person model не создан.
Для Tracker primary remote identity в TASKS-003 должен быть resolved Tracker UID.

## TaskSource and Mail linkage

`task_sources` отделяет provenance от task record. Первый тип — `mail`, schema допускает
будущие `calendar`, `manual`, `chat`, `document`.

Canonical mail identity:

```text
account_id + message_id
```

Сохраняемые fallback/snapshot поля:

- `thread_id`;
- RFC `Message-ID`;
- optional subject/sender snapshots.

Body и attachments автоматически не копируются. Source link не расширяет доступ
исполнителя к mailbox. На `(account_id, message_id)` нет unique constraint, поэтому
одно письмо может быть связано с несколькими задачами. FK `task_id` использует
существующую `ON DELETE CASCADE` policy.

## OrganizationTaskSettings

Одна deterministic запись на `(organization_id, provider)` хранит:

- enabled state;
- optional provider organization ID;
- optional default queue;
- updated timestamp.

OAuth tokens и другие secrets в этой таблице отсутствуют.

## Repository and provider contracts

`SqliteTaskRepository` предоставляет get/list, remote projection upsert, local projection
update, remove, assignee/creator lookup, source lookup и source insertion.

`TaskProvider` резервирует read/create/update/transition, assignee resolution и queues.
Все capabilities по умолчанию disabled через `NO_TASK_PROVIDER_CAPABILITIES`; неизвестная
capability не считается доступной.

TASKS-002 не содержит `YandexTrackerTaskProvider` и не вызывает Tracker transport.

## Compatibility

- Existing Tasks components и Zustand store продолжают использовать `DbTask`.
- Existing task table и IDs сохраняются.
- Legacy recurrence, tags, event-like details и thread linkage не удалены.
- `completeTask`/`uncompleteTask` поддерживают одновременно legacy `is_completed` и
  normalized `status`.
- Mail, PeoplePicker и Calendar UI не изменялись.

## TASKS-003 boundary

Следующий этап может реализовать только provider adapter и mapping:

- Tracker auth/read transport;
- queue/workflow/priority discovery;
- Directory person -> Tracker UID resolution;
- remote read projection and explicitly authorized writes.

TASKS-003 не должен менять v41 или provider-neutral UI contracts без нового migration gate.
