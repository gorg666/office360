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

### CAL-BUG-101 — closed by CAL-101B

`CalendarPage.loadEvents()` теперь использует явные взаимоисключающие состояния `loading | fresh | stale | error` для Google и CalDAV/Yandex. Успешный remote load переводит UI в `fresh` и очищает прежние ошибки. Remote failure при наличии событий текущего диапазона из локального cache сохраняет их на экране и показывает `Не удалось обновить календарь` / `Показаны ранее загруженные данные`; доступен безопасный Retry. При отсутствии пригодного cache показывается явный error state, а не пустой успешный календарь. Исходные provider error messages не выводятся пользователю и не логируются этим load path.

Текущая схема не хранит range-level cache-completeness marker, поэтому пустой DB result считается отсутствием пригодного cache. Это ограничение документировано и не требует изменения DB schema в CAL-101B.

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

### CAL-101B final validation

Дата: 2026-08-21 (Asia/Bangkok). Проверка выполнена в `npm run tauri dev` только read-only навигацией; реальные события и настройки аккаунта не изменялись.

| Проверка | Статус | Наблюдение |
|---|---|---|
| Month | PASS | События отобразились; переход на следующий месяц с повторной загрузкой завершился без ложного stale/error banner |
| Week | PASS | Week time-grid отрендерировался, навигация между диапазонами сработала, remote load завершился без ложного stale/error banner |
| Day | PASS | Day time-grid отрендерировался, навигация по датам сработала, remote load завершился без ложного stale/error banner |
| Calendar load: fresh state | PASS | После успешных remote loads отсутствовали loading, stale, error и cached-data warning; это наблюдаемый эквивалент `CalendarLoadState = fresh` |
| Stale/error automated coverage | PASS | Targeted cases A–D покрывают success, cache + failure, no-cache failure и Retry для Google/CalDAV |
| Stale/error live forcing | NOT FORCED | Безопасного способа нет: вмешательство в live provider/credentials не оправдано при наличии автоматического покрытия |

## Checks

Финальные build/test результаты фиксируются после удаления временной instrumentation и перечислены в итоговом CAL-101A отчёте. Общий `cargo fmt --check` имеет существующий repo-wide formatting debt; изменённый Rust-файл проверяется отдельно.
