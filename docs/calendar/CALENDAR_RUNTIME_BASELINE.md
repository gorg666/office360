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
| Week | PASS | Week time-grid загрузился без ошибки; существующие Yandex-события отобразились; карточка существующего события с участниками открылась (организатор, список участников, RSVP UI без поломки). Cloud mutations: NONE |
| Day | PASS | Day time-grid загрузился; существующее событие отобразилось; карточка открылась с организатором, участниками и RSVP UI без поломки. Cloud mutations: NONE |
| Mail live invitation | NOT AVAILABLE | Fixture без внешней мутации отсутствует; автоматическая регрессия PASS |

Live Week/Day smoke выполнен 2026-08-22 (Asia/Bangkok) на уже запущенной dev-сборке `feat/calendar-yandex360` (read-only). На открытом live-событии роль «необязательно» в чипе не присутствовала; optional attendee остаётся подтверждённым Month smoke + `EventDetailModal.test.tsx`. Создавать fixture запрещено тикетом. RSVP, create/edit/delete не выполнялись.

Автоматические проверки CAL-106: TypeScript PASS; targeted Calendar/participant/invitation/UI — 9 files / 78 tests; full Vitest — 206 files / 2080 tests; `npm run test:calendar-tz` — 45/45 в каждой из `UTC`, `Europe/Moscow`, `America/New_York`, `Australia/Lord_Howe`; production build PASS; `cargo check` PASS с двумя прежними unrelated warnings. Rust не менялся. Migration не требовалась и не запускалась.

### CAL-107 Free/Busy foundation validation

Дата: 2026-08-22 (Asia/Bangkok). Миграция не создавалась и не запускалась; cloud events не изменялись.

**Runtime risk surface.** CAL-107 не подключён ни к одному runtime-пути: `grep` по `src/` подтверждает, что модули `src/services/calendar/freeBusy/` не импортируются ни одним production-файлом, и что `capabilities.freeBusy` не читается ни в одном компоненте или сервисе. Изменения, видимые приложению, сводятся к форме capability-контракта (`version: 3`, `freeBusy` разделён на `self`/`others`) и двум литералам в провайдерах. `CalendarPage`, `MonthView`, `WeekView`, `DayView`, `EventDetailModal`, sync- и mutation-сервисы не менялись.

| Проверка | Статус | Наблюдение |
|---|---|---|
| Month / Week / Day / Yandex read (live) | NOT RE-RUN | Dev-сборка Tauri не разрешается allowlist'ом автоматизации (окно не является установленным приложением) — то же ограничение, что фиксировалось для CAL-106 |
| Регрессия календарных view | NOT EXPECTED | Ни один view/сервис не изменён; Free/Busy не имеет UI и не вызывается из runtime |
| Автоматическая регрессия календаря | PASS | Full Vitest 209 files / 2120 tests, включая CalendarPage/EventDetailModal/provider/sync/mutation-наборы |

Free/Busy UI отсутствует по условиям тикета, поэтому визуальная проверка Free/Busy не предусмотрена.

Автоматические проверки CAL-107: TypeScript PASS; targeted Free/Busy — 3 files / 40 tests; full Vitest — 209 files / 2120 tests; `npm run test:calendar-tz` — 61/61 в каждой из `UTC`, `Europe/Moscow`, `America/New_York`, `Australia/Lord_Howe` (матрица расширена проекцией Free/Busy); production build PASS; `cargo check` PASS с двумя прежними unrelated warnings. Rust не менялся.

### CAL-108 Scheduling Assistant engine

Дата: 2026-08-22 (Asia/Bangkok). Миграция не создавалась. Engine stateless над CAL-107: `src/services/calendar/scheduling/`. Runtime UI в CAL-108 не подключался; `planMeeting` вызывается только из CAL-109.

Канон: `docs/calendar/CALENDAR_SCHEDULING_ASSISTANT_MODEL.md`.

### CAL-109 Scheduling Assistant UI validation

Дата: 2026-08-22 (Asia/Bangkok). Миграция не создавалась и не запускалась; cloud events не изменялись; outbound invites не отправлялись. Feature commit: `5edefcf`. Live smoke повторён после снятия lock на `cef-runtime\chrome_100_percent.pak` (закрыт только stale `office360.exe` debug instance; runtime не удалялся).

**Runtime surface.** Assistant встроен в `EventCreateModal` и в режим редактирования `EventDetailModal` (скрыт для recurring). UI — thin consumer `planMeeting` / `GroupSchedulingResult`. Month/Week/Day не импортируют scheduling UI.

| Live smoke | Status | Observation |
|---|---|---|
| Create assistant | PASS | Calendar → Создать событие → «Подбор времени»; self «Вы / Обязательный»; group «Все обязательные участники»; timeline, timezone, шаг 30 мин, suggested slots. Save/Создать не нажимались |
| Edit assistant | PASS | Существующее нерекуррентное событие → «Изменить» → assistant открылся; участники на месте; текущий интервал выделен. Сохранение в cloud не выполнялось |
| Slot selection | PASS | Клик suggested/timeline обновил Начало и Окончание, duration сохранилась, модалка осталась открытой, auto-save нет |
| Editor sync | PASS | Ручное изменение datetime в create (год) сразу обновило assistant: ошибка «Проверьте начало и окончание встречи.», suggestions опустели, reload страницы не требовался |
| Unknown remote participant | PASS | Чужие участники: оранжевый «Нет данных о занятости» + striped `?`; не окрашены как свободные |
| Privacy | PASS | На чужих busy/unknown рядах только имя/усечённый email, роль и availability; title/description/location/ICS/UID/resource id не показаны |
| Working hours UI | PASS | Легенда содержит «Вне рабочего времени»; полосы только если engine `workingHoursApplied`. **No configured live working-hours fixture** — фейковый 09:00–18:00 не рисовался |
| Responsive | PASS | Узкое окно ~720×839: колонка участников целая, timeline с локальным `overflow-x-auto`, контролы доступны. Pixel-perfect mobile не требовался |
| Month | PASS | Август 2026; существующие события на месте после cancel create/edit |
| Week | PASS | 16–22 авг 2026; view не сломан |
| Day | PASS | 22 авг 2026; view не сломан |
| Recurring edit | DOCUMENTED LIMITATION | Assistant скрыт при `is_recurrence_master === 1 \|\| occurrence_key !== null`. Live recurring fixture в текущем Month не подтверждён; карточка события без assistant в detail — ожидаемо до «Изменить». Не чинилось в CAL-109 |
| Cloud mutations | NONE | Отмена / Закрыть; RSVP, Удалить, Создать, Сохранить не вызывались |

Unsigned `tauri dev` не управляется Computer Use allowlist; smoke выполнен PrintWindow + UIA Invoke + координатные клики. Отсутствие CDP не считается функциональным падением.

| Проверка | Статус |
|---|---|
| TypeScript `npx tsc --noEmit` | PASS (feature code unchanged after `5edefcf`; not re-run) |
| Targeted Scheduling UI + engine + FreeBusy | PASS (unchanged) |
| Participant / CalendarPage / EventDetailModal | PASS (unchanged) |
| `npm run test:calendar-tz` | PASS 110/110 × `UTC`, `Europe/Moscow`, `America/New_York`, `Australia/Lord_Howe` (unchanged) |
| Full Vitest | PASS 216 files / 2185 tests (unchanged) |
| `npm run build` | PASS (unchanged) |
| `cargo check` | PASS (`src-tauri`, после unlock; два прежних unused-variable warning в `src/lib.rs:360`) |
| Tauri visual smoke | PASS read-only `npm run tauri -- dev` |

Канон UI: `docs/calendar/CALENDAR_SCHEDULING_ASSISTANT_UI.md`.

Working-hours UI: **PASS** — component/engine contract подтверждён; live preference fixture отсутствует, фиктивные часы не подставляются.

Rust не менялся. Общий `cargo fmt --check` имеет существующий repo-wide formatting debt.

### CAL-110 Remote Free/Busy validation

Дата: 2026-08-22 (Asia/Bangkok). Миграция не создавалась и не запускалась; cloud events, RSVP и invitations не изменялись. Google live account отсутствует, поэтому Google remote Free/Busy подтверждён автоматическими provider-contract тестами, а не live-запросом.

| Live smoke | Status | Observation |
|---|---|---|
| Month | PASS | Август 2026 загрузился; существующие Yandex-события отобразились |
| Week | PASS | 16–22 августа загрузилась; существующее событие отобразилось |
| Day | PASS | 22 августа загрузился без error/stale banner |
| Existing event details | PASS | Read-only Yandex-событие с организатором и required/optional участниками открылось |
| Scheduling Assistant | PASS | Режим edit открыл assistant для существующего события; Save не нажимался |
| Yandex remote discovery | PASS | Участники остались `unknown` / «Нет данных о занятости»; отсутствие подтверждённой RFC 6638 поддержки не было интерпретировано как free |
| Google live Free/Busy | NOT AVAILABLE | В development runtime нет безопасного live Google account fixture |
| Cloud mutations | NONE | Create, Save, Delete, RSVP и outbound Free/Busy request к Yandex не выполнялись |

Автоматические проверки CAL-110: TypeScript PASS; targeted Calendar/provider/remote scheduling — 14 files / 173 tests (финальный remote subset: 4 files / 44 tests); full Vitest — 219 files / 2201 tests; `npm run test:calendar-tz` — 110/110 в каждой из `UTC`, `Europe/Moscow`, `America/New_York`, `Australia/Lord_Howe`; production build PASS (main 2,031.14 kB raw / 605.01 kB gzip); `cargo check` PASS с двумя прежними unused-variable warnings в `src/lib.rs:360`. Rust не менялся.

### CAL-111 recurring event mutation scopes validation

Дата: 2026-08-22 (Asia/Bangkok). Миграция не создавалась и не запускалась; cloud events, RSVP и invitations не изменялись. Live acceptance выполнена read-only на существующей локальной development-сессии Yandex Calendar.

| Live smoke | Status | Observation |
|---|---|---|
| Month | PASS | Август 2026 загрузился без error/stale banner; существующие Yandex-события отобразились |
| Week | PASS | 16–22 августа загрузилась без error/stale banner; существующее событие отобразилось |
| Day | PASS | 22 августа загрузился без error/stale banner |
| Existing event details | PASS | Три доступных события открылись read-only; detail UI не регрессировал |
| Recurring fixture | NOT AVAILABLE | В текущем диапазоне не найдено существующее live recurring event; создавать или изменять cloud fixture запрещено |
| Recurring render/details | AUTOMATED PASS | Scope selection, occurrence identity, provider capability guards и provider mutations покрыты targeted/full automated tests; live visual claim не делается |
| `this-and-future` | UNSUPPORTED BY DESIGN | CalDAV/Yandex capability contract блокирует scope до provider call; silent fallback на series отсутствует |
| Cloud mutations | NONE | Create, Save, Delete, RSVP и recurring update/delete не вызывались |

Graphify incremental index обновлён после feature diff: 6,125 nodes / 15,435 edges / 377 communities. Recurrence mutation surface представлен 207 релевантными nodes; integrity audit: 0 missing endpoints, 0 self-loops, 0 duplicate edges. CLI/skill сообщает версию 0.9.33, а сохранение query memory предупреждает о более старом interpreter package 0.9.31; rebuild и integrity gate завершились успешно.

Автоматические проверки CAL-111 до финального runtime/docs pass: TypeScript PASS; targeted Calendar recurrence/provider/UI — 14 files / 189 tests; full Vitest — 2217 tests; `npm run test:calendar-tz` — 119/119 в каждой из `UTC`, `Europe/Moscow`, `America/New_York`, `Australia/Lord_Howe`; production build PASS; `cargo check` PASS с двумя прежними unrelated unused-variable warnings. После runtime/docs-only дополнения минимально повторены TypeScript, targeted 14 files / 189 tests и `cargo check`. Rust не менялся.

### CAL-112 recurring event edit/delete UX validation

Дата: 2026-08-22 (Asia/Bangkok). Миграция не создавалась и не запускалась; cloud events, RSVP и invitations не изменялись. Live Tauri-сессии на момент закрытия тикета не было; recurring cloud fixture не создавался.

| Live smoke | Status | Observation |
|---|---|---|
| Month / Week / Day | NOT STARTED | Нет активной `tauri dev` сессии; предыдущий desktop smoke не перезапускался |
| Non-recurring edit | AUTOMATED PASS | Scope dialog не показывается; plain save/delete покрыты EventDetailModal tests |
| Recurring editor UI | AUTOMATED PASS | Occurrence Save/Delete открывает scope dialog; series master не предлагает `single`; Cancel не вызывает mutation |
| Recurring fixture | NOT AVAILABLE | Создавать cloud recurring event запрещено |
| Scheduling Assistant on occurrence | AUTOMATED PASS | Assistant виден; slot click пишет start/end; Save + `single` передаёт обновлённое время |
| `this-and-future` | HIDDEN BY DESIGN | Capability не advertises scope; option omitted; silent fallback на series отсутствует |
| Cloud mutations | NONE | Create, Save, Delete, RSVP и recurring update/delete не вызывались |

Graphify incremental index обновлён после feature diff: 6,178 nodes / 15,546 edges / 374 communities. Integrity audit на `graph.json`: 0 missing endpoints, 0 dangling endpoints, 0 self-loops, 0 duplicate edges. `graphify-out/` gitignored.

Автоматические проверки CAL-112: TypeScript `npx tsc --noEmit` PASS; targeted recurrence UX / CAL-111 mutation / assistant / FreeBusy / participant / privacy / providers — 12 files / 144 tests; full Vitest — 222 files / 2248 tests; `npm run test:calendar-tz` — 119/119 в каждой из `UTC`, `Europe/Moscow`, `America/New_York`, `Australia/Lord_Howe`; production build PASS (main 2,035.69 kB raw / 606.13 kB gzip); `cargo check` PASS с двумя прежними unused-variable warnings в `src/lib.rs:360`. Rust не менялся. Канон UX: `docs/calendar/CALENDAR_RECURRENCE_EDIT_UX.md`.

### CAL-113 timed Day/Week drag and resize validation

Дата: 2026-08-22 (Asia/Bangkok). Миграция не создавалась и не запускалась; cloud events, RSVP и invitations не изменялись. Live Tauri-сессии на момент закрытия тикета не было; реальный Yandex write не выполнялся.

| Live smoke | Status | Observation |
|---|---|---|
| Day / Week timed drag | AUTOMATED PASS | Overlay + CalendarPage tests: same-day move, cross-day move, duration preserved, mutation once via `CalendarMutationService` |
| Resize top / bottom | AUTOMATED PASS | Preview + commit; inversion clamped to 15 min; `end <= start` cannot be written |
| Recurring scope | AUTOMATED PASS | Occurrence drop/resize opens CAL-112 dialog; `single` / `series` / Cancel rollback; `this-and-future` hidden |
| Click vs drag | AUTOMATED PASS | Tiny pointer movement does not mutate; click still opens details |
| Read-only | AUTOMATED PASS | `events.update !== remote` and all-day/cancelled: no drag/resize |
| Rollback | AUTOMATED PASS | network / conflict / permission restore original geometry |
| Cloud mutations | NONE | Drag/resize не вызывались на реальном Yandex event |

Graphify incremental index обновлён после feature diff: 6,274 nodes / 15,870 edges / 383 communities. Integrity audit на `graph.json`: 0 missing endpoints, 0 dangling endpoints, 0 self-loops, 0 duplicate edges. `graphify-out/` gitignored. Community labels stale vs 383 communities (LLM `graphify label` not required for this ticket).

Автоматические проверки CAL-113: TypeScript `npx tsc --noEmit` PASS; targeted drag/resize + CAL-111/112 + sync — 12 files / 84 tests; provider mutation regression — 4 files / 84 tests; full Vitest — 229 files / 2289 tests; `npm run test:calendar-tz` — 136/136 в каждой из `UTC`, `Europe/Moscow`, `America/New_York`, `Australia/Lord_Howe`; production build PASS (main 2,035.72 kB raw / 606.12 kB gzip); `cargo check` PASS с двумя прежними unused-variable warnings в `src/lib.rs:360`. Rust не менялся. Канон: `docs/calendar/CALENDAR_DRAG_RESIZE.md`.

### CAL-114 Month / all-day / conversion validation

Дата: 2026-08-23 (Asia/Bangkok). Миграция не создавалась и не запускалась; cloud events, RSVP и invitations не изменялись. Live Tauri-сессии на момент закрытия тикета не было; реальный Yandex write не выполнялся.

| Live smoke | Status | Observation |
|---|---|---|
| Month timed / all-day drag | AUTOMATED PASS | MonthView + dateShift: same-week, cross-week, cross-month, wall-clock preserved |
| Multi-day all-day | AUTOMATED PASS | Exclusive span shifted by grabbed-cell delta |
| Week all-day row | AUTOMATED PASS | AllDayLane all-day → all-day and all-day → timed |
| Timed ↔ all-day | AUTOMATED PASS | Overlay conversion preview `Весь день`; 60-minute default timed duration; CAL-113 snap |
| Recurring scope | AUTOMATED PASS | Month/all-day occurrence drop opens CAL-112 dialog; `single` / `series` / Cancel rollback |
| Click vs drag | AUTOMATED PASS | 6 px threshold; click still opens details |
| Read-only | AUTOMATED PASS | `events.update !== remote`: not draggable / not convertible |
| Rollback | AUTOMATED PASS | network / conflict / permission restore Month position and time kind |
| Keyboard | AUTOMATED PASS | Event focus + aria-label; Event Edit `Начало` / `Окончание` is resize/move equivalent |
| Cloud mutations | NONE | Month/all-day/conversion не вызывались на реальном Yandex event |

Канон: `docs/calendar/CALENDAR_MONTH_ALLDAY_INTERACTIONS.md`.

Graphify incremental index обновлён после feature diff: 6,367 nodes / 16,244 edges / 389 communities. Date-grid / Month / AllDayLane surface: 77 релевантных nodes. Integrity audit на `graph.json`: 0 missing endpoints, 0 dangling endpoints, 0 self-loops, 0 duplicate edges. `graphify-out/` gitignored. Community labels stale vs 389 communities (LLM `graphify label` not required for this ticket).

Автоматические проверки CAL-114: TypeScript `npx tsc --noEmit` PASS; targeted Month/all-day/conversion/a11y — 8 files PASS; CAL-113/111/112 + sync regression — 12 files / 86 tests PASS; provider mutation regression — 4 files / 77 tests PASS; full Vitest — 236 files / 2326 tests PASS; `npm run test:calendar-tz` — 149/149 в каждой из `UTC`, `Europe/Moscow`, `America/New_York`, `Australia/Lord_Howe`; production build PASS (main 2,035.74 kB raw / 606.16 kB gzip); `cargo check` PASS с двумя прежними unused-variable warnings в `src/lib.rs:360`. Rust не менялся.

### CAL-117 create-by-grid-selection validation

Дата: 2026-08-23 (Asia/Bangkok). Миграция не создавалась и не запускалась; cloud events, RSVP и invitations не изменялись. Live Tauri-сессии на момент закрытия тикета не было; реальный Yandex write не выполнялся.

| Live smoke | Status | Observation |
|---|---|---|
| Day / Week click-to-create | AUTOMATED PASS | Overlay click snaps to 15 min and opens 60-minute draft via `EventCreateModal` |
| Day / Week drag-to-create | AUTOMATED PASS | Preview `timed-create-preview`; reverse drag; min duration 15 min; Week locked to origin column |
| Month empty-cell create | AUTOMATED PASS | All-day draft on `data-calendar-date`, including spillover cells |
| All-day row create | AUTOMATED PASS | Click-only single-day all-day draft; multi-day all-day selection not in CAL-117 |
| Existing event click / drag / resize | AUTOMATED PASS | CAL-113/114 regression suites unchanged |
| Read-only | AUTOMATED PASS | `events.create !== remote`: no modal |
| Cancel | AUTOMATED PASS | Modal close does not call `calendarMutationService.create` |
| Keyboard | AUTOMATED PASS | Overlay slot + Month day-number + toolbar; no keyboard drag-selection |
| Cloud mutations | NONE | Grid create не вызывался на реальном Yandex event |

Канон: `docs/calendar/CALENDAR_CREATE_BY_SELECTION.md`.

Graphify incremental index обновлён после feature diff: 6,414 nodes / 16,423 edges / 397 communities. Integrity audit (`graphify diagnose multigraph`): 0 missing endpoints, 0 dangling endpoints, 0 self-loops, 0 duplicate edges. `graphify-out/` gitignored. Community labels stale vs 397 communities (LLM `graphify label` not required for this ticket).

Автоматические проверки CAL-117: TypeScript `npx tsc --noEmit` PASS; targeted create-selection — 6 files / 54 tests PASS; CAL-113/114/recurrence/provider/sync regression — 18 files / 202 tests PASS; full Vitest — 238 files / 2357 tests PASS; `npm run test:calendar-tz` — 162/162 в каждой из `UTC`, `Europe/Moscow`, `America/New_York`, `Australia/Lord_Howe`; production build PASS (main 2,035.74 kB raw / 606.16 kB gzip; CalendarPage chunk 117.73 kB / 34.68 kB gzip); `cargo check` PASS с двумя прежними unused-variable warnings в `src/lib.rs:360`. Rust не менялся.
