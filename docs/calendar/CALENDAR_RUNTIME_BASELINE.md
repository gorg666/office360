# CAL-101A — Calendar runtime baseline

Дата: 2026-08-21 (Asia/Bangkok)
Исходная база: `GORGDEV2-EFIM-INTEGRATION` @ `10c7a54fb8eb6c36c8e70bc0628b100405189bae`
Итог: **PASS** для read-only Yandex CalDAV chain; remote mutations намеренно не выполнялись.

## Безопасность проверки

- Запущен только `npm run tauri dev`; deploy, migration, seed и production runtime не затрагивались.
- Временная response-level instrumentation выводила только operation/method/endpoint category/status/content type/error category/retry и была удалена после smoke.
- Authorization, token values, cookies, passwords, raw ICS, private DAV URLs, account IDs, emails, calendar names и event titles не сохранялись.
- `[REDACTED SECRET-LIKE FILE]` не открывался.
- Create/update/delete/RSVP не выполнялись на реальном cloud account.

## Yandex runtime chain

| Layer | Status | HTTP/runtime evidence |
|---|---|---|
| Account resolution | PASS | Active account загружен; provider распознан как Yandex OAuth; `CalDAVProvider` выбран |
| Credential resolution | PASS | Source=`account-oauth`; access/refresh credentials present; значения не читались |
| OAuth | PASS | `DAVClient.login()` с Yandex `OAuth` authorization завершён успешно; Bearer fallback не понадобился |
| Refresh | NOT APPLICABLE | Expiry metadata=`valid`; `ensureFreshToken()` вернул действующий access token, refresh не форсировался |
| Principal discovery | PASS | `PROPFIND` server-root → `207 text/xml`, `current-user-principal` распознан |
| calendar-home-set | PASS | `PROPFIND` discovered DAV resource → `207 text/xml` |
| Collections | PASS | Collection `PROPFIND` и `supported-report-set` → `207 text/xml`; UI получил коллекции без XML error |
| Event query | PASS | `REPORT calendar-query` и последующие DAV `REPORT` → `207 text/xml` |
| ICS parse | PASS | Ответы прошли `fetchCalendarObjects()` → `parseVEventsInRange()` без parse error |
| Mapping | PASS | Provider events прошли Calendar DB mapping; private values не инспектировались |
| UI render | PASS | Month/Day/Week controls и event pipeline отрендерены после fresh remote query |

## Response-level evidence

| Operation | Method | Endpoint category | Status | Content-Type | DAV/application error | Retry |
|---|---|---|---:|---|---|---|
| Initial collection probe | PROPFIND | dav-resource | 404 | text/html | `http-404`; probe URL не является коллекцией | tsdav продолжил discovery от server root |
| current-user-principal | PROPFIND | server-root | 207 | text/xml | none | none |
| calendar-home-set | PROPFIND | dav-resource | 207 | text/xml | none | none |
| Collection enumeration | PROPFIND | dav-resource | 207 | text/xml | none | none |
| supported-report-set | PROPFIND | dav-resource | 207 | text/xml | none | none |
| calendar-query | REPORT | dav-resource | 207 | text/xml | none | none |
| Calendar object query | REPORT | dav-resource | 207 | text/xml | none | none |

Наблюдавшийся `404 text/html` — не auth failure и не финальный Calendar error. Это ранний probe по DAV resource внутри `tsdav` discovery; цепочка продолжает server-root discovery и завершается `207` на principal/home/collections/query. `401`, `403`, `405`, `409`, `5xx`, timeout, TLS error и XML parse error в smoke не наблюдались.

## Root cause / historical A2

Прежняя формулировка «Yandex CalDAV remote path PARTIAL» была следствием недостаточной observability: native log показывал соединения, но не response status и не отличал probe `404` от terminal failure. Response-level trace доказала рабочий OAuth CalDAV path. Historical A2/CAL-001 в текущей сессии **не воспроизведён и закрыт для baseline**; его вероятный внешний/credential episode нельзя ретроспективно доказать по текущим данным.

## Bugs

### CAL-BUG-101 — confirmed

Original DAV/tsdav error возникает в `loginYandexCalDavClient()` либо в `CalDAVProvider.listCalendars()` / `fetchEvents()`. `CalendarPage.loadEvents()` ловит ошибку; специальные Google 403 cases преобразуются в UI state, а прочие ошибки уходят только в `console.error`. Frontend сохраняет cached events, пользователь не получает stale/remote-failure marker. UX fix остаётся отдельной задачей.

### CAL-BUG-102 — closed

Native `connect_imap_with_diagnostic()` и `imap_test_connection()` передавали `config.username` в runtime log. Добавлен минимальный `redact_log_identifier()` с тестами; runtime smoke подтвердил `username=[redacted]`. Calendar/IMAP behavior не менялся.

### CAL-BUG-103 — confirmed

`CalDAVProvider.getClient()` не cache-ит Yandex OAuth client: `listCalendars()` и каждый `fetchEvents()` создают client и повторяют login/discovery. Runtime remount показал параллельные initial calls и дополнительные credential/login/query sequences. Это усиливает latency и flakiness, но не вызвало текущий failure. Рекомендация: token-expiry-aware shared/session client с bounded re-login и single-flight creation.

## Desktop smoke

| Проверка | Статус |
|---|---|
| Tauri startup | PASS |
| Calendar route | PASS |
| Month / Day / Week | PASS |
| Read-only remote list/query | PASS |
| Create/update/delete/RSVP | NOT TESTED — реальные cloud data не изменялись |

## Checks

Финальные build/test результаты фиксируются после удаления временной instrumentation и перечислены в итоговом CAL-101A отчёте. Общий `cargo fmt --check` имеет существующий repo-wide formatting debt; изменённый Rust-файл проверяется отдельно.
