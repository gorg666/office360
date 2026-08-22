# CAL-102 — независимое финальное ревью

Дата: 2026-08-22
Ветка: `feat/calendar-yandex360`
Ревьюируемый commit: `1b11cf38c6763f3beba9c7376022687db3a942e5` (`refactor(calendar): normalize event time semantics`)
Предыдущее ревью: `docs/calendar/CALENDAR_ARCHITECTURE_REVIEW_102.md`
Режим: **review-only**. Feature code не изменялся; `git status` CLEAN до и после.

**Вердикт: PASS WITH FIXES.**
Модель времени сделана правильно и проверена независимо. Найдены два дефекта, не относящихся к
модели времени, которые обязаны быть закрыты **до** CAL-103. Ни один из них не требует менять
time model — поэтому CAL-103 readiness = YES при условии этих двух фиксов.

---

## 0. Что проверено независимо

Все заявленные Codex результаты перепроверены рецензентом, а не приняты на слово.

| Проверка | Заявлено | Перепроверено рецензентом |
|---|---|---|
| Vitest full | 2014/2014 | **200 files / 2014 tests PASS** (собственный прогон) |
| TypeScript | PASS | **`npx tsc --noEmit` exit 0** |
| Migration v34 | PASS | **`npm run test:calendar-migration` → `{"freshDb":"PASS","existingDb":"PASS","legacyRow":"PASS","semanticRow":"PASS","columns":10,"indexes":2}`** — скрипт реально исполняет SQL через `node:sqlite`, не сверяет строки |
| TZ matrix (4 зоны) | PASS | **Перезапущено в реальных host TZ** (`$env:TZ` × UTC / Europe/Moscow / America/New_York / Australia/Lord_Howe): 31/31 PASS в каждой из четырёх сред |

Дополнительно выполнены четыре собственных probe-теста (временный файл, удалён; `git status` CLEAN).
Их результаты — в §4 и §5.

---

## 1. Time domain — PASS

Реализация прочитана, не только названия тестов.

`src/services/calendar/domain/time.ts` действительно различает три значения
(`CalendarEventTime`, строки 18-33): `timed-zoned` (wall + tzid + instant), `floating` (только wall),
`all-day` (`startDate` + `endDateExclusive` как строки-даты, не timestamps).

| Требование | Статус | Доказательство в коде |
|---|---|---|
| host timezone не определяет semantic instant | **PASS с одной оговоркой** | `zonedWallDateTimeToInstant` (time.ts:136) резолвит через `Intl` c явным `tzid`; host TZ не участвует. Оговорка — §7.2 (floating / неподдерживаемый TZID) |
| TZID сохраняется | PASS | `tzid` — поле `ZonedDateTimeValue`; персистится в колонку `tzid` (`calendarEvents.ts:252`); при записи обратно `serializeEventTime` (icalHelper.ts:255-261) эмитит `DTSTART;TZID=…` |
| floating не превращается скрыто в UTC | PASS | `parseTemporalValue` (icalTimeMapping.ts:257-258) возвращает `kind:"floating"`; `createEventTime` запрещает смешивание; тест «preserves floating wall time without assigning UTC semantics» проверяет структуру, а не эпоху |
| all-day не хранится как local-midnight Date | PASS | `parseCalendarDate` → строка `YYYY-MM-DD`; compat-эпоха считается `calendarDateToUnixSeconds` = **UTC**-границей (time.ts:105), а не `new Date(y,m,d)` |
| Google exclusive end нормализован | PASS | `mapGoogleTime` (googleCalendarProvider.ts) кладёт `end.date` прямо в `endDateExclusive`; прежний `+ "T23:59:59"` удалён. Conformance-тест сравнивает `google.time` с `caldav.time` и `endTime` — равны |

Round-trip записи тоже починен: `replaceUpdatedDateProperty` (icalHelper.ts:264-274) читает существующий
`TZID` и переводит входной instant в wall этой зоны, вместо прежнего затирания параметров и записи
`…Z`. `formatDateInput` (icalHelper.ts:276-280) работает по regex над строкой, а не через `new Date()` —
прежний all-day off-by-one на записи устранён.

---

## 2. DST resolver — PASS

`zonedWallDateTimeToInstant` (time.ts:136-148) + `matchingInstants` (163-172).

- **Не зависит от host timezone.** Единственный источник — `Intl.DateTimeFormat` с явным `timeZone`
  (`getFormatter`, 179-195). Кандидаты offset'ов сэмплируются вокруг целевого naive-момента
  (±36/24/12/0 ч) и **фильтруются round-trip-проверкой** `wallEquals(instantSecondsToWallDateTime(...))`.
  Фильтр — важная деталь: даже если сэмплирование промахнётся, неверный instant не пройдёт.
- **Работает с IANA zones**, без встроенных offset-таблиц: `offsetAt` (174-177) вычисляет смещение
  из самого `Intl`. Хардкода нет.
- **Overlap → earlier**: `matchingInstants` сортирует по возрастанию, `direct[0]` берёт ранний instant.
  Тест: `2026-11-01T01:30` America/New_York → `05:30Z` (EDT), не `06:30Z` (EST). ✓
- **Gap → shift forward**: цикл 1-180 минут до первого валидного wall.
  Тест: `2026-03-08T02:30` America/New_York → wall `03:00`. ✓
- **Half-hour DST**: `2026-10-04T02:15` Australia/Lord_Howe → wall `02:30` (переход +30 мин). ✓

### Edge cases вокруг Intl — оценка

| Риск | Оценка |
|---|---|
| Sub-second/LMT-зоны до ~1900 | `offsetAt` округляет до секунд; round-trip-фильтр защищает. Нерелевантно для календаря |
| Зоны с offset > ±14 ч | Сэмплирование ±36 ч покрывает; при промахе — не ложный ответ, а false-gap (сдвиг вперёд) |
| `hourCycle: "h23"` | Задан явно (191) — устраняет классическую ловушку `hour: "24"` в `en-US` |
| Прогрев форматтера | `formatter.formatToParts(new Date(0))` в `getFormatter` (192) — невалидная зона падает при создании, а не позже |
| Стоимость | ~8-12 `formatToParts` на один wall→instant. Разворот большой серии = тысячи вызовов. Non-blocking, см. §9 |

**Важно для CAL-103:** политика gap — «первый валидный wall» (02:30 → **03:00**), а не «сдвиг на
величину разрыва» (02:30 → 03:30). Обе трактовки допустимы, но выбранная зафиксирована тестом.
`ical.js` резолвит wall→instant по своим правилам VTIMEZONE и с этой политикой не совпадёт.
См. §11 — требование «codec отдаёт wall+tzid, instant считает только домен».

---

## 3. Occurrence identity — PASS

`createOccurrenceKey` (domain/occurrence.ts:13-22):

```text
timed-zoned : <uid>|Z|<tzid>|YYYYMMDDTHHMMSS
floating    : <uid>|F|YYYYMMDDTHHMMSS
all-day     : <uid>|D|YYYYMMDD
```

- **Не epoch, не href+epoch, не rendered ISO.** Ключ построен из wall-времени и зоны.
- **Стабилен к host timezone**: ни один компонент не выводится из локальной зоны — перепроверено
  прогоном в четырёх реальных host TZ.
- **Стабилен к DST**: wall-компонент не меняется при переходе.
- **Стабилен к rendering**: рендер читает `start_time`, а ключ от рендера не зависит.
- **Кросс-провайдерная стабильность проверена тестом**, а не декларацией:
  `providerConformance.test.ts:40-59` собирает одно и то же занятие из Google DTO
  (`originalStartTime`) и из CalDAV ICS (`RECURRENCE-ID`) и утверждает
  `google.occurrenceKey === caldav.occurrenceKey`. Это сильный тест.

Связка `series UID → RECURRENCE-ID → EXDATE → generated occurrence → override` замкнута корректно:
`recurrenceValueToMasterWall` (icalTimeMapping.ts:326-341) переводит **любую** форму значения
(UTC `Z`, чужой TZID, floating, `VALUE=DATE`) в wall **зоны мастера** через instant, и уже от него
строится ключ. Именно это устраняет прежний баг «одна из двух кодировок EXDATE молча не совпадает»
— и покрыто тестом с обеими кодировками одновременно (`icalTimeMapping.test.ts:70-82`).

Ресурсная идентичность (`remoteEventId`/href), `seriesUid` и `occurrenceKey` разделены — как
и требовалось.

---

## 4. Recurrence — PASS с одним дефектом

### Что работает

Разворот идёт по naive wall (`rrulestr(rule, { dtstart: wallDateTimeToNaiveDate(masterWall) })`,
icalTimeMapping.ts:140), затем каждое занятие локализуется по `tzid` мастера
(`materializeOccurrence`, 302-324). Тест фиксирует и wall, и instant:

```text
DTSTART;TZID=America/New_York:20260301T100000, RRULE:FREQ=WEEKLY;COUNT=4
wall.hour  -> [10, 10, 10, 10]
instants   -> 15:00Z, 14:00Z, 14:00Z, 14:00Z
```

То есть прежний баг «серия уезжает на 11:00 после DST» устранён и зафиксирован ожиданиями-литералами.

`EXDATE` в форме `Z` и в форме `TZID` — оба совпадают; `RECURRENCE-ID` override применяется;
`RDATE` добавляет занятие; `DURATION` даёт конец при отсутствии `DTEND` — всё покрыто.

**Пути `fetchEvents` и `syncEvents` объединены**: `CalDAVProvider.syncEvents` теперь вызывает
`parseVEventsInRange`, а не `parseVEvent` (diff caldavProvider.ts:343-350). Прежнее расхождение
двух путей чтения одного провайдера закрыто. У Google разворот серверный (`singleEvents=true`) —
это осознанная и задокументированная асимметрия, идентичность при этом общая (§3).

### PROBE B — дефект: занятие длиннее 3 суток выпадает из выборки

`parseCalendarEventsInRange` расширяет окно разворота **фиксированными ±3 сутками**
(icalTimeMapping.ts:141-142). До CAL-102 окно расширялось на длительность события
(`rangeStart - duration`). Занятие, начавшееся раньше `rangeStart - 3 дня`, больше не попадает
в кандидаты, хотя финальный фильтр перекрытия (187-188) его бы пропустил.

Воспроизведено:

```text
DTSTART:20260302T100000Z  DTEND:20260307T100000Z  (5 суток)
RRULE:FREQ=WEEKLY;COUNT=4
Просмотр диапазона 2026-03-13 .. 2026-03-15

Занятие 09.03 -> 14.03 перекрывает диапазон.
parseVEventsInRange вернул: []          <-- занятие потеряно
```

Результат одинаков в Asia/Bangkok и America/New_York — от host TZ не зависит.
Первое занятие серии спасает безусловная вставка `masterWall` (строка 137); все последующие
длинные занятия теряются молча.

**Классификация:** функциональная регрессия относительно доCAL-102 поведения, host-независимая,
без ошибки в UI (событие просто отсутствует). Исправление тривиально:
окно = `max(3 суток, длительность занятия)`.

**Почему это важно именно сейчас:** live smoke для recurring rendering waived под обещание
автоматического покрытия, а автоматическое покрытие многодневных серий отсутствует — это ровно
тот случай, который waiver должен был бы поймать. См. §10.

---

## 5. Migration v34 — PASS

```sql
ALTER TABLE calendar_events ADD COLUMN time_kind TEXT;            -- ×8 nullable TEXT
ALTER TABLE calendar_events ADD COLUMN is_recurrence_master INTEGER NOT NULL DEFAULT 0;
ALTER TABLE calendar_events ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS ...                                    -- ×2
```

| Требование | Статус |
|---|---|
| append-only | PASS — 12 statement'ов, все `ADD COLUMN` / `CREATE INDEX IF NOT EXISTS` |
| existing rows не переписываются | PASS — ни одного `UPDATE`; проверено исполнением: строка `legacy-1` сохранила `summary`/`start_time`/`end_time` |
| нет destructive SQL | PASS — `DROP/DELETE/UPDATE/REPLACE` отсутствуют; проверяется и тестом, и скриптом |
| nullable/default semantics | PASS — все семантические поля nullable; `NOT NULL DEFAULT` только у двух числовых, с константным default (SQLite это разрешает на `ADD COLUMN` без rewrite) |
| lazy derivation работает | PASS — `normalizeCalendarEventRow` вызывается во всех четырёх read-функциях; `expect(mockDb.execute).not.toHaveBeenCalled()` подтверждает отсутствие записи |
| new rows пишут semantic columns | PASS — `upsertCalendarEvent` пишет все 10; тест сверяет `params.slice(18)` с литеральным массивом |
| старые rows читаются | PASS — с оговоркой §7.1 |

**Rollback/forward.** Down-миграций в проекте нет вообще (пред-существующее свойство, не введено
CAL-102). Forward-предположение разумно: новые колонки nullable, старый код их не читает,
`SELECT *` не ломается. Единственный риск — частично применённая миграция: `ADD COLUMN` без
`IF NOT EXISTS`, поэтому повторный прогон после сбоя между statement'ами упадёт на
`duplicate column name`. Это соответствует существующей конвенции репозитория (миграция с
`calendar_id`/`etag`/`uid` сделана так же) и не является регрессией CAL-102.

---

## 6. Provider normalization — PASS

UI больше не обязан понимать provider-specific семантику:

| Аспект | Где нормализуется | Что видит UI |
|---|---|---|
| TZID | `parseTemporalValue` (CalDAV) / `mapGoogleTime` (Google) | `tzid` + `wall_start` в строке БД |
| all-day exclusive end | оба маппера → `endDateExclusive` | `end_date_exclusive`; `eventOccursOnDate` сравнивает **даты**, а не полуночи |
| recurrence identity | `createOccurrenceKey` в обоих | `occurrence_key`; `EventDetailModal` определяет повторяемость как `is_recurrence_master === 1 \|\| occurrence_key !== null` |

Прежний regex по сырому ICS в React-компоненте
(`/(?:^|\r?\n)RRULE:/i.test(event.ical_data)`) удалён. Проверено, что замена не ломает признак
повторяемости ни на одном пути: CalDAV-занятия получают `occurrenceKey` (icalTimeMapping.ts:184),
Google-инстансы — при наличии `recurringEventId`, legacy-строки — через ленивую проекцию из ICS.

`Intl.DateTimeFormat().resolvedOptions().timeZone` как источник зоны события из Google-провайдера
удалён полностью (create/update теперь `timeZone: "UTC"` с явным instant, либо `mapDomainTimeToGoogle`
с реальным tzid). `mapDomainTimeToGoogle` явно бросает на floating — это правильный отказ, а не
молчаливая подстановка.

Остаточное смешение — только в §7, severity там же.

---

## 7. Остаточные дефекты (non-blocking)

### 7.1 PROBE A — legacy all-day строка без ICS проецируется зоно-зависимо

`normalizeCalendarEventRow` (calendarEvents.ts:201-213) для legacy-строки без `ical_data`
берёт `end_date_exclusive = calendarDateFromUnixSecondsUtc(row.end_time)` и оставляет
`start_time` как есть. Но старый парсер писал **local midnight** (CalDAV) и **local `T23:59:59`**
(Google), а не UTC-границу. Воспроизведено на однодневном all-day 15.03:

```text
host Asia/Bangkok (+7)      -> start "2026-03-14", end_excl "2026-03-16"
                               рендерится 14.03 И 15.03      (должно: только 15.03)
host America/New_York (-4)  -> start "2026-03-15", end_excl "2026-03-17"
                               рендерится 15.03 И 16.03      (должно: только 15.03)
```

Формулировка `CALENDAR_TIME_MODEL.md` «otherwise preserve legacy all-day dates via UTC date
boundaries» верна только если legacy-эпоха *была* UTC-границей; фактически она ей не была.

**Область:** строки с `is_all_day=1` и `ical_data IS NULL` — это legacy Google all-day и любая
строка, чей ICS не распарсился (`catch` на 197). CalDAV и invitation-проекции всегда имеют
`ical_data` и идут по корректной ветке. **Самоизлечивается** при первой успешной синхронизации
диапазона. Ветка не покрыта тестом: единственный legacy-тест использует строку **с** ICS.

**Severity: low-medium, non-blocking.** Но это остаточная зависимость от host timezone, поэтому
называю её явно, а не прячу в «прочее».

### 7.2 `floatingTimeZone` в production не передаётся никогда

`CalendarParseOptions.floatingTimeZone` используется **только тестами**. Все production-вызовы
(`CalDAVProvider.fetchEvents` / `syncEvents`, `normalizeCalendarEventRow`, `parseICalendarInvite`)
опускают опцию, и код падает в
`Intl.DateTimeFormat().resolvedOptions().timeZone` — host TZ — в шести местах
(icalTimeMapping.ts:247, 257, 291, 373, 380).

Последствия:

- Для **истинно floating** событий это семантически допустимо по RFC 5545, и домен сохраняет
  `kind:"floating"` + wall, так что смысл не теряется. Но производные `startTime`/`endTime`
  **персистятся** и используются в SQL-фильтре диапазона — значит кэш floating-события
  зоно-зависим до следующей синхронизации.
- Для **неподдерживаемого/Windows TZID** (`Russia TZ 2 Standard Time`, `W. Europe Standard Time`)
  событие молча деградирует до floating (icalTimeMapping.ts:246-249), и его instant становится
  host-зависимым. `timezoneWarning` выставляется **только** на пути Mail-приглашений
  (`parseICalendarInvite`); на календарном пути синхронизации никакого флага нет —
  `CalendarEventData` поля риска не имеет.

Это ровно тот класс, который CAL-103 (`ical.js` + `VTIMEZONE`) устраняет по существу. До тех пор:
нужен явный флаг на домене и решение, откуда брать зону по умолчанию (настройка аккаунта,
а не host).

**Отдельно как test-quality замечание:** четырёхкратный `describe.each(HOST_TIME_ZONES)` в
`icalTimeMapping.test.ts` перебирает конфигурацию, которой в production не существует. Это не
тавтология, но и не покрытие production-пути — реальную гарантию даёт только запуск в разных
host TZ (§8).

### 7.3 Прочее

| # | Находка | Куда |
|---|---|---|
| 1 | `transparency`: Google при отсутствии `TRANSP` даёт `"opaque"`, CalDAV — `null`. Одна и та же семантика RFC («нет TRANSP = opaque») в двух представлениях; conformance-набор этот случай не покрывает | до CAL-109 (FreeBusy) |
| 2 | `googleTimeIdentity` при отсутствии `originalStartTime.timeZone` считает wall в `"UTC"`. Если Google непоследователен в наличии поля — `occurrence_key` «прыгает» и даёт дубли строк. Не проверено на живом Google-аккаунте (в runtime baseline он честно помечен `NOT AVAILABLE`) | проверить до CAL-104 |
| 3 | `normalizeCalendarEventRow` перепарсивает ICS при **каждом** чтении каждой legacy-строки и никогда не записывает результат — бессрочно | CAL-104 |
| 4 | `zonedWallDateTimeToInstant` ≈ 8-12 `Intl.formatToParts` за вызов; большой диапазон серии = тысячи вызовов. Лечится кэшем переходов на зону | по факту профилирования |
| 5 | Матрица host TZ прогоняется **вручную**; в `package.json`/vitest config автоматизации нет. Такая матрица тихо перестаёт запускаться | добавить npm-скрипт / vitest project |
| 6 | `escapeICalText` по-прежнему не сворачивает строки >75 октетов и не экранирует `\r` | CAL-103 DoD |
| 7 | `RDATE;VALUE=PERIOD` не поддержан; множественные `RRULE` — только первая | CAL-103 |
| 8 | `OR calendar_id IS NULL` в `getCalendarEventsInRangeMulti` сохранён (осознанно, вне CAL-102) | CAL-104 |
| 9 | **Коллизия нумерации в roadmap**: `CALENDAR_IMPLEMENTATION_ROADMAP.md` всё ещё определяет `CAL-103` как «Normalize Calendar persistence and sync state», тогда как стартующий тикет `CAL-103` — это iCalendar codec. Два разных CAL-103 в одних и тех же документах | перенумеровать **до** старта |

---

## 8. ParticipantRef / Capabilities — PASS

`ParticipantRef` (domain/participant.ts) — 7 полей, две функции, ноль зависимостей.
Нормализация email в одном месте (`trim` → снять `mailto:` → lowercase), display-casing сохраняется
отдельно в `value`. Conformance-тест сверяет нормализацию Google и CalDAV и отдельно проверяет,
что регистр для показа не потерян. Это ровно тот минимум, который рекомендовался; в framework
не превратилось. Роли/CUTYPE/delegation осознанно не введены.

`CalendarProviderCapabilities` — один интерфейс на 11 строк, `version: 1`, только декларация.
Заполнен обоими провайдерами честно (CalDAV: `freeBusy: "none"`, `sync: "full"`, `scopes: ["series"]` —
это правда о текущем коде, а не оптимистичная заглушка). Тест проверяет фактические значения.

**Method-presence pattern не распространяется.** Новых `if (!provider.someMethod)` в React не
добавлено. Прежний единственный случай — `if (!provider.respondToEvent)` в `EventDetailModal.tsx:92` —
остался нетронутым; его миграция на `capabilities.rsvp` относится к CAL-105 и здесь корректно
не делалась. Отмечаю как незакрытый хвост, не как нарушение.

---

## 9. Test quality — PASS с замечаниями

### Тавтологичность

Проверены все новые тесты. **Тавтологичных нет.** Ожидания — литералы:
epoch-числа (`1773558000`), ISO-строки (`"2026-03-15T07:00:00.000Z"`), объекты wall
(`{ year: 2026, month: 3, day: 8, hour: 3, ... }`), массивы часов (`[10, 10, 10, 10]`).
Прежний тавтологический тест `«parses non-UTC datetime»`, вычислявший ожидание тем же
`new Date(y,m,d,h,...)`, из `icalHelper.test.ts` удалён.

Сильнейшие тесты — те, что сравнивают **два независимых источника**:
`google.time === caldav.time`, `google.occurrenceKey === caldav.occurrenceKey`. Их нельзя
удовлетворить общей ошибкой в одном маппере.

### Матрица host TZ — реальная, но не автоматизированная

Перезапущено рецензентом в четырёх **настоящих** host TZ (не аргументом):

```text
HOST TZ = UTC                 -> 4 files, 31 tests PASS
HOST TZ = Europe/Moscow       -> 4 files, 31 tests PASS
HOST TZ = America/New_York    -> 4 files, 31 tests PASS
HOST TZ = Australia/Lord_Howe -> 4 files, 31 tests PASS
```

Заявление Codex подтверждено. Но автоматизации нет (§7.3 #5) — матрица держится на памяти
исполнителя.

### Пробелы покрытия

1. **Многодневные повторяющиеся занятия** — не покрыты; там и живёт PROBE B.
2. **Legacy-ветки без ICS** — не покрыты; там живёт PROBE A. Единственный legacy-тест берёт строку
   с ICS, то есть самую благополучную ветку.
3. **Устойчивость к некорректному ICS** — не покрыта; см. §10.
4. **Компонентных тестов рендера календаря нет.** `CalendarPage.test.tsx` — это четыре сценария
   загрузки из CAL-101B (A-D); `MonthView`/`WeekView`/`DayView` тестов не имеют.
   `eventTimeProjection.test.ts` — 1 тест, 2 ассерта.
5. Тесты миграции в `migrations.test.ts` — строковые проверки SQL. Это компенсируется
   `verify-calendar-migration-v34.mjs`, который SQL реально исполняет.

---

## 10. Live smoke waiver — ACCEPTABLE

Waiver на live-fixtures для all-day и recurring rendering **принимается**, и он не является
причиной блокировки. Основания:

- `eventOccursOnDate` — не тестовый двойник, а **общая production-функция**: её импортируют
  `MonthView`, `WeekView` и `DayView`; проверено по коду. Разрыва между «тест проверяет одно,
  рендер делает другое» здесь нет.
- Семантика all-day и recurrence покрыта нетавтологичными тестами, перепроверенными рецензентом
  в четырёх реальных host TZ.
- `EventDetailModal.formatEventRange` для all-day переведён на `allDayStartDate` — та же
  доменная функция.

Но условие waiver'а («при наличии автоматического покрытия») выполнено **не полностью**:
автоматическое покрытие recurring rendering **не поймало PROBE B** — многодневная серия исчезает
из вида. Это не отменяет waiver; это означает, что покрытие обязано быть дополнено вместе
с фиксом, иначе waiver перестанет чем-либо обеспечиваться.

Реального разрыва «UI projection tests ↔ production rendering path» не найдено.

---

## 11. CAL-103 readiness — YES (после двух фиксов)

### Стабилен ли domain contract для нового кодека

Да. Контракт для CAL-103 состоит из четырёх точек, и все они уже provider-neutral и не протекают
наружу:

```text
CalendarEventTime                 — три варианта, plain data
zonedWallDateTimeToInstant()      — единственный авторитет wall + tzid -> instant
createOccurrenceKey()             — единственный конструктор идентичности занятия
CalendarEventData                 — DTO, который обязаны производить оба провайдера
```

### Придётся ли CAL-103 снова менять time model

**Нет — при трёх соблюдённых условиях.** Каждое из них является инструкцией исполнителю,
а не пожеланием:

1. **Кодек отдаёт `wall + tzid`, но никогда instant.**
   `ICAL.Time.toUnixTime()` / `ICAL.Timezone` резолвят gap/overlap по своим правилам и не совпадут
   с `DST_DISAMBIGUATION_POLICY` (§2: у нас 02:30 → 03:00). Если позволить кодеку считать instant'ы,
   политика тихо изменится и DST-тесты «поедут» без единой явной правки политики.

2. **`VTIMEZONE` нормализуется в IANA на границе кодека.**
   `ICAL.Timezone` описывает зону встроенным правилом, а не IANA-идентификатором. Если это правило
   протечёт в домен, `ZonedDateTimeValue.tzid: string` придётся расширять — и это потянет
   `createOccurrenceKey`, схему и кэш. Правильная граница: `TimeZoneResolver` переводит
   `TZID` (в т.ч. Windows-имена) + встроенный `VTIMEZONE` в IANA-идентификатор; домен остаётся как есть.
   Нерезолвимая зона сохраняет текущую деградацию, но **обязана** получить явный флаг (§7.2).

3. **`createOccurrenceKey` остаётся единственным конструктором ключа.**
   Recurrence-id из `ICAL.Event.getOccurrenceDetails()` — это **вход** для `OccurrenceIdentity`,
   а не сам ключ. Формат ключа менять нельзя без явного шага инвалидации кэша: `occurrence_key`
   участвует в `google_event_id`, а он — часть `UNIQUE(account_id, google_event_id)`.
   Молчаливая смена формата = дубликаты строк на всех существующих кэшах.

### Требуемая граница ical.js

```text
Inbound:
  raw ICS
    -> ical.js parse (Component/jCal)            [только внутри icalTimeMapping.ts]
    -> RawCalendarComponent (wall + tzid + params, без instant'ов)
    -> domain: zonedWallDateTimeToInstant / createOccurrenceKey
    -> CalendarEventData

Outbound:
  CalendarEventTime + метаданные
    -> ical.js build (folding, escaping, TZID, VTIMEZONE, SEQUENCE, DTSTAMP)
    -> RFC 5545 ICS
```

Правила границы:

- Типы `ICAL.*` **не покидают** `icalTimeMapping.ts`. Ни в `domain/`, ни в `types.ts`, ни в `db/`,
  ни в компонентах. Это проверяемо lint-правилом на запрещённые импорты — рекомендую внести в DoD.
- Сырой ICS сохраняется дословно для round-trip/диагностики; неизвестные свойства обязаны
  переживать сериализацию.
- Ручные помощники (`escapeICalText`, `replaceEventProperty`, `replaceUpdatedDateProperty`,
  `serializeEventTime`) **удаляются**, а не сосуществуют с кодеком — иначе вернётся
  асимметрия чтения и записи.
- Acceptance-тест границы: `domain -> ICS -> domain` даёт identity для всех трёх видов времени
  в каждой из четырёх host TZ.
- **Отдельно решить при реализации:** `ical.js` поставляется без базы IANA-зон; для исходящего
  `VTIMEZONE` нужен либо отдельный zones-пакет, либо генерация минимального `VTIMEZONE` из
  переходов, вычисленных через `Intl`. Это решение с bundle-эффектом; проверить фактическое API
  на месте, а не по памяти.

Лицензия `ical.js` не пересматривается — решение владельца принято, новых критических факторов
не обнаружено.

---

## 12. Обязательные фиксы до CAL-103

Оба фикса — вне time model, поэтому readiness остаётся YES.

### FIX-1 — изоляция ошибок разбора (blocking)

`parseCalendarEventsInRange` бросает исключение на любом некорректном компоненте, и ни
`CalDAVProvider.fetchEvents` (caldavProvider.ts:234-238), ни `syncEvents` его не ловят.
Одна плохая запись обнуляет весь календарь: CAL-101B честно покажет error state, но событий
не будет ни одного. Воспроизведено:

```text
ICS из двух VEVENT: первый корректный, второй с "DTSTART:20260315T25"
-> THREW: Invalid iCalendar wall date-time: 20260315T25    (оба потеряны)

DTSTART;VALUE=DATE:20260315 + DTEND;TZID=Europe/Moscow:20260316T000000
-> THREW: All-day DTSTART requires all-day DTEND
```

До CAL-102 парсер деградировал молча (давал NaN), не падал. Это регрессия устойчивости.

**Почему до CAL-103, а не после:** CAL-103 ставит на этот путь ещё более строгий кодек и
дополнительно проводит через него Mail-приглашения — самый плохо сформированный ICS в природе.
Без изоляции CAL-103 превратит редкий сбой в регулярный.

**Требуется:** try/catch на уровне отдельного VEVENT и отдельного DAV-объекта; счётчик
непрочитанных компонентов, доводимый до UI-состояния (у CAL-101B уже есть механика состояний);
тесты на смешанный корректный/некорректный ICS.

### FIX-2 — окно разворота повторов по длительности занятия (blocking)

См. §4, PROBE B. Заменить фиксированные ±3 суток на `max(3 суток, длительность занятия)`
и покрыть тестом многодневную серию, пересекающую границу диапазона.

**Почему до CAL-103:** CAL-103 будет переписывать/переносить путь разворота. Если регрессию
не закрыть тестом сейчас, она вмонтируется в новый кодек без единого падающего теста, и
атрибутировать её станет заметно дороже.

---

## 13. Checks

```text
Feature code изменён:            НЕТ
Создан файл:                     docs/calendar/CALENDAR_REVIEW_102_FINAL.md
git status:                      CLEAN до ревью; после — только этот новый документ

Независимые прогоны рецензента:
  npx vitest run                        -> 200 files / 2014 tests PASS
  npx tsc --noEmit                      -> exit 0
  npm run test:calendar-migration       -> freshDb/existingDb/legacyRow/semanticRow PASS
  host-TZ матрица (4 реальные зоны)     -> 31/31 PASS в каждой

Probe-тесты рецензента: временный файл в src/services/calendar/, прогнан в двух host TZ,
  удалён; git status подтверждён CLEAN.

Секреты:  не читались, не выводились
Cloud:    никаких мутаций; live-аккаунты не затрагивались
Graphify: READ (граф не менялся — правок кода нет)
```
