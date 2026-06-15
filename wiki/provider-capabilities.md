# Provider Capabilities

Office360 использует provider capabilities, чтобы держать provider-specific behavior явным и не показывать Gmail-only features в IMAP/Yandex workflows.

## Целевые провайдеры

Default target providers:

- IMAP/SMTP;
- Yandex Mail через Yandex ID/OAuth;
- будущие POP3-oriented flows.

Compatibility provider:

- Gmail API через `gmail_api`.

Planned / unsupported provider:

- Microsoft 365/Exchange native через future `exchange` provider value. Current Outlook/Microsoft OAuth setup is IMAP/SMTP compatibility, not this native provider.

Gmail скрыт в provider picker по умолчанию. Он показывается только при `VITE_ENABLE_GMAIL_PROVIDER=true`.

## Capability profiles

Capability definitions:

```text
src/services/email/providerCapabilities.ts
```

Provider contract:

```text
src/services/email/types.ts
```

Текущий mapping:

| Account provider value | Capability profile |
| --- | --- |
| `gmail_api` | Gmail API capabilities |
| `caldav` | calendar-only mail-disabled capabilities |
| `exchange` | native Exchange/Graph planned but unsupported capabilities |
| `imap` | IMAP-compatible capabilities |
| `imap_smtp` | IMAP-compatible capabilities |
| `yandex`, `yandex_oauth` | IMAP-compatible capabilities |
| `pop`, `pop3` | IMAP-compatible capabilities |
| `null`, unknown, legacy values | IMAP-compatible capabilities |

Только explicit `gmail_api` accounts получают native Gmail label capabilities.

Только explicit `exchange` accounts получают unsupported Exchange profile. Это guardrail: future/native Exchange rows не должны silently fall back to IMAP behavior.

## Microsoft 365 / Exchange status

Current supported path:

- Outlook/Hotmail/Live mail through Microsoft OAuth over IMAP/SMTP.
- OAuth scopes use `outlook.office.com` IMAP/SMTP permissions.
- This path is compatibility mail access, not native Exchange/Graph.

Planned/unsupported until a dedicated adapter exists:

- Native Exchange Online/Microsoft 365 mail through Graph.
- Shared mailboxes.
- Send-as/delegated mailbox flows.
- Exchange calendar sync.
- Exchange contacts sync.

## Contacts directories

Address Book directories are separate from mail provider capabilities:

- Local and collected contacts are always available.
- CardDAV directories are user-configured and sync vCard data through `tsdav`; they are not implied by an IMAP account.
- LDAP directories are read-only in EPIC-13 and expose configuration, backend reachability test, and bounded search through the desktop backend.
- Native Microsoft Graph/Yandex360 contacts sync remains planned/unsupported unless the user configures a compatible CardDAV endpoint.

Provider UI must not imply Exchange/Graph/Yandex organization-wide contacts are available through normal mail account setup.

Strategic decision:

- Future Exchange Online/Microsoft 365 native support is Graph-first.
- EWS is deferred to future on-premises or legacy exceptions.

## Gmail-native labels

IMAP/Yandex accounts не должны показывать Gmail-native label UX по умолчанию.

Скрыто для IMAP/Yandex:

- sidebar `Labels` section;
- sidebar add/edit label controls;
- settings `Labels`;
- settings `Smart Labels`;
- context menu `Apply Label`;
- command palette label actions;
- keyboard shortcut label execution;
- drag-and-drop label moves;
- filter/quick-step label action choices.

Разрешено для IMAP/Yandex:

- provider folders;
- `Move to Folder`;
- folder create/rename/delete через provider folder API, если server принимает IMAP command;
- folder subscribe/unsubscribe через IMAP `SUBSCRIBE`/`UNSUBSCRIBE`;
- quota visibility через IMAP `GETQUOTAROOT`, если server advertises `QUOTA`;
- archive/trash/star/mark read/spam actions where supported;
- smart folders как saved searches;
- categories и rule-based categorization, если они не требуют native Gmail labels.

## IMAP folders

IMAP/Yandex folders используют raw IMAP path для server-side operations. Display name/path нужны только для UI.

Folder metadata:

- `rawPath` / `imap_folder_path` — command-safe mailbox path;
- `specialUse` / `imap_special_use` — special folder mapping для Inbox, Sent, Drafts, Trash, Junk, Archive;
- `subscribed` — результат `LSUB`;
- `selectable` и `hasChildren` — folder list attributes;
- `quota` — best-effort result from `GETQUOTAROOT`.

Rules:

- System and special-use folders нельзя rename/delete из app service layer.
- Retention policy пока unsupported: providers expose reason instead of a fake value.
- Если server не advertises `QUOTA` или не возвращает quota root для folder, UI/service consumers show quota unavailable, not fatal provider failure.
- `Move to Folder` для IMAP uses `imap_folder_path`, not synthetic local label IDs like `folder-...`.

## Smart folders references

Saved searches поддерживают stable references:

- `labelid:<id>` для Gmail/native label IDs;
- `folderpath:<rawPath>` для IMAP raw folder paths;
- legacy `label:<name>` продолжает работать по имени label.

Operator-only saved searches with `labelid:` and `folderpath:` execute through structured local SQL, not FTS fallback. Это важно для saved views без free text: они фильтруют по стабильной ссылке даже без обычного поискового текста.

При app-driven rename Velo rewrites matching saved references. При delete Velo marks affected smart folders as `missing_reference`; sidebar показывает warning indicator and title reason вместо silent wrong results.

## Service enforcement

UI hiding недостаточно. Service entry points также должны reject unsupported actions.

Текущее enforcement:

- `src/services/emailActions.ts` проверяет capabilities до optimistic updates, local DB updates, provider calls и offline queue writes.
- `src/stores/labelStore.ts` rejects unsupported label CRUD до Gmail client access.
- `src/services/email/imapSmtpProvider.ts` gates destructive special-folder rename/delete and calls IMAP folder commands.
- `src/services/email/providerFactory.ts` создаёт `GmailApiProvider` только для explicit `gmail_api`.
- `src/services/email/providerFactory.ts` rejects explicit `exchange` accounts until native Exchange/Graph adapter exists.
- Если queued provider action больше не поддерживается или требует user action, queue processor переводит operation в `blocked`/`failed` с diagnostic вместо silent drop.

## Smoke checklist

Проверить на Yandex/IMAP account:

1. Account picker показывает Yandex ID, IMAP/SMTP и CalDAV; Gmail hidden by default.
2. Sidebar не показывает `Labels`, даже если в local DB есть old label rows.
3. Right-click по thread не показывает `Apply Label`.
4. Settings не показывают `Google API`, `Labels` или `Smart Labels`.
5. Filter и Quick Step editors не предлагают label actions.
6. `Move to Folder` остаётся доступным.
7. `Move to Folder` sends raw `imap_folder_path`.
8. Folder create/rename/delete works on a test user folder and is blocked for special folders.
9. Subscribe/unsubscribe toggles test folder state after refresh.
10. Quota is shown when server supports `QUOTA`; otherwise unavailable reason is visible.
11. Archive, trash, star, mark read, send и sync flows работают.
12. Smart folder with `folderpath:<rawPath>` is marked missing when that folder is deleted.

Проверить Microsoft/Exchange guardrails:

1. Account picker shows IMAP/SMTP as the Microsoft OAuth compatibility path for Outlook.
2. Account picker does not show Microsoft 365/Exchange as a provider choice until an adapter exists.
3. Microsoft OAuth setup says it connects through IMAP/SMTP.
4. Native Exchange/Graph, shared mailboxes, Exchange calendar and contacts are not presented as available.
5. `getCapabilitiesForAccountProvider("exchange")` returns unsupported Exchange capabilities, not IMAP.
6. `getEmailProvider` rejects an `exchange` account with a clear unsupported message.

Проверить на explicit `gmail_api` account, если Gmail включён:

1. Native labels visible.
2. Label CRUD works.
3. `Apply Label` available.
4. Label actions capability-gated and tested.
