# TASKS-003 — Yandex Tracker Provider

## Status

Production-ready `YandexTrackerTaskProvider` for Office360 Tasks.

- Remote source of truth: Yandex Tracker API v3
- Local projection: SQLite via `TaskRepository.upsertProjection`
- Mail UI create button: TASKS-004 — see `docs/tasks/TASKS_MAIL_CREATE_FLOW.md`

## API surface

Module: `src/services/tasks/yandexTracker/`

| Concern | Entry |
| --- | --- |
| Provider | `YandexTrackerTaskProvider` |
| HTTP (org-bound) | `src/services/yandex/trackerClient.ts` |
| Auth | existing `getYandexServiceContext` (`tracker:read` / `tracker:write`) |
| Directory membership | `yandex360/directory` via `DirectoryMembershipPort` |
| Idempotency helpers | `buildTaskUniqueKey`, `buildMailTaskUniqueKey` |

Provider methods:

- `capabilities(organizationId?)`
- `listQueues` / `resolveDefaultQueue` / `listPriorities`
- `resolveAssignee`
- `getTask` / `listTasks` (paginated; scopes: assigned-to-me, created-by-me, completed-recent, all)
- `createTask` / `updateTask`
- `listTransitions` / `transitionTask`

List sync / single-flight: `taskSyncCoordinator` + `TaskService.refreshFromProvider` — see `TASKS_SYNC_AND_SETTINGS.md`.

Assignee update path: `resolveAssignee` → `updateTask({ assignee })` → `project()` preserves `TaskSource`. UI: Task detail «Сменить исполнителя». Final audit: `TASKS_FINAL_AUDIT.md`.

Legacy UI client `src/services/yandex/tracker.ts` remains for TrackerPage; Tasks domain uses `trackerClient.ts`.

## Organization binding

Flow:

`OrganizationTaskSettings.organizationId`
→ `providerOrganizationId`
→ Tracker header `X-Org-ID`
→ probe `GET /v3/myself`

Typed failures:

- `configuration-required` — disabled / missing provider org / missing default queue
- `organization-mismatch` — principal/org probe mismatch
- `permission-denied` / `unauthorized` / `unavailable`

Mutations refuse to run without confirmed org binding (`/myself` in that org).

## OAuth / capabilities

Service OAuth scopes (Disk/Tracker app), **not** mailbox scopes:

- Required: `cloud_api:disk.read`, `cloud_api:disk.write`, `tracker:read`, `tracker:write`
- Preferred when enabled on the app: `directory:read_organization`, `directory:read_users`
- Optional: `directory:read_departments`

Redirect URI is taken from the OAuth app registered Callback (`GET /client/{id}/info`):

| App callback | Flow |
|---|---|
| `http://localhost:17248` (Office360 desktop client `9a7396…`) | Shared localhost PKCE listener (`start_oauth_server`), same as Mail/Yandex ID |
| `https://oauth.yandex.ru/verification_code` (DEFAULT services client `69e59…`) | CEF screen-code scrape |

Do not hardcode `verification_code` for apps registered only with localhost. Mail OAuth scopes/redirect stay separate.

Read-only mode: read capabilities true, mutations throw `permission-denied`.

## Queue discovery

- `listQueues` — accessible queues (`/queues`)
- `defaultQueue` from settings is **required** for create
- Queue validated with `/queues/{key}`
- Office360 never auto-creates queues

## Assignee resolution

Strict algorithm:

1. `TaskPrincipalRef`
2. Directory membership in `providerOrganizationId` (active, not dismissed/robot)
3. Tracker user lookup (login / passport id / email / paginated index)
4. Exact Tracker `uid`

Email-domain alone is rejected (`assignee-unresolved`).
Ambiguous matches → `assignee-unresolved`.
Wrong org on principal → `organization-mismatch`.

Local projection stores People identity (when present), email, displayName, `providerUid`, `organizationId` — not raw Tracker JSON blobs as the People identity.

## Status / priority

- Status: raw provider status is primary; normalized group only for reliable keys (`open`, `in_progress`, `done`, …)
- Transitions: list available transitions, execute by provider transition id; never fake `status=closed` PATCH when workflow requires transition
- Priority: `/priorities`; known keys map to `low|normal|high|critical`; custom → `unknown` + raw provider value

## Create / idempotency

Create body supports summary, description, queue, assignee uid, priority, deadline, followers, `unique`.

Unique format:

```text
office360:v1:<org>:<source/client identity>
office360:v1:<org>:mail:<account>:<message>:<clientTaskId>
```

On HTTP 409: search by `filter.unique`, accept exact single match as successful replay; ambiguous → `conflict`.

Canonical issue is re-fetched after create; projection upsert uses stable id
`yandex-tracker:<organizationId>:<providerIssueId>` and dedupes on `(provider, provider_task_id)`.

## Update / transitions / followers

Update: title, description, assignee (strict), priority, due date, followers.
Transitions: list → execute → refresh → projection.
Followers: supported when write capabilities allow; treated as PARTIAL if Directory/Tracker user resolution fails for a follower.

## Offline / errors / retry

- Cached local reads remain TASKS-002 responsibility via `TaskRepository`
- Live remote ops offline → `offline` (no silent queue)
- Errors normalized: unauthorized, permission-denied, configuration-required, organization-mismatch, assignee-unresolved, queue-unavailable, conflict, not-found, rate-limited, offline, unavailable
- GET retries: limited for 429/5xx; mutations do not blind-retry (create relies on `unique`)

## Security

Do not log OAuth tokens, full Tracker payloads, directory dumps, or full task descriptions.
Diagnostics stay sanitized (`TaskError.code` + short message).

## Live discovery / mutations

Allowed without extra permission: read-only discovery (`/myself`, queues, priorities, users, capabilities).

**Live create/update/transition against cloud: NONE** for TASKS-003 unless the user explicitly authorizes a separate live mutation run.

Automated tests cover mutations with fixtures/mocks.

## PEOPLE-001 dependency

This branch exposes People **identity types** only (`src/services/people/domain.ts`).
TASKS-003 does not copy PeoplePicker/UI and does not duplicate a People domain.
Assignee binding uses `TaskPrincipalRef` + Directory/Tracker ports.

## Migration

**NONE** (no v42).

## Known limitations

- Comments/attachments remain capability-false in Tasks provider (TrackerPage legacy client still has them)
- Followers create/update depends on strict org membership resolution for each follower
- Directory `listUsers` membership-by-email is a bounded page-1 style lookup in the default port; inject a richer port for large orgs if needed
- `cargo check` may remain blocked if local CEF runtime assets are missing (env limitation)
