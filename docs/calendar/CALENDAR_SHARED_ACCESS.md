# Calendar shared access and provider presence

Status: CAL-119, 2026-08-23 (Asia/Bangkok).

## Contract

`CalendarAccess` is provider-neutral metadata attached to every discovered `CalendarInfo` and persisted as a versioned `access_json` envelope. It separates:

- effective role: `owner`, `editor`, `contributor`, `viewer`, `free-busy-only`, `unknown`;
- ownership: `primary`, `owned`, `shared`, `unknown`;
- owner identity when a provider exposes it;
- independent effective permissions for detail read, Free/Busy, create, update, delete and sharing management;
- the original provider role/privilege source for diagnostics.

Provider capabilities answer what an adapter can implement in general. `CalendarAccess.permissions` answers what the signed-in identity may do to one specific calendar. Every write must pass both gates.

## Provider normalization

Google CalendarList is paginated and maps effective `accessRole`: `owner` → owner, `writer` → editor, `writerWithoutPrivateAccess` → contributor, `reader` → viewer, and `freeBusyReader` → free-busy-only. Google CalendarList provides effective access, not a complete ACL or a reliable owner identity; ACL read/write therefore remain unsupported.

CalDAV requests `DAV:owner`, `DAV:current-user-privilege-set` and the supported privilege set together with the existing discovery properties. Known privileges are reduced independently: `read`, `write`, `write-content`, `bind`, `unbind`, `write-acl`, and `read-free-busy`. Unknown or missing properties never become write permission. Owner equality uses resolved principal URLs, not display names. Yandex uses this same mapping; if its server omits privileges, the result is safely unknown/non-writable.

## Persistence and reconciliation

Append-only migration v37 adds nullable `access_json`, `access_observed_at`, `provider_presence`, and `provider_seen_at` columns plus an account/presence index. No row is backfilled or rewritten by the migration.

Successful authoritative discovery upserts every returned calendar as `present`, records the observation time, then marks previously known calendars absent from that provider response as `removed`. Removed rows and their cached events are retained; normal reads exclude the calendar. A failed or partial discovery does not run reconciliation, so it cannot falsely remove calendars.

Legacy `NULL` access metadata is readable to preserve existing cached events, but non-writable until the next successful discovery. This is lazy normalization: startup does not scan or rewrite existing rows.

## Enforcement and privacy

- Toolbar/grid create uses only calendars with `canCreate`.
- Event edit/delete and drag/resize require per-calendar `canUpdate`/`canDelete` in addition to provider capabilities.
- `CalendarMutationService` rechecks persisted access before provider I/O and returns typed `read-only` or `calendar-unavailable` failures.
- A provider 403 permission failure is not retried. Access discovery is refreshed once so later UI state reflects revocation without risking duplicate writes.
- Free-busy-only calendars are not fetched into the detail cache. The defensive details view renders only `Занято`, time geometry and calendar identity; title, description, location, participants, reminders and write actions stay hidden.

## Deliberate boundaries

CAL-119 performs read-only access discovery and normal local reconciliation. It does not mutate Google ACLs, CalDAV ACLs, subscriptions, provider ordering or provider colors. Local visibility remains an independent UI preference. Cloud ACL/subscription mutations require a separately approved product/API scope.

Provider metadata is advisory until the provider enforces the operation. The mutation boundary remains authoritative and treats a runtime denial as permission revocation. `writerWithoutPrivateAccess` is represented as contributor; Google itself redacts private event data that role cannot see.

## CAL-119 runtime smoke (2026-08-23)

Feature commit `4be8742` не менялся. Windows Graphics Capture по-прежнему блокирует Computer Use (`GetCursorPos 0x80070005`, `CreateForMonitor 0x80070057`); visual smoke выполнен через обычное окно приложения (UIA + PrintWindow Tauri WebView), без починки capture.

| Check | Status |
|---|---|
| Month | PASS |
| Week | PASS |
| Day | PASS |
| Tauri | PASS |
| Calendar list | PASS |
| Shared fixture | NOT AVAILABLE |
| Read-only fixture | NOT AVAILABLE |
| Free-busy-only live fixture | NOT AVAILABLE |
| Permission UI live | AUTOMATED ONLY — automated permission/privacy tests remain PASS |
| Create target | PASS — writable selector loaded; Cancel; Save not pressed |
| Event details | PASS |
| Cloud event writes | NONE |
| Cloud ACL mutations | NONE |

Live account показал две owned present-коллекции (Primary + Owner). Shared/read-only/free-busy fixture не создавался и не расшаривался. `cargo check` повторён: PASS, два прежних unused-variable warning в `src/lib.rs:360`; Rust не менялся. Full Vitest не перезапускался.
