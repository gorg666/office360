# Account Diagnostics and Repair Center

Office360 нормализует ошибки аккаунтов в `ConnectionDiagnostic`, чтобы onboarding, sync, outbox, calendar и support/debug flows показывали одну модель причины и действия.

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
```

Entry points:

- sync error toast;
- Settings > Accounts > Repair;
- direct route for support/debug checks.

Repair Center показывает account health summary, diagnostic cards by layer, retry state, reason, debug code, last update time и sanitized details collapsed by default.

## Provider behavior

- IMAP и SMTP failures показываются отдельно.
- OAuth refresh failure сохраняется как `oauth.refresh` и ведёт к re-auth.
- TLS/certificate failure классифицируется как `tls_failed`, не как wrong password.
- Retryable failures получают `retryState` и остаются compatible с outbox queue.
- CalDAV test/sync failures сохраняются как `caldav`.

## Privacy-safe debug export

Debug export создаёт локальный JSON bundle и не отправляет его автоматически.

Bundle может включать:

- app name/version;
- account id/email/provider/settings summary;
- persisted diagnostics;
- debug code;
- sanitized raw cause.

Bundle не должен включать:

- access/refresh/id tokens;
- passwords или app passwords;
- OAuth client secrets;
- raw message bodies;
- raw MIME;
- full local database dumps.

## Smoke checklist

1. Для IMAP account сломать incoming settings и убедиться, что Repair Center показывает `imap` diagnostic.
2. Для IMAP account сломать SMTP port/auth и убедиться, что diagnostic layer отличается от IMAP.
3. Для OAuth-backed account expired/invalid token ведёт к re-auth action.
4. TLS/certificate текст классифицируется как `tls_failed` и предлагает проверить TLS.
5. Sync error toast открывает `/repair/$activeAccountId`.
6. Settings > Accounts > Repair открывает Repair Center для выбранного аккаунта.
7. Export debug создаёт JSON без tokens/passwords/raw mail.
