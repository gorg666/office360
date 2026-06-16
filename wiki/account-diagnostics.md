# Account Diagnostics and Repair Center

Office360 нормализует ошибки аккаунтов в `ConnectionDiagnostic`, чтобы onboarding, sync, outbox, calendar и support bundle flows показывали одну модель причины и действия.

## Контракт

Основной contract живёт в:

```text
src/services/diagnostics/
```

Persisted latest diagnostics живут в SQLite table:

```text
account_diagnostics
```

Запись хранится как latest state для `account_id + layer + operation`, а не как бесконечный лог. Это снижает privacy risk и оставляет Repair Center актуальным после restart.

Поддерживаемые layers:

- `oauth`;
- `imap`;
- `smtp`;
- `gmail_api`;
- `caldav`;
- `database`;
- `network`;
- `provider`.

Ключевые user actions:

- `retry`;
- `reauth`;
- `edit_settings`;
- `check_password`;
- `check_tls`;
- `wait`;
- `contact_admin`;
- `export_debug`.

## Account Repair Center

Route:

```text
/repair
/repair/$accountId
/queue
```

Entry points:

- sync error toast;
- Settings > Accounts > Repair;
- direct route for support checks.

Repair Center показывает account health summary, diagnostic cards by layer, retry state, reason, debug code, last update time и sanitized details collapsed by default.

Queue Inspector показывает background/offline операции из `pending_operations` без raw payload:

- `pending` - операция ждёт выполнения;
- `executing` - операция выполняется сейчас;
- `retry_scheduled` - операция ждёт `next_retry_at`;
- `failed` - операция упала permanent или исчерпала retries;
- `blocked` - нужен user action: re-auth, settings, retry или debug export;
- `cancelled` - пользователь отменил операцию, processor её не исполняет.

Inspector использует redacted DTO и не показывает `rawBase64Url`, raw MIME, body, tokens, passwords, OAuth secrets или auth headers. Outbox использует тот же queue state для `sendMessage`, но остаётся отдельным send-focused view.

Back navigation внутри `/settings`, `/repair` и `/queue` иерархическая: стрелка со второго уровня возвращает на предыдущий settings-related экран, а с первого уровня выходит на route, из которого пользователь открыл настройки/диагностику.

## Sync health

Account sync health агрегируется из:

- online/offline state;
- queue summary по аккаунту;
- latest `account_diagnostics`;
- last successful sync timestamp из account state;
- текущего sync status callback.

Health states:

- `healthy`;
- `syncing`;
- `queued`;
- `degraded`;
- `failed`;
- `offline`.

Auth failures (`expired_token`, `invalid_credentials`, `missing_scope`) ведут к failed/blocked health и re-auth/check-password action. Provider/network failures ведут к degraded/failed state. Local database failures показываются отдельно как local DB failure. IMAP UIDVALIDITY reset сохраняется как warning diagnostic и запускает безопасный folder resync вместо silent data loss.

## Provider behavior

- IMAP и SMTP failures показываются отдельно.
- OAuth refresh failure сохраняется как `oauth.refresh` и ведёт к re-auth.
- TLS/certificate failure классифицируется как `tls_failed`, не как wrong password.
- Retryable failures получают `retryState` и остаются compatible с outbox queue.
- CalDAV test/sync failures сохраняются как `caldav`.
- Yandex 360 work account missing scopes (`mail:imap_full`, `mail:smtp`, `calendar:all`) ведут к `missing_scope` и `reauth`.
- Yandex provider 403/tariff/permission failures показываются как limited provider capability, not as a prompt for raw admin tokens.
- Yandex provider 429 остаётся retryable `rate_limited`.

## Privacy-safe support bundle

Support bundle создаёт локальный JSON package и не отправляет его автоматически. Это первый slice EPIC-11: troubleshooting export для support/QA без Thunderbird import/export, backup/restore или remote telemetry.

Schema v2 (`SupportDebugBundle`) включает:

- `schemaVersion: 2` и `exportedAt`;
- app metadata: name, version, Tauri version, platform, arch, WebView when available;
- scope: optional `accountId`, `includeQueue: true`, `includeDiagnostics: true`;
- sanitized account id/email/provider/auth/server summary;
- persisted `ConnectionDiagnostic[]`;
- account sync health summary;
- latest redacted Queue Inspector items, limited by the service default;
- optional summarized `SecurityWarning[]`.

Support bundle save flow:

- desktop app opens a Tauri save dialog and writes JSON to the selected path;
- browser preview falls back to Blob download;
- UI shows saved path or fallback status;
- Settings > About exposes all-account export;
- Account Repair Center exposes account-scoped export and keeps it available even when no diagnostics exist.

Bundle не должен включать:

- access/refresh/id tokens;
- passwords или app passwords;
- OAuth client secrets;
- auth headers;
- raw Yandex API responses;
- raw message bodies;
- raw MIME;
- raw `pending_operations.params`;
- full local database dumps.

Legacy `DebugBundle` schema v1 remains as compatibility service API, but new UI entry points use `SupportDebugBundle` schema v2.

## Smoke checklist

1. Для IMAP account сломать incoming settings и убедиться, что Repair Center показывает `imap` diagnostic.
2. Для IMAP account сломать SMTP port/auth и убедиться, что diagnostic layer отличается от IMAP.
3. Для OAuth-backed account expired/invalid token ведёт к re-auth action.
4. TLS/certificate текст классифицируется как `tls_failed` и предлагает проверить TLS.
5. Sync error toast открывает `/repair/$activeAccountId`.
6. Settings > Accounts > Repair открывает Repair Center для выбранного аккаунта.
7. Export support bundle создаёт JSON без tokens/passwords/raw mail.
8. Queue Inspector `/queue` показывает failed/blocked/pending операции без raw MIME/secrets.
9. Failed Outbox send можно retry/cancel, cancel переводит operation в `cancelled`.
10. UIDVALIDITY warning виден в health/diagnostics после folder resync.
