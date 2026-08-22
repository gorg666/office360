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

### CAL-BUG-103 — closed by CAL-101C

`CalDAVProvider` теперь владеет общей session на стабильный ключ `caldav + account.id`. Session повторно используется, пока credential snapshot остаётся актуальным и OAuth token не вошёл в существующий пятиминутный refresh buffer. Изменение credential, expiry или явная invalidation приводит к recreation; неуспешное создание очищает pending state.

Создание session защищено single-flight как внутри provider, так и при конкурентном создании самого provider в `providerFactory`. Это устраняет обнаруженную runtime race, при которой параллельные initial operations могли получить два `CalDAVProvider` и выполнить два login/discovery. Явный `401` и auth-related `403` инвалидируют session и допускают один controlled retry через существующий credential refresh path. Permission-only `403`, network/application errors и допустимый initial DAV probe `404` не вызывают auth retry.

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

### CAL-101C session lifecycle validation

Дата: 2026-08-21 (Asia/Bangkok). Проверка выполнена в `npm run tauri dev` с включёнными безопасными session diagnostics; значения credentials, account IDs, DAV URLs, calendar names и event data не логировались.

| Проверка | Статус | Наблюдение |
|---|---|---|
| Calendar open / Month | PASS | Remote calendars и events загрузились без error/stale banner |
| Week / Day | PASS | Оба time-grid view завершили remote load без error/stale banner |
| Calendar list | PASS | Список remote calendars доступен |
| Session requests / provider operations | PASS | 6 обращений к session lifecycle |
| Session creation | PASS | 1 создание, следовательно 1 login/discovery chain |
| Concurrent single-flight | PASS | 1 конкурентный caller присоединился к уже начатому созданию |
| Subsequent reuse | PASS | 4 cache hits после создания |
| Expiry/auth-failure forcing | NOT FORCED | Реальные credentials намеренно не инвалидировались; сценарии покрыты автоматическими тестами |

Промежуточный smoke до защиты `providerFactory` показал 2 session creations и тем самым выявил конкурентное создание двух provider instances. После исправления fresh reload дал итоговые counts `creation=1`, `single-flight reuse=1`, `cache hit=4`. Повторные provider calls в одной валидной session больше не выполняют повторный login/discovery.

### CAL-102 time semantics and migration validation

Дата: 2026-08-22 (Asia/Bangkok). Migration gate владельцем подтверждён. Запущен `npm run tauri dev`; v34 применена только к локальной development SQLite DB. Production, deploy, seed/reset и cloud event mutations не выполнялись.

| Проверка | Статус | Наблюдение |
|---|---|---|
| Migration v34 | PASS | `_migrations.version=34`; присутствуют все 10 additive semantic columns |
| Fresh/existing SQLite | PASS | Отдельный in-memory smoke подтвердил fresh schema, сохранность existing row, legacy defaults и semantic new-row round-trip |
| Legacy compatibility | PASS | Migration не обновляет строки; repository lazy projection покрыта тестом. До normal sync local DB содержала 3 legacy rows |
| New semantic write | PASS | После обычного read-only Yandex Month sync те же 3 cache rows имели `time_kind`; никаких массовых backfill/update в migration нет |
| Month | PASS | Yandex events отобразились; remote refresh завершился без stale/error banner |
| Week | PASS | Time grid и существующее timed event отобразились; remote refresh path не показал ошибку |
| Day | PASS | Day grid загрузился, loading state завершился без stale/error banner |
| Calendar list | PASS | Remote calendar list раскрылся и показал две доступные коллекции |
| All-day live fixture | NOT AVAILABLE | Реальный cloud event не создавался; exclusive-date rendering/filtering покрыты provider conformance и UI projection tests |
| Google live account | NOT AVAILABLE | Google mapping/read/write contracts покрыты provider tests; shared UI regression покрыт full Vitest |

TZ-pinned matrix запускалась отдельным Vitest process при `TZ=UTC`, `Europe/Moscow`, `America/New_York`, `Australia/Lord_Howe`: в каждом процессе 25/25 domain/time tests passed. Full Vitest: 200 files, 2014 tests passed. Production build и `cargo check` passed; два существующих unused-variable Rust warnings не связаны с CAL-102.

### CAL-102F review fixes

Дата: 2026-08-22 (Asia/Bangkok). Malformed CalDAV/VEVENT reads теперь изолируются на уровне объекта и компонента; valid siblings сохраняются, а `fetchEvents` и `syncEvents` агрегируют одинаковые безопасные diagnostics. Fresh degraded read получает отдельный UI notice и не удаляет уже кешированный диапазон. Recurrence range lookback теперь равен `max(3 days, event duration)`, с exclusive overlap boundary.

Автоматические проверки: targeted Calendar/provider/UI — 85/85; `npm run test:calendar-tz` — 33/33 в каждой из `UTC`, `Europe/Moscow`, `America/New_York`, `Australia/Lord_Howe`; full Vitest — 200 files / 2025 tests; TypeScript, production build и `cargo check` — PASS. Read-only Tauri smoke: Month показал существующие Yandex events, Week — существующее timed event, Day и calendar list (две коллекции) загрузились без stale/error. Реальные cloud events не изменялись.

### CAL-103 iCalendar codec validation

Дата: 2026-08-22 (Asia/Bangkok). `ical.js` 2.2.1 (MPL-2.0) установлен exact-version dependency и изолирован в Calendar codec. Production parser/serializer/update paths больше не используют handwritten content-line parser, regex property replacement или manual escaping.

| Проверка | Статус | Наблюдение |
|---|---|---|
| Calendar open / Month | PASS | Yandex events отобразились после remote refresh без error/stale/degraded notice |
| Week | PASS | Существующее timed event отобразилось; refresh завершился без parser warning |
| Day | PASS | Day grid загрузился, loading state завершился без error/stale banner |
| Calendar list | PASS | Открылись две Yandex collections; visibility не изменялась |
| Existing recurrence | NOT CONFIRMED | В доступном текущем диапазоне визуально подтверждён timed event, но достоверно recurring live fixture не идентифицирован; recurrence covered by codec/provider tests |
| Cloud mutations | NOT PERFORMED | Create/update/delete/RSVP не выполнялись |
| Parser diagnostics | PASS | На текущих нормальных Yandex данных новых unreadable/degraded notices не было; raw ICS не логировался |

Автоматические проверки: targeted Calendar + legacy DB — 13 files / 184 tests; codec fixtures — 12 semantic tests; `npm run test:calendar-tz` — 45/45 в каждой из `UTC`, `Europe/Moscow`, `America/New_York`, `Australia/Lord_Howe`; full Vitest — 201 files / 2037 tests; TypeScript, production build и `cargo check` — PASS. Production main chunk: 2,008.36 kB raw / 598.94 kB gzip, delta к CAL-102F baseline +82.48 kB raw / +23.95 kB gzip. Build сохранил прежние chunk warnings и добавил non-fatal browser-externalized `stream` warning от transitive `sax`; runtime Calendar path загрузился успешно.

### CAL-104 sync/cache reconciliation validation

Дата: 2026-08-22 (Asia/Bangkok). Migration gate v35 подтверждён владельцем. Append-only v35 применена только к локальной development SQLite DB во время `npm run tauri dev`; production, deploy, seed/reset/delete, массовый backfill и cloud event mutations не выполнялись.

| Проверка | Статус | Наблюдение |
|---|---|---|
| Migration v35 | PASS | `_migrations.version=35`; присутствуют `origin`, `projection_key`, `projection_status` и 10-колоночная `calendar_sync_coverage` |
| Fresh/existing SQLite | PASS | In-memory verifier подтвердил fresh DB, сохранность legacy row и coverage round-trip без destructive SQL |
| Runtime semantic rows | PASS | Агрегатная read-only проверка: 3 event rows с `origin=remote`, legacy-null отсутствует после обычного fetch |
| Runtime coverage | PASS | 6 complete-range records; event payloads и account/calendar identifiers не читались |
| Month / Week / Day | PASS | Все три представления завершили Yandex refresh без stale/error banner |
| Calendar list/switch | PASS | Две collections отобразились; secondary visibility переключена и восстановлена в исходное состояние |
| Refresh/cache recovery | PASS | F5 refresh завершился, Calendar state и исходная visibility сохранились |
| Account switch | AUTOMATED | В runtime доступен один Calendar account; stale account/range response fencing покрыт UI race tests |
| Cloud mutations | NOT PERFORMED | Create/update/delete/RSVP не выполнялись |

CAL-104 вводит единый cache-first orchestration path, range-level coverage (`never-synced | partial | complete`), authoritative bounded reconciliation и non-destructive degraded reconciliation. Google page-token fetch покрыт полностью; generic CalDAV явно объявляет `range-refresh`. Optimistic RSVP projections имеют стабильный ключ и удаляются при unsupported delivery. Ограничения: coverage intervals пока не объединяются; durable Google sync-token persistence и CalDAV sync-collection/ctag deltas остаются следующим provider-readiness этапом.

Автоматические проверки: TypeScript PASS; targeted Calendar/provider/UI — 13 files / 163 tests; `npm run test:calendar-tz` — 45/45 в каждой из `UTC`, `Europe/Moscow`, `America/New_York`, `Australia/Lord_Howe`; full Vitest — 203 files / 2055 tests; migration v34+v35 verifier PASS; production build и `cargo check` PASS. Production main chunk: 2,015.17 kB raw / 600.56 kB gzip; прежнее предупреждение о chunk size остаётся. Rust-код не менялся; два существующих unused-variable warning не относятся к CAL-104.

### CAL-105 provider/write readiness validation

Дата: 2026-08-22 (Asia/Bangkok). Реальные Calendar write operations не выполнялись. Google/CalDAV create, update, delete, RSVP, recurrence scope и ETag behavior проверены mock/fixture tests; Yandex acceptance ограничена разрешённым read-only Tauri smoke.

CAL-105 вводит capability contract v2 и единый `CalendarMutationService`. Create/update/delete/RSVP возвращают provider-neutral typed result; raw provider bodies не попадают в UI. React controls используют capabilities. CalDAV/Yandex `single` occurrence delete блокируется до provider call, потому что occurrence и series используют один `.ics` resource. Google/CalDAV ETag передаётся в conditional update/delete/RSVP там, где cache имеет ETag. После remote success UI вызывает только CAL-104 range reconciliation; manual event upsert/delete удалены.

Mail RSVP queue не имеет remote calendar/resource identity, поэтому outbound RSVP остаётся terminal unsupported: provisional projection удаляется, item блокируется без retry. Provider-native invitation/iTIP, Free/Busy, ACL, reminders, durable Google sync-token storage и CalDAV delta sync не заявлены как поддерживаемые.

| Runtime check | Status | Observation |
| --- | --- | --- |
| Provider capability resolution | PASS | Yandex/CalDAV profile resolved; Create control remained enabled; no method-presence fallback was used |
| Month | PASS | Existing Yandex events rendered after refresh without error/stale banner |
| Week | PASS | Week grid and existing event rendered after refresh without error/stale banner |
| Day | PASS | Day grid completed refresh without error/stale banner |
| Calendar list | PASS | Two Yandex collections were listed; visibility was not changed |
| Cloud mutations | NOT PERFORMED | Create/update/delete/RSVP controls were not invoked |

Автоматические проверки: TypeScript PASS; targeted Calendar/provider/queue/UI — 13 files / 215 tests; `npm run test:calendar-tz` — 45/45 в каждой из `UTC`, `Europe/Moscow`, `America/New_York`, `Australia/Lord_Howe`; full Vitest — 205 files / 2071 tests; production build и `cargo check` PASS. Production main chunk: 2,016.23 kB raw / 601.02 kB gzip; existing chunk/externalized-stream warnings remain. Rust code не менялся; два существующих unused-variable warning не относятся к CAL-105. Migration не требовалась и не запускалась.

## Checks

### CAL-106 participant-domain validation

Дата: 2026-08-22 (Asia/Bangkok). Participant identity, organizer, required/optional roles, five response states, RSVP flag, individual/group/room/resource types, delegation and deterministic duplicate merge are centralized in the Calendar domain. Google and CalDAV use the same event attendee contract. Existing attendee JSON arrays are read lazily, while normal provider writes persist a versioned envelope in the existing column; no migration or backfill is used and the range load remains query-per-range rather than query-per-attendee.

No real invitations, events or RSVP mutations were performed for this ticket.

| Проверка | Статус | Наблюдение |
|---|---|---|
| Tauri startup | PASS | Подтверждено в сессии 2026-08-22 до прерывания Computer Use |
| Month | PASS | Yandex read-only refresh завершился без stale/error banner |
| Event details | PASS | Существующее Yandex-событие открылось, участники отрисованы |
| Organizer (визуально) | PASS | Организатор отображён отдельно от списка участников |
| Optional attendee (визуально) | PASS | Роль «необязательно» отображена в чипе участника |
| Week | **NOT COMPLETED** | Пользователь остановил Computer Use; в последующей сессии dev-сборка Tauri не разрешается allowlist'ом автоматизации (окно не является установленным приложением) |
| Day | **NOT COMPLETED** | То же ограничение |
| Mail live invitation | NOT AVAILABLE | Fixture без внешней мутации отсутствует; автоматическая регрессия PASS |

Week/Day остаются незакрытыми именно как **live** проверки. Изменения CAL-106 не затрагивают `WeekView.tsx` и `DayView.tsx`; затронут общий путь разбора участников и `EventDetailModal`. Поэтому поведение, которое подтверждал бы этот smoke, покрыто автоматически: `EventDetailModal.test.tsx` рендерит канонический envelope (организатор, роль «необязательно»), разрешает текущего пользователя как участника с предвыбранным ответом, и проверяет, что legacy-массив и повреждённый JSON не ломают карточку события. Это не заменяет live-подтверждение и не записывается как PASS.

Автоматические проверки CAL-106: TypeScript PASS; targeted Calendar/participant/invitation/UI — 9 files / 78 tests; full Vitest — 206 files / 2080 tests; `npm run test:calendar-tz` — 45/45 в каждой из `UTC`, `Europe/Moscow`, `America/New_York`, `Australia/Lord_Howe`; production build PASS; `cargo check` PASS с двумя прежними unrelated warnings. Rust не менялся. Migration не требовалась и не запускалась.

Финальные build/test результаты фиксируются после удаления временной instrumentation и перечислены в итоговом CAL-101A отчёте. Общий `cargo fmt --check` имеет существующий repo-wide formatting debt; изменённый Rust-файл проверяется отдельно.
