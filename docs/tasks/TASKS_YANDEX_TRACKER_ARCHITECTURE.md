# TASKS-001 — задачи из писем через Yandex Tracker

Статус: TASKS-001 architecture complete; TASKS-002 domain/cache implemented

Дата проверки: 2026-08-29

База документа: `origin/main` (`88ee55d`)

Дополнительно проверено: `origin/feat/calendar-yandex360` (`e3604e8`, PR #4) для PEOPLE-001 и актуального Tracker transport

Cloud mutations: **NONE**

## Executive summary

Рекомендуемая архитектура — **HYBRID**:

- Yandex Tracker является source of truth для организационной задачи, ее ACL, автора, исполнителя, очереди, workflow, комментариев и уведомлений.
- Office360 хранит локальную provider-neutral проекцию задачи, устойчивую связь с исходным письмом, idempotency key и sync metadata.
- Существующий локальный Tasks module и таблица `tasks` не дублируются. Они эволюционируют в общий Tasks domain; существующие записи получают provider `local`, Tracker-задачи — provider `yandex-tracker`.
- PEOPLE-001 используется как presentation/search boundary, но assignee flow строже обычного PeoplePicker: selectable только подтвержденный активный член выбранной Yandex 360 organization, успешно разрешенный в Tracker principal.
- Для v1 организация настраивает одну default Tracker queue. Очередь не создается приложением.
- Из одного письма разрешено несколько задач. Каждый create intent получает собственный `clientTaskId`; повторы одного intent дедуплицируются через Tracker `unique`.
- Offline v1: cache readable; create/update/transition возвращают typed offline error. Существующая durable queue не расширяется на Tracker автоматически.

Итог TASKS-001: **PASS**. Migration gate для TASKS-002 одобрен 2026-08-29.

TASKS-002 реализует additive v41, общий Task domain, SQLite projection/cache, TaskSource,
organization settings, provider/repository contracts и legacy local adapter. Подробности:
`docs/tasks/TASKS_DOMAIN_AND_CACHE.md`.

Для TASKS-003 всё ещё нужен writable Tracker entitlement/ACL для end-to-end create verification.
Существующий live baseline имеет read access, но Tracker writes возвращали режим просмотра 403.

## 1. Audit существующего Office360

### 1.1 Уже существует на `main`

| Область | Факт | Последствие для архитектуры |
|---|---|---|
| Local Tasks | `src/services/db/tasks.ts`, `src/services/tasks/taskManager.ts`, `src/stores/taskStore.ts`, `src/components/tasks/*` | Не создавать второй Tasks module. Расширить существующий domain provider-полями и sync semantics. |
| Mail → local task | `TaskSidebar` создает несколько локальных задач на `accountId + threadId`; `AiTaskExtractDialog` также сохраняет задачу в SQLite | Сценарий уже доказан, но связь сейчас thread-level, без конкретного `messageId` и без remote provider. |
| Local schema | Таблица `tasks` создана в migration v19 и расширена в v25; есть title, description, priority, completion, due date, parent, thread link, recurrence, event-like details | Схема полезна как локальная проекция, но `is_completed` недостаточно для Tracker workflow. |
| Tracker client/UI | `src/services/yandex/tracker.ts`, `src/components/yandex/TrackerPage.tsx` | Уже есть official v3 endpoints для issue CRUD, queues, search, transitions, comments и attachments. Нужен adapter, а не второй raw client. |
| Organization binding | `src/services/yandex/accountApi.ts` хранит `yandex_org_id:<accountId>` и передает `X-Org-ID` | Нельзя хранить второй независимый org selector для Tasks. Нужна общая `OrganizationTaskSettings`, ссылающаяся на подтвержденную organization. |
| OAuth | Отдельный service OAuth grant для Disk/Tracker; токены хранятся secure settings, scopes — обычные settings | Tasks должен проверять persisted grants/capabilities, но не читать и не логировать token values. |
| Mail identity | `messages` имеет composite PK `(account_id, id)` и `thread_id`; также сохраняются RFC `message_id_header`, IMAP folder/UID | Canonical TaskSource должен быть account-scoped и message-specific, с thread/RFC fallback. |
| Provider architecture | Mail имеет `EmailProvider` + capabilities + factory; Calendar использует аналогичный provider/capability pattern | Tasks должен повторить этот паттерн: domain service → `TaskProvider` → Yandex Tracker adapter. |
| Pending operations | `pending_operations` — generic storage, но `queueProcessor` dispatch поддерживает email actions и `calendarRsvp` | Инфраструктура не готова безопасно исполнять Tracker mutations: нет typed task payload, reconciliation и `unique` recovery. |
| Generic source link | Общей entity/source-link abstraction нет. `tasks.thread_id`, follow-up reminders и contacts используют отдельные связи | Нужна одна небольшая `task_sources`, не общий framework для всего продукта в v1. |

### 1.2 Доступно в PR #4, но отсутствует на `main`

PR #4 добавляет PEOPLE-001 и существенно усиливает Tracker transport:

- `PersonIdentity` с email, `providerId`, именем, должностью, organization, department и source provenance;
- `Yandex360PeopleDirectoryProvider`, который получает organization/users/departments только через public Yandex 360 Directory API;
- явную capability `supported | unsupported | permission-denied`;
- проверку `directory:read_organization` + `directory:read_users`;
- native Tauri HTTP для Tracker (webview fetch не является надежным CORS transport);
- account-scoped Tracker session metadata, cooldown/429 handling и typed read-only/permission/org errors.

TASKS-003 должен интегрироваться после merge PR #4 или переносить только необходимые общие primitives отдельным согласованным изменением. В TASKS-001 код из PR #4 не копируется и PR #4 не изменяется.

### 1.3 Найденные архитектурные gaps

- `DbTask` не различает local и external tasks.
- Нет `providerTaskId`, human-readable external key, organization, queue, assignee/author/followers, raw provider status/priority, remote version и sync state.
- `is_completed` не способен выразить `new/open/in_progress/done/cancelled` и произвольный Tracker workflow.
- Mail link у task только thread-level; невозможно точно сказать, из какого письма цепочки создана задача.
- Existing Tracker functions принимают `Record<string, unknown>` и возвращают Tracker JSON прямо в UI; provider-neutral boundary отсутствует.
- PeoplePicker разрешает manual email и local contacts. Для task assignee это недопустимо без подтвержденного organization membership.
- `PersonIdentity.providerId` сейчас несет Directory user ID, но не хранит Directory organization ID и Tracker `uid/login`; нужен явный resolution result.

## 2. Yandex Tracker feasibility

Используется только официальный public API `https://api.tracker.yandex.net/v3`.

### 2.1 Подтвержденные endpoints

| Capability | Method and endpoint | Notes |
|---|---|---|
| Current principal | `GET /v3/myself` | Read-only capability check; возвращает user data и `hasLicense`. |
| List queues | `GET /v3/queues?perPage=...` | Только доступные пользователю очереди; обязательна pagination. |
| Queue metadata | `GET /v3/queues/{queueIdOrKey}?expand=workflows,fields,issueTypesConfig` | Нужен для workflow/required-field capability, не для hardcoded mapping. |
| Create issue | `POST /v3/issues/` | Required: `summary`, `queue`. Поддерживает assignee, followers, priority, deadline, description, `unique`. |
| Get issue | `GET /v3/issues/{issueIdOrKey}` | Возвращает stable `id`, human key, version и provider fields. |
| Search/list | `POST /v3/issues/_search` | `filter`, `query`, `keys` или `queue`; обязательна pagination. Можно фильтровать по любому issue field, включая `unique`. |
| Update fields | `PATCH /v3/issues/{issueIdOrKey}` | Не использовать для status; поддерживает version precondition. |
| Available transitions | `GET /v3/issues/{issueIdOrKey}/transitions` | Источник разрешенных действий для текущего user/issue/workflow. |
| Execute transition | `POST /v3/issues/{issueIdOrKey}/transitions/{transitionId}/_execute` | Может требовать дополнительные поля/комментарий, заданные workflow. |
| Comments | `GET/POST /v3/issues/{issueIdOrKey}/comments` | Pagination для чтения; write требует `tracker:write` и provider permission. |
| Attachments | `GET/POST /v3/issues/{issueIdOrKey}/attachments/` | Upload — multipart. В v1 не вызывать автоматически. |
| Priorities | `GET /v3/priorities` | Organization data, включая `id`, `key`, localized name и `order`. |
| Tracker users | `GET /v3/users`, `GET /v3/users/_relative`, `GET /v3/users/{loginOrId}` | Возвращает `uid`, `trackerUid`, `passportUid`, login, email, dismissed, hasLicense. |

Официальные источники:

- [Доступ к Tracker API](https://yandex.ru/support/tracker/ru/api-ref/access)
- [Создать задачу](https://yandex.ru/support/tracker/ru/api-ref/issues/create-issue)
- [Параметры issue request](https://yandex.ru/support/tracker/ru/api-ref/issues/request-fields)
- [Получить задачу](https://yandex.ru/support/tracker/ru/api-ref/issues/get-issue)
- [Редактировать задачу](https://yandex.ru/support/tracker/ru/api-ref/issues/patch-issue)
- [Найти задачи](https://yandex.ru/support/tracker/ru/api-ref/issues/search-issues)
- [Получить очереди](https://yandex.ru/support/tracker/ru/api-ref/queues/get-queues)
- [Получить очередь и workflows](https://yandex.ru/support/tracker/ru/api-ref/queues/get-queue)
- [Получить переходы](https://yandex.ru/support/tracker/ru/api-ref/issues/get-transitions)
- [Выполнить переход](https://yandex.ru/support/tracker/ru/api-ref/issues/new-transition)
- [Комментарии](https://yandex.ru/support/tracker/ru/api-ref/issues/get-comments) и [добавление комментария](https://yandex.ru/support/tracker/ru/api-ref/issues/add-comment)
- [Прикрепить файл](https://yandex.ru/support/tracker/ru/api-ref/issues/post-attachment)
- [Получить приоритеты](https://yandex.ru/support/tracker/ru/api-ref/admin/get-priorities)
- [Получить пользователя](https://yandex.ru/support/tracker/ru/api-ref/users/get-user) и [список пользователей](https://yandex.ru/support/tracker/ru/api-ref/users/get-users)

### 2.2 Headers, OAuth and permissions

Для Yandex 360 for Business:

```text
Authorization: OAuth <token>
X-Org-ID: <organizationId>
Content-Type: application/json
```

Для Identity Hub используется `X-Cloud-Org-ID` и может использоваться IAM token, но это отдельная будущая capability; v1 Office360 ориентирован на Yandex 360 + OAuth + `X-Org-ID`.

Required OAuth scopes:

- `tracker:read` — queues, users, issues, transitions, comments/attachments metadata;
- `tracker:write` — create/update/transition/comment/attachment upload;
- `directory:read_organization` — organization selection/binding;
- `directory:read_users` — доказательство membership и данные assignee;
- `directory:read_departments` — optional, только presentation.

Наличие scope не равно праву выполнить действие. Tracker дополнительно применяет entitlement, queue ACL, issue ACL и workflow rules. Office360 уважает фактический provider result.

### 2.3 Required fields and queue

Tracker требует `summary` и `queue`. Дополнительные required fields могут задаваться конкретной queue/workflow/type. Поэтому v1:

1. organization admin выбирает одну существующую default queue;
2. Office360 проверяет, что queue доступна через list/get;
3. перед enable выполняется capability check queue metadata;
4. если queue требует дополнительные поля, которых форма v1 не поддерживает, состояние — `configuration-required`, create button скрыт/disabled;
5. Office360 никогда не создает queue автоматически.

### 2.4 IDs and idempotency

Tracker возвращает:

- `id` — stable provider task ID, хранить как canonical remote identity;
- `key` — human-readable key вида `QUEUE-123`, хранить для UI/deep link;
- `version` — использовать при update для optimistic concurrency;
- `unique` — organization-wide idempotency value; повторный create с тем же value не создает дубль и возвращает 409.

Алгоритм create:

1. До сети создать local `task.id`/`clientTaskId` UUID и запись со `sync_state=create_pending`.
2. Построить:

   ```text
   office360:v1:<organizationId>:mail:<accountId>:<messageId>:<clientTaskId>
   ```

3. Отправить этот value в Tracker `unique`.
4. При timeout/неопределенном ответе повторить тот же request с тем же `unique`.
5. При 409 выполнить `_search` с `filter.unique`, затем reconcile по точному equality; не считать любой 409 успешным.
6. После успеха сохранить provider `id`, `key`, `version`, `updatedAt` атомарно с local projection.

`messageId` без `clientTaskId` использовать нельзя: из одного письма разрешено несколько задач.

## 3. Provider-neutral Tasks domain

```ts
type TaskProviderId = "local" | "yandex-tracker" | (string & {});

type TaskStatus = "new" | "open" | "in_progress" | "done" | "cancelled" | "unknown";
type TaskPriority = "low" | "normal" | "high" | "critical" | "unmapped";

interface TaskPrincipal {
  providerPrincipalId: string;   // Tracker uid for remote writes
  directoryPrincipalId?: string; // Yandex 360 Directory user ID
  login?: string;
  email: string;
  displayName?: string;
  membership: "confirmed";
}

interface Task {
  id: string;                    // Office360/clientTaskId
  provider: TaskProviderId;
  providerTaskId?: string;       // Tracker issue id
  externalKey?: string;          // Tracker issue key
  organizationId?: string;
  queueKey?: string;
  title: string;
  description?: string;
  status: TaskStatus;
  providerStatus?: { id?: string; key?: string; display: string };
  priority: TaskPriority;
  providerPriority?: { id?: string; key?: string; display: string };
  assignee?: TaskPrincipal;
  createdBy?: TaskPrincipal;
  followers?: TaskPrincipal[];
  dueAt?: string;                // provider-neutral ISO date/date-time contract
  createdAt: string;
  updatedAt: string;
  source?: TaskSource;
}

interface TaskSourceMail {
  type: "mail";
  accountId: string;
  messageId: string;
  threadId: string;
  rfcMessageId?: string;
  subjectSnapshot?: string;
  senderSnapshot?: string;
}

type TaskSource = TaskSourceMail; // future union members may be calendar/manual/etc.
```

Domain не содержит Tracker issue JSON. Raw provider refs ограничены маленькими typed snapshots, необходимыми для round-trip и truthful UI.

### 3.1 Provider contract

```ts
interface TaskProvider {
  readonly id: TaskProviderId;
  capabilities(context: TaskProviderContext): Promise<TaskCapabilities>;
  createTask(input: CreateTaskInput): Promise<Task>;
  getTask(ref: TaskRef): Promise<Task>;
  listTasks(query: TaskListQuery): Promise<TaskPage>;
  updateTask(ref: TaskRef, patch: TaskPatch): Promise<Task>;
  transitionTask(ref: TaskRef, transition: TaskTransitionInput): Promise<Task>;
  listTransitions(ref: TaskRef): Promise<TaskTransition[]>;
  resolveAssignee(identity: PersonIdentity, organizationId: string): Promise<TaskPrincipal>;
  listQueues(organizationId: string): Promise<TaskQueue[]>;
}

interface TaskCapabilities {
  availability: "ready" | "unsupported" | "configuration-required" | "permission-denied" | "unavailable";
  create: boolean;
  assign: boolean;
  dueDate: boolean;
  priority: "normalized" | "provider-values" | "unsupported";
  followers: boolean;
  transitions: boolean;
  comments: boolean;
  attachments: boolean;
  organizationDirectoryBinding: boolean;
  offlineRead: boolean;
  offlineWrite: false;
  reason?: string;
}
```

`YandexTrackerTaskProvider` инкапсулирует Tracker endpoints, mapping, pagination, retries/cooldown и typed errors. Components не вызывают `src/services/yandex/tracker.ts` напрямую.

## 4. Organization and assignee binding

### 4.1 Membership rule

Task assignee policy:

```text
organization membership must be confirmed
```

Одинаковый email domain, локальный contact, recent recipient или manual email не доказывают membership.

Допустимый candidate:

- пришел из `organization-directory`;
- Directory organization ID точно равен organization ID, выбранному для Tasks;
- Directory user active: не dismissed, enabled, не robot;
- Tracker resolver нашел principal под тем же `X-Org-ID` и вернул не-dismissed user.

При `directory permission-denied` assignee picker не деградирует до local contacts. Весь create flow получает `permission-denied`; local/recent results можно показать только как non-selectable informational rows либо не показывать вовсе.

### 4.2 Directory → Tracker resolution

Официальные Directory user data содержат stable user `id`, `nickname` (login) и email. Tracker user data содержат `uid`, `trackerUid`, `passportUid`, login и email. Tracker рекомендует явно задавать тип идентификатора, поскольку default изменился с `passportUid` на `uid`.

Безопасный v1 resolver:

1. PEOPLE-001 должен сохранить в identity context `directoryOrganizationId`, Directory `providerId`, `nickname` и email. Сейчас `organization` содержит display name, а `providerId` — user ID; этого недостаточно для строгого multi-org binding.
2. В выбранной organization запросить Tracker user по Directory nickname или пройти paginated Tracker users index.
3. Проверить точное совпадение organization context и минимум двух сигналов, когда доступны: Directory ID ↔ Tracker `passportUid`, exact normalized email, exact login. Эквивалентность Directory user `id` и Tracker `passportUid` выглядит ожидаемой для Yandex 360, но официальные страницы не формулируют ее как cross-API guarantee; adapter обязан подтвердить ее read-only ответами и не предполагать.
4. Отклонить ambiguous/missing/dismissed principal.
5. Для create передавать явно разрешенный Tracker `uid` (или login, если adapter contract фиксирует этот способ), а не email.

Email допустим как verification attribute, но не как единственное доказательство membership и не как прямое значение `assignee` без Tracker resolution.

Официальные Directory источники:

- [Organizations API и `directory:read_organization`](https://yandex.ru/dev/api360/doc/ru/ref/OrganizationsService/)
- [Directory users и `directory:read_users`](https://yandex.ru/dev/api360/doc/ru/directory/get-users)
- [UserService](https://yandex.ru/dev/api360/doc/ru/ref/UserService/)

### 4.3 PeoplePicker integration

Переиспользуется существующий PEOPLE-001 UI и ranking, но с policy mode:

```ts
<PeoplePicker
  mode="single"
  policy="confirmed-organization-member"
  organizationId={taskSettings.organizationId}
  allowManual={false}
/>
```

Показывать name, surname, email, job title, department. Local contacts/manual results не selectable. Followers policy в v1 такой же строгий; arbitrary external followers не включать до отдельного product/security решения.

## 5. Mail → Task flow

### 5.1 Entry and form

В открытом конкретном сообщении (не только в thread header) доступно действие `Создать задачу`.

Форма:

- Название — subject конкретного message/thread, editable;
- Исполнитель — strict organization-only PeoplePicker;
- Срок — optional, date-only для Tracker `deadline` (`YYYY-MM-DD`);
- Приоритет — normalized choices только при надежном mapping, иначе provider values;
- Описание — пустое или короткий user-authored текст; body письма не копируется автоматически;
- Наблюдатели — optional и organization-only;
- Источник — account/message/thread, non-editable.

Перед submit capability gate проверяет: online, provider connected, required scopes, confirmed organization, writable Tracker mode, default queue, queue accessibility/required fields, confirmed assignee.

### 5.2 Multiple tasks per message

Разрешить несколько задач из одного письма. В reading pane показывать компактный список связанных задач с title, assignee, due date, raw provider status и `Открыть задачу`.

Повторный double-click одного submit не создает новую задачу: UI блокирует submit, а backend использует один persisted `clientTaskId`/`unique`. Новое явное открытие формы создает новый intent и новый `clientTaskId`.

### 5.3 Open task and open source mail

- Tracker task: открывать canonical web URL, построенный из validated external key, либо internal detail view с provider fetch.
- Source mail: сначала искать `(accountId, messageId)`, затем `(accountId, threadId + rfcMessageId)`, затем account-scoped `rfcMessageId`; при отсутствии показывать `Исходное письмо больше не доступно локально`.
- Никогда не искать только по `messageId` или RFC Message-ID вне account scope.

Для Gmail local `messages.id` обычно является stable provider ID. Для IMAP текущий ID включает account/folder/UID и может измениться при move/resync/UIDVALIDITY; поэтому `threadId` и normalized RFC Message-ID нужны как fallback. Будущий Mail identity ticket может ввести stable logical message ID, но TASKS-001 не должен создавать общий Mail rewrite.

## 6. Queue strategy

V1 — одна configured default queue на organization:

```ts
interface OrganizationTaskSettings {
  provider: "yandex-tracker";
  organizationId: string;        // canonical Office360 / Directory org ID
  trackerOrgId: string;
  defaultQueue: string;
  enabled: boolean;
  bindingStatus: "verified";
  verifiedAt: string;
}
```

UI configuration states:

- organization resolved/selected;
- тот же binding candidate успешно прошел Directory organization read и Tracker `GET /myself` с `X-Org-ID`; одинаковое числовое значение само по себе не считается доказательством;
- Tracker `myself` available;
- queue выбран из `listQueues`, а не введен слепым текстом;
- queue get/capability check successful;
- write entitlement проверяется provider response; read success не доказывает write.

Later: department/project rules и manual queue selection. Они не входят в v1.

## 7. Status and workflow strategy

Tracker workflow привязан к queue и может различаться по issue type; в одной queue возможны несколько workflows. Поэтому нельзя hardcode status IDs или считать, что ключи всегда `open/inProgress/closed`.

Стратегия:

- Всегда хранить и показывать raw provider `status.id/key/display`.
- Normalized status использовать для coarse grouping, только если adapter получил надежный provider status type: `new/open/in_progress/done/cancelled`; иначе `unknown`.
- `Выполненные` определять по provider closed/cancelled status type или resolution, а не по строке display.
- Все status mutations строить из `GET /issues/{id}/transitions` для текущей issue и пользователя.
- UI показывает доступные transition display names. Normalized shortcuts (`Завершить`) допустимы только если ровно один transition однозначно ведет в нужный provider status type.
- Transition screens с дополнительными required fields дают capability `configuration-required/unsupported` до реализации этих fields.

## 8. Priority strategy

Tracker priorities являются organization objects и доступны через `GET /v3/priorities`; API также поддерживает custom priorities. Поэтому mapping не должен зависеть от localized display или numeric ID.

Safe mapping для известных standard keys:

| Office360 | Tracker keys |
|---|---|
| `low` | `trivial`, `minor` |
| `normal` | `normal` |
| `high` | `critical` |
| `critical` | `blocker` |

Неизвестный/custom key → `unmapped`, raw display остается primary UI. Не выводить произвольный mapping только из `order`. Default приоритет лучше не отправлять вовсе и позволить queue применить `defaultPriority`, если пользователь его не менял.

Существующий local enum `none/low/medium/high/urgent` нужно мигрировать/адаптировать отдельно: `none` → unset, `medium` → normal, `urgent` → critical. Это часть TASKS-002 migration design, не текущего изменения.

## 9. Local cache and proposed schema

Local cache нужен: **YES**.

Причины:

- быстрые My/Created/Completed lists;
- durable Mail ↔ Task linkage;
- offline read;
- idempotent create reconciliation;
- provider version/sync metadata;
- сохранение уже существующих local tasks.

### MIGRATION GATE REQUIRED

Migration в TASKS-001 не создается. Proposed additive schema:

```sql
-- Extend existing tasks; existing rows become provider='local'.
ALTER TABLE tasks ADD COLUMN provider TEXT NOT NULL DEFAULT 'local';
ALTER TABLE tasks ADD COLUMN provider_task_id TEXT;
ALTER TABLE tasks ADD COLUMN external_key TEXT;
ALTER TABLE tasks ADD COLUMN organization_id TEXT;
ALTER TABLE tasks ADD COLUMN queue_key TEXT;
ALTER TABLE tasks ADD COLUMN client_task_id TEXT;
ALTER TABLE tasks ADD COLUMN create_unique TEXT;
ALTER TABLE tasks ADD COLUMN normalized_status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE tasks ADD COLUMN provider_status_key TEXT;
ALTER TABLE tasks ADD COLUMN provider_status_display TEXT;
ALTER TABLE tasks ADD COLUMN provider_priority_key TEXT;
ALTER TABLE tasks ADD COLUMN provider_priority_display TEXT;
ALTER TABLE tasks ADD COLUMN assignee_json TEXT;
ALTER TABLE tasks ADD COLUMN created_by_json TEXT;
ALTER TABLE tasks ADD COLUMN followers_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN provider_version INTEGER;
ALTER TABLE tasks ADD COLUMN provider_updated_at INTEGER;
ALTER TABLE tasks ADD COLUMN last_synced_at INTEGER;
ALTER TABLE tasks ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'synced';
ALTER TABLE tasks ADD COLUMN last_sync_error_code TEXT;

CREATE UNIQUE INDEX idx_tasks_provider_remote
  ON tasks(provider, organization_id, provider_task_id)
  WHERE provider_task_id IS NOT NULL;

CREATE UNIQUE INDEX idx_tasks_provider_unique
  ON tasks(provider, organization_id, create_unique)
  WHERE create_unique IS NOT NULL;

CREATE TABLE task_sources (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  account_id TEXT,
  message_id TEXT,
  thread_id TEXT,
  rfc_message_id TEXT,
  subject_snapshot TEXT,
  sender_snapshot TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(task_id, source_type, account_id, message_id)
);

CREATE INDEX idx_task_sources_mail
  ON task_sources(source_type, account_id, message_id);

CREATE INDEX idx_task_sources_thread
  ON task_sources(source_type, account_id, thread_id);

CREATE TABLE organization_task_settings (
  provider TEXT NOT NULL,
  organization_id TEXT NOT NULL,       -- Directory/canonical Office360 org
  tracker_org_id TEXT NOT NULL,
  default_queue TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  binding_status TEXT NOT NULL DEFAULT 'unverified',
  verified_at INTEGER,
  configured_by_account_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY(provider, organization_id)
);
```

Перед migration нужно отдельно решить:

- сохранить `is_completed` как compatibility projection или заменить все readers на normalized status;
- JSON validation/versioning для principals;
- account deletion semantics: organization task cache не должен исчезнуть неожиданно, если удален один credential account;
- PII retention для snapshots и followers;
- backfill existing tasks (`provider=local`, status from `is_completed`, priority mapping).

## 10. Sync and offline policy

V1:

- cached tasks readable offline с visible `Последнее обновление`;
- create/update/transition/comment/attachment offline → typed `task_offline_write_unsupported`;
- никаких silent queued Tracker writes;
- online list refresh обновляет projection по provider `id/version/updatedAt`;
- optimistic UI для remote mutation не отмечает успех до provider confirmation;
- conflict/version mismatch → refresh issue, показать conflict, не перезаписывать молча.

Существующую `pending_operations` можно переиспользовать позже только после появления:

- typed task operation schema/version;
- explicit idempotency/reconciliation (`unique` for create, provider version for update);
- task-aware dispatcher и provider error classification;
- redacted queue preview без mail body/Tracker payload;
- user-visible cancel/retry semantics.

## 11. Tasks module UX

Минимальные views:

- **Мои задачи** — remote assignee is current Tracker principal + local assigned-to-self semantics;
- **Поставленные мной** — provider `createdBy` is current principal;
- **Выполненные** — provider closed/cancelled classification + completed local tasks;
- **Все доступные** — optional, только если provider capability/ACL позволяет и product одобряет потенциальный объем/PII.

Row: title, assignee, author, due date, priority, raw status, queue/external key и source icon `из письма`.

Detail: provider fields, available transitions, source link. Comments UI не блокирует v1 и рекомендуется для TASKS-006; attachments — future explicit flow.

## 12. Permissions and unavailable states

Tracker остается authority. Office360 не обещает права до успешного provider response.

| Condition | State | UX |
|---|---|---|
| Не Yandex organization / provider не поддержан | `unsupported` | Не показывать рабочую кнопку; объяснить ограничение v1. |
| Tracker service grant отсутствует | `configuration-required` | CTA `Подключить Яндекс Трекер`; запросить официальный OAuth consent. |
| Нет `tracker:write` | `permission-denied` | Read cache/list можно оставить; create/update disabled. |
| Нет organization binding | `configuration-required` | Выбор organization из official Directory list; manual org ID только отдельный admin fallback. |
| Нет default queue | `configuration-required` | Admin/settings CTA выбрать доступную queue. |
| Queue inaccessible/required fields unsupported | `permission-denied` или `configuration-required` | Не показывать ложную create form. |
| Directory permission denied | `permission-denied` | Assignee selection и create disabled; local contact не substitute. |
| Tracker read-only plan/license | `permission-denied` с code `tracker_read_only` | Read UI остается; write controls disabled; не предлагать re-consent как ложное исправление. |
| 401/token expired | `configuration-required` | Reauthorize; не очищать task cache/source links. |
| Network/429/5xx | `unavailable` | Cache read + retry-after/cooldown; mutations не queued. |

Creator/assignee/editor/closer/visibility права определяются Tracker queue/issue ACL и workflow. Office360 может скрыть недоступные controls по capabilities/transitions, но финальным решением всегда является provider.

## 13. Security and privacy

- Не копировать полный Mail body в Tracker автоматически.
- Default description — пустой или user-authored. Subject snapshot допустим как title; sender snapshot хранить только для local source UI.
- `Включить фрагмент письма` — отдельное explicit действие с plain-text sanitization, preview и предупреждением, что task audience может быть шире mailbox audience.
- Не логировать Directory query/results, email addresses, Tracker bodies, OAuth tokens или complete request payloads.
- В diagnostics хранить только typed error code, HTTP class, provider/operation и correlation ID.
- Tracker task не расширяет доступ к исходному mailbox. Source deep link работает локально только для account, у которого уже есть письмо.
- По умолчанию source link видит creator/current local profile. Assignee видит его только если тот же локальный Office360 profile уже имеет authorized access к source account/message.
- Нельзя публиковать mailbox deep link или raw message identifier в Tracker description/comments.

**PRODUCT/SECURITY DECISION REQUIRED:** разрешать ли explicit sanitized excerpt/copy для assignee, который не имеет mailbox access. Рекомендация v1 — не включать excerpt автоматически и не прикреплять письмо.

## 14. Attachments, comments and notifications

### Attachments

Official attachment upload существует и текущий client уже имеет prototype. Future flow возможен, но v1:

- не прикрепляет mail attachments автоматически;
- требует explicit file selection + confirmation;
- проверяет size/type и показывает, что файл станет доступен Tracker audience;
- не передает inline/remote content без user action.

### Comments

Comments API feasible. Comments UI не нужен для первого Mail → Task slice; task detail может открывать Tracker. Добавить после стабильного sync/transitions.

### Notifications

Tracker уже отправляет native notifications; create API имеет `notify` behavior. V1 не дублирует Tracker notifications через Office360. Локальные notifications допустимы позже только для local-only tasks либо по явной настройке, с дедупликацией по provider event/version.

## 15. Read-only live discovery

Новые live requests в TASKS-001 не выполнялись: безопасного credential-free runtime bridge нет, а чтение token/settings запрещено policy.

Использован существующий observe-only QA baseline от 2026-08-11:

- `GET /myself`, queues, issues/list/open — PASS;
- была доступна одна рабочая queue и существующие issues;
- stored OAuth grant содержал `tracker:read` + `tracker:write`;
- create/update — 403 с explicit Tracker view-mode message;
- root cause — read-only Tracker entitlement/tariff, не missing OAuth scope;
- никаких writes в этом audit не повторялось.

Следствие: backend feasibility подтверждена для read paths, но TASKS-003 нужен writable test organization/seat для end-to-end create verification.

## 16. Phased roadmap

### TASKS-002 — Core domain + migration/cache

Статус: implemented on `feat/tasks-yandex-tracker`.

- migration gate approved; additive v41 reserved after parallel v34–v40 work;
- существующая `tasks` расширена, добавлены `task_sources` и `organization_task_settings`;
- provider-neutral domain/contracts/capabilities/typed unavailable errors готовы;
- legacy local tasks адаптируются как provider `local`, существующий UI/CRUD сохранён;
- migration/domain/source/repository tests добавлены;
- Tracker mutations отсутствуют.

### TASKS-003 — Yandex Tracker provider

- зависимость от merged PEOPLE-001/Tracker transport primitives из PR #4;
- typed Yandex adapter, pagination, queue/settings capability, priorities, users resolver;
- read sync/cache and idempotent create implementation;
- organization/assignee verification;
- fixtures and read-only live discovery first;
- real create только в отдельном approved writable test org с explicit confirmation.

### TASKS-004 — Mail → Create Task UI

- message-level action/form;
- strict PeoplePicker mode;
- capability/error states;
- multi-task linkage list in reading pane;
- privacy copy and no automatic body/attachment sharing.

### TASKS-005 — Tasks list/detail

- My / Created by me / Completed;
- provider/raw status and priority;
- source-mail navigation with fallback;
- cache freshness/unavailable states.

### TASKS-006 — Sync/transitions/collaboration polish

- incremental refresh/conflicts;
- transition UI driven by provider;
- comments;
- explicit attachments;
- notification policy/deduplication;
- optional durable mutations only after separate design review.

## 17. Acceptance decisions

| Question | Decision |
|---|---|
| Recommended backend | **HYBRID** — Tracker source of truth + Office360 local projection/cache/source links |
| Tracker required | Да для organizational tasks v1; existing local tasks remain supported |
| Queue | One configured existing default queue per organization |
| Multiple tasks per mail | Да |
| Idempotency | Tracker `unique` derived from org/account/message/clientTaskId |
| Assignee | Confirmed Directory member resolved to Tracker principal; no manual email |
| Status | Raw provider primary; normalized coarse category when safely derivable; transitions dynamic |
| Priority | Provider-discovered; known-key normalization only; custom values remain raw |
| Offline writes | Нет в v1 |
| Local cache | **YES** |
| Migration | **YES — v41 additive, gate approved** |
| Mail body copy | Нет по умолчанию |
| Auto attachments | Нет |
| Comments UI | Не блокирует v1 |
| Duplicate domain | Не создавать; evolve existing Tasks module |

## 18. Out of scope for TASKS-001

- production Tasks implementation;
- migration execution;
- OAuth scope/config changes;
- queue creation/config changes;
- real issue create/update/transition/comment/attachment;
- production deploy;
- changes to PR #4;
- automatic start of TASKS-002.
