# CAL-REVIEW-102 — независимое архитектурное ревью перед Calendar Foundation

Дата: 2026-08-21
Ветка: `feat/calendar-yandex360`
Approved baseline: `6ed1340304f1119b2c34db35593e4b0c00be64a8` (`chore(calendar): establish verified baseline`)
Режим: **review-only**. Исходники не изменялись. Проверено `git status` — CLEAN до и после ревью.
Рецензент: независимый reviewer (не Codex).

**Вердикт: PASS WITH CHANGES.**

Выбор «фундамент до фич» верный. Выбор *содержания* CAL-102 в текущем roadmap — нет. Ниже показано,
почему, с воспроизводимыми доказательствами.

---

## 0. Executive summary

Аудит Codex (`CALENDAR_AUDIT_BASELINE.md`, `CALENDAR_ARCHITECTURE_GAP.md`) корректен по фактам и
по составу capability matrix. Ревью подтверждает его выводы и добавляет три вещи:

1. **Переклассификация severity.** Аудит описывает timezone/recurrence как «model gap» и «риск».
   Это не риск — это активные баги корректности данных в production-пути. Ниже приведены
   выполненные прогоны, показывающие, что одно и то же ICS-событие даёт **три разных instant'а**
   в зависимости от системной таймзоны зрителя, и что еженедельная серия **уезжает на час** после
   перехода на летнее время.

2. **Test suite даёт ложную уверенность.** 128 календарных тестов зелёные. Они зелёные потому, что
   ни один тест не фиксирует TZ, а ключевой тест «parses non-UTC datetime» вычисляет ожидание тем же
   выражением, что и реализация — тавтология, которая закрепляет баг и не может упасть.
   TZ-pinned test matrix — это не «nice to have» в CAL-102, это его главный acceptance-артефакт.

3. **Возражение к scope CAL-102 в roadmap.** Roadmap определяет CAL-102 как «typed contracts +
   документация», с явным «no migration yet» и «mapping *plan*». Это ticket без единого потребителя:
   он произведёт слой типов, который ничего не исполняет, пока живые баги остаются в проде до
   CAL-106. Это ровно тот формат тикета, в котором Codex с наибольшей вероятностью построит
   DDD-слой на 2000 строк. CAL-102 должен быть **вертикальным срезом**, а не бумажным контрактом.

Дополнительно: два бага CAL-101 (`CAL-BUG-101`, `CAL-BUG-103`) дешёвые и должны быть закрыты
**до** CAL-102 — не ради UX, а потому что без них невозможно доверять ручной верификации CAL-102
(молча проглоченная ошибка + stale cache = невозможно отличить «мой маппинг сработал» от
«я смотрю на старый кэш»).

---

## 1. Где что живёт сейчас (фактическая карта)

| Слой | Где | Замечание |
|---|---|---|
| Domain models | **отсутствует** | `src/services/calendar/types.ts:10` `CalendarEventData` — это DTO провайдера, он же UI-модель, он же схема кэша |
| Provider-specific logic | `caldavProvider.ts`, `googleCalendarProvider.ts`, `yandexCalDavAuth.ts` | seam есть, но контракт слишком узкий |
| UI models | `src/services/db/calendarEvents.ts:3` `DbCalendarEvent` | компоненты читают **строку БД** напрямую |
| Persistence / cache | `calendarEvents.ts`, `calendars.ts`, `migrations.ts` v?/v30 | epoch-seconds only |
| CalDAV mapping | `caldavProvider.ts:90-97` → `icalHelper.parseVEventsInRange` | |
| Recurrence | `icalHelper.ts:171-221` (+ `rrule`) | только на CalDAV-пути |
| ICS parsing | `icalHelper.ts` (450 строк, handwritten) | |
| Timezone conversion | **нигде** | `Intl` используется только для форматирования; `timeZone` не передаётся ни разу |
| Attendee model | JSON-строка в `calendar_events.attendees_json` | `{email, displayName?, responseStatus?}` |
| Mail invitation model | `calendar_invitations` (migration v30) + `invitations.ts` | **имеет `timezone_id`/`timezone_warning` — ближе к правильной модели, чем `calendar_events`** |
| FreeBusy | **отсутствует полностью** | `grep -riE "freebusy|free_busy|working_hours"` по `src/` → 0 совпадений |

### Подтверждённые архитектурные смешения

- **UI ↔ provider.** `CalendarPage.loadEvents()` (`CalendarPage.tsx:77-175`) — это sync engine внутри
  React-компонента: discovery календарей, upsert в БД, per-calendar fetch, destructive range delete,
  reload, error mapping. 99 строк в `useCallback` с `eslint-disable exhaustive-deps`.
- **provider ↔ domain.** `CalendarEventData` — одновременно результат парсинга ICS, результат маппинга
  Google JSON и вход в `upsertCalendarEvent`. Нет точки, где можно применить инвариант.
- **ICS ↔ persistence.** `icalData` кладётся в БД целиком (`calendar_events.ical_data`), и UI делает по
  нему **regex** для бизнес-решений: `EventDetailModal.tsx:47`
  `const recurring = /(?:^|\r?\n)RRULE:/i.test(event.ical_data ?? "")`.
  Признак «событие повторяющееся» вычисляется regex'ом по сырому ICS в React-компоненте.
- **timezone ↔ presentation.** Таймзона не существует как данные; она существует только как побочный
  эффект того, в какой зоне запущена машина. См. §2.
- **recurrence ↔ rendering.** Occurrence identity — `${href}::${occurrenceTime}`
  (`icalHelper.ts:215`), где `occurrenceTime` — epoch, вычисленный в зоне зрителя. Identity занятия
  зависит от того, где физически находится пользователь. См. §2.4.

### Дополнительно найдено (не в аудите)

- `src/services/google/calendar.ts` (66 строк) — **мёртвый код**: ни одного импорта в `src/`.
  Дубликат Google Calendar API поверх `GmailClient`, хардкод `calendars/primary`.
- `getCalendarEventsInRangeMulti` (`calendarEvents.ts:93`) содержит `OR calendar_id IS NULL`, а
  `deleteCalendarEventsInRange` фильтрует по `calendar_id = $2`. Следствие: строки с `calendar_id IS NULL`
  **видны во всех календарях и никогда не вычищаются**. Такие строки создаёт RSVP-проекция
  (`invitations.ts:211` `calendarId: null`) → принятое приглашение остаётся вечным дубликатом рядом с
  настоящим событием провайдера.
- `GoogleCalendarProvider.fetchEvents` не обрабатывает `nextPageToken` — при >250 событий в диапазоне
  происходит молчаливое усечение (`syncEvents` пагинацию делает, `fetchEvents` — нет; UI использует
  `fetchEvents`).
- `executeCalendarQueuedAction` (`invitations.ts:185-187`) всегда ставит `blocked` и бросает
  `unsupported capability`, при том что `CalDAVProvider.respondToEvent` реализован и работает.
  Два RSVP-пути, один из них мёртвый.

---

## 2. Timezone review

### 2.1 Как интерпретируется TZID

**Никак.** `parseVEvent` (`icalHelper.ts:117-122`) читает параметры `DTSTART` только для того, чтобы
определить `VALUE=DATE`. `TZID` не читается. `parseICalDateTime(value, isAllDay)`
(`icalHelper.ts:417-441`) не принимает таймзону в принципе — её нет в сигнатуре.

Non-`Z` значение попадает в `new Date(y, m, d, h, min, s)` — конструктор **системной локальной зоны**.

`parseICalendarInvite` (`icalHelper.ts:299-303`) читает `TZID`, но только чтобы записать его в
metadata и поднять `timezoneWarning`, если зона не распознаётся `Intl`. Валидная чужая зона
(`Europe/Moscow` на машине в Бангкоке) warning **не поднимает** и остаётся неприменённой.

### 2.2 Доказательство: instant зависит от зрителя

Прогон копии `parseICalDateTime` под тремя `TZ` (node 22, тот же код что в `icalHelper.ts:417`):

```text
ICS: DTSTART;TZID=Europe/Moscow:20260315T100000
корректный instant: 2026-03-15T07:00:00.000Z

TZ = Asia/Bangkok      -> 2026-03-15T03:00:00.000Z   (ошибка -4 ч)
TZ = America/New_York  -> 2026-03-15T14:00:00.000Z   (ошибка +7 ч)
TZ = UTC               -> 2026-03-15T10:00:00.000Z   (ошибка +3 ч)
```

Ни один из трёх не верен. Один и тот же `.ics` даёт три разных момента времени. `DTSTART:…Z`
обрабатывается корректно — поэтому баг невидим на Yandex-календарях, которые отдают UTC, и
проявляется на приглашениях от Exchange/Outlook/Google, которые отдают `TZID`.

### 2.3 Floating time

Floating (`DTSTART:20260315T100000` без `Z`, без `TZID`) обрабатывается формально правильно
(локальная зона наблюдателя = семантика RFC 5545), но **неотличим** от TZID-события: обе формы
схлопываются в один и тот же путь. Флага `floating` в модели нет, поэтому даже правильный случай
нельзя сохранить и воспроизвести.

### 2.4 All-day / `VALUE=DATE`

- Парсится как `new Date(y, m, d)` — **локальная полночь**, сохраняется как epoch.
  Тот же `20260315` даёт `1773507600` (Бангкок), `1773547200` (Нью-Йорк), `1773532800` (UTC).
  Кэш непереносим: пользователь переехал/сменил зону — все all-day события в БД сдвинулись.
- Exclusive end на чтении CalDAV работает случайно-правильно (MonthView сравнивает `end_time > dayStart`).
- **На записи ломается.** `formatEventDate` (`icalHelper.ts:389-392`) делает `new Date(value)`, затем
  локальные геттеры. Для ISO-date-only строки JS парсит UTC-полночь:

```text
formatEventDate("2026-03-15", allDay=true)
  TZ = UTC              -> 20260315   OK
  TZ = Asia/Bangkok     -> 20260315   OK
  TZ = America/New_York -> 20260314   OFF BY ONE DAY
```

- **Google и CalDAV имеют разную семантику all-day end в одной и той же колонке БД.**
  `googleCalendarProvider.ts:246` делает `new Date(end.date + "T23:59:59")`, хотя Google `end.date`
  exclusive. CalDAV-путь парсит ту же дату как exclusive-полночь. Для события 15→16(excl):

```text
Google  end -> 2026-03-16T16:59:59.000Z
CalDAV  end -> 2026-03-15T17:00:00.000Z
разница: ~24 часа
```

Это самое короткое доказательство необходимости provider-neutral domain: два адаптера пишут
несовместимые значения в `calendar_events.end_time`, и ни один слой ниже не может это заметить.

### 2.5 DST

Ломается в обе стороны — см. §3.2. Никакой disambiguation-политики для spring gap / fall overlap
не существует, потому что нет кода, который бы конвертировал wall time в instant.

### 2.6 Round-trip: меняется ли wall-clock

**Да.**

- `updateVEventFields` → `formatEventDate(..., allDay=false)` → `formatDateTimeUTC` — всегда пишет
  `…Z`. `replaceEventProperty` (`icalHelper.ts:394-399`) использует regex
  `DTSTART(?:;[^:\r\n]*)?:` — параметры затираются вместе со значением. Любое редактирование времени
  превращает TZID-событие в абсолютный UTC-момент: серия теряет wall-clock anchor и после
  ближайшего DST-перехода сдвигается для всех участников.
- `generateVEvent` (`icalHelper.ts:54-55`) тоже пишет только UTC. Созданное в Office360 событие
  не имеет таймзоны в принципе.
- `SEQUENCE`/`DTSTAMP` при мутации не обновляются — для будущего iTIP это некорректно по RFC 5546.
- Смягчающее обстоятельство: правка только SUMMARY/DESCRIPTION/LOCATION не трогает `DTSTART`,
  и время у recurring-событий в UI задизейблено (`EventDetailModal.tsx:115-116`). Т.е. худший
  сценарий сейчас достижим на одиночных TZID-событиях, а не на сериях.

### 2.7 Можно ли строить Free/Busy поверх текущей модели

**Нет.** Free/Busy — это арифметика над интервалами. Интервалы сейчас (а) зависят от зоны машины,
(б) расходятся между провайдерами на сутки для all-day, (в) сдвигаются на час у серий через DST.
Планировщик, построенный на этом, будет уверенно предлагать неверные слоты — худший класс дефекта
для календаря, потому что ошибка не видна пользователю до момента срыва встречи.

---

## 3. Recurrence review

### 3.1 Что реально поддерживается

| Свойство | Статус |
|---|---|
| `RRULE` (первый) | expand через `rrule` — работает для UTC dtstart |
| `EXDATE` | парсится, matching ненадёжен (§3.3) |
| `RECURRENCE-ID` overrides | парсится, matching ненадёжен (§3.3); `RANGE=THISANDFUTURE` игнорируется |
| Cancelled override | учитывается (`icalHelper.ts:207`) |
| `RDATE` | **не поддерживается вообще** — `getProperty(master.block, "RRULE")` единственная точка входа |
| Множественные `RRULE` | только первая (`getProperty` = `.find()`) |
| `DURATION` вместо `DTEND` | **не поддерживается** — fallback `startTime + 3600` (`icalHelper.ts:151`) |
| Scope (this / this+future / series) | **отсутствует** |
| Создание/редактирование recurrence | **отсутствует** |
| Recurrence на Google-пути | отсутствует — Google отдаёт `singleEvents=true`, разворачивает сервер |

Последнее важно архитектурно: **два провайдера используют две разные модели повторов**
(client-side expansion vs server-side expansion) и пишут в один кэш с разными ключами identity.
Google-инстанс — это `remoteEventId` вида `master_20260315T100000Z`; CalDAV-инстанс — синтетический
`instanceId`. Один и тот же concept, две несовместимые адресации.

Ещё: `CalDAVProvider.syncEvents` (`caldavProvider.ts:202-208`) вызывает `parseVEvent`, а не
`parseVEventsInRange` — **на sync-пути повторы не разворачиваются вообще**. Два пути чтения одного
провайдера дают разный результат.

### 3.2 Доказательство: DST ломает wall-clock

Прогон реальной связки из `parseVEventsInRange` (`rrulestr` + `dtstart: new Date(startTime*1000)` +
`.between()`), `rrule@2.8.1` из `node_modules` репозитория:

```text
ICS: DTSTART;TZID=America/New_York:20260301T100000
     RRULE:FREQ=WEEKLY;BYDAY=SU;COUNT=4
US DST начинается 2026-03-08. Все четыре occurrence обязаны читаться как 10:00 local.

TZ = America/New_York:
  2026-03-01, 10:00   (2026-03-01T15:00:00Z)
  2026-03-08, 11:00   (2026-03-08T15:00:00Z)   <-- сдвиг
  2026-03-15, 11:00   (2026-03-15T15:00:00Z)   <-- сдвиг
  2026-03-22, 11:00   (2026-03-22T15:00:00Z)   <-- сдвиг
```

Классический баг «разворачиваем в absolute instants вместо wall time». Instant консервируется
(15:00Z), настенное время уезжает. Для Europe/Moscow (без DST с 2014) не воспроизводится — поэтому
на Яндексе он невидим и проявится ровно тогда, когда появится первый участник из зоны с DST.

### 3.3 Доказательство: EXDATE / RECURRENCE-ID matching зависит от зоны

Совпадение occurrence с исключением делается по **точному равенству epoch-секунд**
(`icalHelper.ts:190,205-206`), где обе стороны прошли через zone-зависимый `parseICalDateTime`:

```text
TZ = America/New_York:
  EXDATE:20260315T150000Z          (UTC-форма)   -> совпало       ✔
  EXDATE;TZID=…:20260315T100000    (wall-форма)  -> НЕ совпало    ✘

TZ = Europe/Moscow:
  EXDATE:20260315T150000Z          (UTC-форма)   -> НЕ совпало    ✘
  EXDATE;TZID=…:20260315T100000    (wall-форма)  -> совпало       ✔
```

То есть: **ровно одна из двух распространённых кодировок EXDATE молча не срабатывает, и какая
именно — зависит от таймзоны пользователя.** Отменённое занятие продолжает отображаться.
Та же логика (`getDateProperty` → epoch-равенство → `Map`) используется для `RECURRENCE-ID`, значит
override'ы серии теряются по тому же правилу.

### 3.4 Безопасно ли расширять текущий parser

Нет — не из-за «handwritten», а потому что дефекты структурные: identity строится на
zone-зависимом числе, а расширение (RDATE, THISANDFUTURE, scope-aware CRUD) требует смены именно
этого ключа. Каждое расширение поверх epoch-identity увеличивает объём последующей миграции.

### 3.5 Нужен ли отдельный recurrence domain layer

Нужен, но **маленький и чистый**: `expand(master: RecurrenceSpec, window: Interval): Occurrence[]`,
где `RecurrenceSpec` содержит wall-clock DTSTART + TZID + rules/dates/exclusions, а `Occurrence`
несёт канонический `occurrenceKey`. Полноценный «recurrence engine» писать не нужно.

### 3.6 Библиотека

`rrule@2.8.1` уже в зависимостях и **проблема не в нём**. Проблема в том, что ему скармливают
absolute instant. Стандартный корректный паттерн — разворачивать в naive wall-time и локализовать
результат по TZID события. Это исправление на уровне вызывающего кода, не замена библиотеки.
Замена `rrule` в CAL-102 — не нужна и является одним из ожидаемых over-engineering-рисков.

### 3.7 Критичные для Free/Busy edge cases

`DST transition` (§3.2 — воспроизведён), `EXDATE with TZID` (§3.3 — воспроизведён),
`RECURRENCE-ID overrides` (§3.3), `RDATE` (не поддержан), `COUNT`/`UNTIL` (UNTIL всегда UTC — сейчас
случайно ок), `BYDAY`/`BYSETPOS`/monthly (делегированы `rrule`, ок при корректном dtstart),
`DURATION` (не поддержан → все такие события получают фиктивный 1 час — прямая ложь в занятости).

---

## 4. ICS / iCalendar review

Оценка сделана по фактическим дефектам, а не по факту рукописности.

### 4.1 Воспроизведённые дефекты

| # | Дефект | Доказательство |
|---|---|---|
| 1 | Quoted-параметр, содержащий `:`, разрушает разбор строки | `DESCRIPTION;ALTREP="https://ex.com/desc":Body` → `params.ALTREP = "\"https"`, `value = "//ex.com/desc\":Body"`. `ALTREP` штатно эмитит Exchange/Outlook. Оба пути (`parseVEvent` через `split(":")`, `parseContentLine` через `indexOf(":")`) уязвимы одинаково |
| 2 | LF-folding не разворачивается | `unfoldLines` (`icalHelper.ts:327`) снимает только `\r\n`+WSP, затем нормализует. LF-свёрнутый контент остаётся отдельной строкой. Это ровно путь `extractICalendarPayloads` из тела письма, где transport мог нормализовать переводы строк |
| 3 | Неверный порядок unescape | `\\n` → backslash + **NEWLINE** вместо backslash + `n` (проверено: `92,92,110` → `92,10`, ожидалось `92,110`). `\\` должен обрабатываться в один проход, а не последним |
| 4 | Нет folding при генерации | `escapeICalText` не сворачивает строки >75 октетов и не экранирует `\r`. Длинный DESCRIPTION даёт невалидный ICS |
| 5 | `VTIMEZONE` игнорируется полностью | Нестандартные Outlook-TZID (`Russia TZ 2 Standard Time`) неразрешимы в принципе |
| 6 | `DURATION` не поддержан | см. §3.7 |
| 7 | `RDATE`, множественные `RRULE`/`EXDATE`-строки | см. §3.1 |
| 8 | Не читаются `TRANSP`, `CLASS`, `VALARM`, `CATEGORIES`, `URL`, `X-*` | `TRANSP` — прямой prerequisite Free/Busy |
| 9 | `ATTENDEE`: нет `ROLE`, `CUTYPE`, `RSVP`, `DELEGATED-*`, `PARTSTAT` не нормализован | см. §5 |
| 10 | Генерация: нет `METHOD`, `SEQUENCE`, `ORGANIZER`, `RRULE`, `STATUS`, `TRANSP`, `TZID` | iTIP невозможен |

### 4.2 Вердикты

**ICS parsing → REPLACE.** Обоснование техническое, не стилистическое: дефекты 1, 2, 3, 5 —
следствие модели «regex + split», а не отдельные промахи. Корректный разбор content-line требует
state-machine, учитывающей quoted-strings; корректный TZID требует `VTIMEZONE`. Писать это вручную —
воспроизводить тот же класс багов. Замена обязана быть **за портом** (`ICalendarCodec`), текущие
37 тестов `icalHelper.test.ts` сохраняются как compatibility-фикстуры — с поправкой на §4.4.

**ICS serialization → REPLACE (вместе с parsing).** Оставить рукописную генерацию при заменённом
парсере — гарантировать асимметричный round-trip. Плюс генерация не умеет folding, TZID, VTIMEZONE
и RRULE — это не «дополнить», это написать заново; дешевле взять то же, что и для чтения.

**iTIP message generation → BUILD LATER (не KEEP/EXTEND/REPLACE — заменять нечего).**
Кода нет. Строить поверх кодека, отдельным тикетом, после identity-модели. В CAL-102 не входит.

### 4.3 Рекомендация по библиотеке

| Область | Решение | Обоснование |
|---|---|---|
| ICS parse+serialize | **`ical.js`** (Mozilla, **MPL-2.0**) | Единственная зрелая JS-реализация с `VTIMEZONE`, `ICAL.Time`/`ICAL.Timezone`, корректным folding/escaping/quoted-params. MPL-2.0 — file-level copyleft: для проприетарного `"license": "UNLICENSED"` десктопа приемлемо, пока файлы библиотеки не модифицируются. **Требует явного одобрения владельца** (лицензия + bundle) |
| Recurrence | **оставить `rrule@2.8.1`** (BSD-3) | Библиотека не виновата; исправляется способ вызова (§3.6). `ICAL.RecurExpansion` можно оценить позже, но не в CAL-102 |
| Timezone | **новую зависимость не добавлять** | Нужное берётся из `Intl.DateTimeFormat` (`timeZoneName: "longOffset"` / `formatToParts`) — ~40 строк на IANA-offset resolver + явная DST-политика. Temporal-полифилл/`luxon`/`date-fns-tz` = вторая система времени в проекте, bundle и путаница. **Явно запретить в CAL-102** |
| Calendar grid UI | **решение отложить** | Не относится к фундаменту. Готовая сетка будет навязывать свою событийную модель — выбирать её до стабилизации domain опасно. Решать на тикете layout engine |

Fallback, если владелец не одобряет новую зависимость: CAL-102 делится на 102a (модель времени +
identity + TZ-pinned матрица, поверх упрочнённого ручного разбора content-line) и 102b (кодек).
102a остаётся полезным и самодостаточным.

### 4.4 Отдельно про существующие тесты

`icalHelper.test.ts:405-421` («parses non-UTC datetime») формирует ожидание выражением
`new Date(2025, 5, 20, 14, 0, 0)` — тем же, что и реализация. Тест не может упасть ни в какой зоне и
**закрепляет** баг §2.2. При переносе в compatibility-фикстуры такие тавтологические тесты нужно
не мигрировать, а переписать на явные instant'ы.

Recurrence-тесты (`icalHelper.test.ts:539-594`) используют исключительно `DTSTART:…Z` и
`EXDATE:…Z` — единственную форму, которая работает. Ни одного TZID/DST-кейса.

---

## 5. Attendee model review

Текущее: `{ email, displayName?, responseStatus? }` в JSON-строке. Организатор — отдельная
почтовая строка. Ввод участников — comma-separated `TextField`.

| Потребность | Сейчас |
|---|---|
| required / optional | нет (`ROLE` не парсится) |
| organizer | есть как email-строка, без authority-семантики |
| RSVP | параметр `RSVP` не парсится; генерация всегда `RSVP=TRUE` |
| PARTSTAT | сырое значение в lowercase, без словаря; UI (`EventDetailModal.tsx` `PersonChip`) хардкодит `accepted`/`declined`/`needs-action` |
| ROLE / CUTYPE | нет |
| delegation (`DELEGATED-TO/FROM`) | нет |
| resource / room | нет (следствие отсутствия `CUTYPE`) |
| email identity | сырая строка, нормализация только `.toLowerCase()` в двух местах |
| internal user identity | нет |

**Ответ на главный вопрос: строить Free/Busy на текущей модели нельзя, но и полная нормализация
identity в CAL-102 не нужна.** Правильная граница:

- В CAL-102 требуется **только одно**: перестать использовать сырую строку как ключ. Ввести
  `ParticipantRef = { kind: "email" | "directory" | "provider"; value: string; normalized: string }`
  и нормализовать email в одном месте. Это ~30 строк и снимает будущую миграцию ключей.
- Полная нормализация (таблица `calendar_attendees`, ROLE/CUTYPE/RSVP/delegation, directory-resolver,
  participant picker) — отдельный тикет **перед** FreeBusy, не раньше.

Порядок: identity-normalization должна предшествовать FreeBusy, потому что FreeBusy адресуется
участниками, и менять адресацию после появления кэша занятости дороже.

---

## 6. Free/Busy readiness

Не реализуется сейчас. Ниже — целевой contract, адаптированный к реальной архитектуре
(порт рядом с `CalendarProvider`, реализация — адаптеры провайдеров, вызывающий — application service,
не компонент).

```ts
// src/services/calendar/domain/freeBusy.ts  (будущее)

export interface FreeBusyQuery {
  participants: ParticipantRef[];          // §5, не сырые строки
  interval: { start: Instant; end: Instant };
  displayTimeZone: string;                 // IANA — только для отрисовки дорожек
  options?: {
    granularityMinutes?: number;           // 15 | 30
    calendars?: CalendarRef[];             // по умолчанию — default set участника
    includeTentative?: boolean;            // default true
    includeDeclined?: boolean;             // default false
    signal?: AbortSignal;                  // отменяемость обязательна
  };
}

export type BusyKind = "busy" | "tentative" | "out-of-office" | "working-elsewhere";
export interface BusyInterval { start: Instant; end: Instant; kind: BusyKind }

export type AvailabilityState =
  | "known" | "partial" | "unknown" | "permission-denied" | "unsupported";

export interface ParticipantAvailability {
  participant: ParticipantRef;
  state: AvailabilityState;                // НИКОГДА не сворачивать unknown в free
  busy: BusyInterval[];                    // opaque: без summary/location/uid — и в логах тоже
  workingHours: WorkingHoursWindow[] | null;
  timeZone: string | null;                 // зона участника, не зрителя
  fetchedAt: Instant;
  staleAfter: Instant;                     // короткий TTL
}

export interface FreeBusyPort {
  getAvailability(query: FreeBusyQuery): Promise<ParticipantAvailability[]>;
}
```

**Ключевое проектное требование: `state` обязателен и `unknown ≠ free`.** Yandex CalDAV поддержка
RFC 6638 `free-busy-query` не подтверждена; для внешних участников derived-режим (вывод занятости из
читаемых календарей) просто не даст данных. Если модель не умеет сказать «не знаю», scheduling
assistant будет уверенно рекомендовать слоты на основании отсутствия данных. Это надо заложить в
контракт с первого дня, а не «добавить потом».

### Отсутствующие prerequisites (по убыванию критичности)

1. Корректные instants и all-day-семантика — **§2, сломано**.
2. DST-безопасный expansion повторов — **§3, сломано**.
3. `TRANSP` — **не парсится вовсе**; без него занятость не отличить от «свободен, но в календаре».
4. Participant identity — **§5**.
5. Capability declaration провайдера — отсутствует (сейчас capability = «есть ли метод в объекте»).
6. Working hours — отсутствуют (нет ни таблицы, ни настройки).
7. Permissions / privacy projection — отсутствуют.
8. Batching / rate-limit / cancellation — отсутствуют; при текущем `getClient()` (§7) каждый запрос
   означал бы новый login.
9. Зона каждого участника — отсутствует.

Пункты 1–3 — предмет CAL-102. Пункты 4–9 — последующие тикеты. Строить FreeBusy до закрытия 1–3
бессмысленно: он будет корректно считать по неверным интервалам.

---

## 7. Provider abstraction

`CalendarProvider` (`types.ts:57-78`) — рабочий seam, но контракт узкий: 7 методов, единственный
optional (`respondToEvent?`), т.е. **capability выражается наличием метода в объекте** и проверяется
как `if (!provider.respondToEvent)` в React-компоненте (`EventDetailModal.tsx:92`).

Для будущих операций (`freebusy`, `invitations`, `permissions`, scope-aware CRUD, delta-sync) этого
не хватит: нужны не только «есть/нет», но и режим («native» / «derived» / «none») и параметры
(поддерживаемые recurrence-scope, max batch, поддержка ETag/ctag/sync-token).

### Не построим ли мы FreeBusy «только под Yandex»

Риск реальный и уже материализовался в двух местах:

- `providerFactory.ts` содержит две недостижимые ветки: `account.provider === "gmail_api"` проверяется
  дважды (строки 37 и 41), вторая мертва. Признак того, что routing правился инкрементально
  под конкретные аккаунты.
- `mapGoogleEvent` и `parseVEvent` дают разную all-day-семантику (§2.4) — то есть **уже сейчас**
  «под каждого провайдера своя правда», и никто этого не заметил, потому что проверяли на одном.

Митигирующая мера, дешёвая и обязательная в CAL-102: **conformance-набор тестов, единый для обоих
провайдеров** — один и тот же набор входов (all-day, TZID, floating, серия через DST, override) и
одинаковые ожидания на выходе доменного маппинга. Если Codex сделает FreeBusy «под Yandex»,
conformance-набор это покажет ещё до появления FreeBusy.

### Где должен находиться provider-neutral domain

`src/services/calendar/domain/` — чистые типы + чистые функции, **ноль импортов** из `db/`,
`components/`, `tsdav`, `@tauri-apps/*`. Провайдеры импортируют domain и мапят в него; репозитории
импортируют domain и сериализуют его; компоненты читают проекции domain. Правило проверяемо
статически (lint-правило на запрещённые импорты) — рекомендую заложить как DoD-пункт.

### Нужные capability-флаги (минимальный набор)

```ts
interface CalendarProviderCapabilities {
  readonly version: 1;
  events: { create: boolean; update: boolean; delete: boolean };
  recurrence: { read: boolean; write: boolean; scopes: RecurrenceScope[] };   // "instance"|"future"|"series"
  rsvp: "direct" | "imip" | "none";
  freeBusy: "native" | "derived" | "none";
  acl: "read" | "read-write" | "none";
  reminders: boolean;
  sync: { mode: "sync-token" | "ctag" | "full"; pagination: boolean };
  conflictDetection: "etag" | "sequence" | "none";
}
```

В CAL-102 достаточно **объявить тип и заполнить его для двух существующих провайдеров** (тривиально,
значения известны). Реализацию соответствующих операций — по тикетам.

---

## 8. Local cache / sync

| Вопрос | Ответ по коду |
|---|---|
| Source of truth | Формально — провайдер, фактически — `calendar_events`, потому что UI читает только БД, а провайдер пишет в неё деструктивно |
| Stale data | Не маркируется никак; см. CAL-BUG-101 |
| Optimistic changes | Отсутствуют; после мутации — полный `loadEvents()` |
| Sync conflicts | ETag передаётся в CalDAV update/delete; `412` не обрабатывается отдельно — попадает в общий `assertDavResponseOk` и далее в §CAL-BUG-101 |
| Provider updates | Push отсутствует; обновление только по смене диапазона/аккаунта |
| Offline | Состояния нет; offline выглядит как «те же события, что и раньше» |

Главный дефект — **деструктивный range-refresh без транзакции**
(`CalendarPage.tsx:131-135`): для каждого видимого календаря сначала `DELETE … WHERE start<end AND end>start`,
затем построчный `upsert` в цикле. Между delete и завершением цикла кэш неполон; ошибка на
N-м календаре оставляет предыдущие перезаписанными, текущий — с дырой в диапазоне, а исключение
уходит в `console.error`. Плюс `deleteCalendarEventsInRange` не трогает строки с `calendar_id IS NULL`,
которые при этом видны в выборке (§1) — накопление вечных дублей.

Связь с CAL-BUG-101: баг не «пользователь не увидел красную плашку». Баг в том, что **единственный
сигнал о частично разрушенном кэше — `console.error`**. Именно поэтому его надо закрыть до CAL-102:
иначе верификация нового маппинга не отличима от чтения остатков старого.

Связь с будущим Scheduler: планировщик читает занятость из нескольких календарей нескольких
участников. Модель «удалить диапазон и залить заново» на этом не масштабируется — нужны
generation/tombstone-based refresh и явные состояния `fresh | stale | failed | partial` на уровне
(account, calendar, range).

---

## 9. CAL-BUG-103 — оценка

Факт подтверждён в коде: `caldavProvider.ts:31` — `if (this.client && !usesYandexOAuth) return this.client;`
и `caldavProvider.ts:63` — `if (!usesYandexOAuth) this.client = client;`. Для Yandex OAuth клиент
не кэшируется никогда; `listCalendars()` и каждый `fetchEvents()` выполняют
`ensureFreshToken()` + `DAVClient.login()` + principal/home-set discovery заново.

Отмечу: `providerFactory` **кэширует сам `CalendarProvider`** (`providerFactory.ts:8,44`), т.е.
проблема именно на уровне DAV-клиента, не фабрики.

**Это не performance issue. Это architectural smell.** Комментарий в коде (`caldavProvider.ts:61-63`)
называет настоящую причину: DAVClient захватывает токен в auth-callback, поэтому «клиент не должен
жить дольше токена». Отсутствует понятие **provider session** — объекта, владеющего парой
(клиент, срок жизни credential). Кэширование отключили целиком, потому что не было чем выразить
«кэшировать до истечения токена».

- **Риск stale credentials: реальный.** Наивное кэширование без учёта expiry даст 401-петлю после
  refresh — именно этого автор и избегал. Поэтому фикс обязан быть expiry-aware + single-flight,
  а не «добавить `this.client = client`».
- **Текущее влияние:** каждая смена месяца = login+discovery на список календарей и ещё по одному
  на каждый видимый календарь; React StrictMode/remount даёт параллельные логины (это и наблюдалось
  в CAL-101A). Latency и flakiness, но не текущий отказ.
- **Будущее влияние:** для FreeBusy (батчи по участникам) и delta-sync per-call login фатален.

**Вердикт: fix before CAL-102, отдельным маленьким тикетом (CAL-101C).** Не «во время» — иначе
scope CAL-102 размывается провайдерной инфраструктурой. Не «отложить» — потому что фикс дешёвый
(single-flight promise + сравнение expiry + сброс при 401), а без него live-smoke CAL-102 медленный
и шумный. Нужен `CalDavSession` (или расширение `providerFactory` до session-manager) — но
минимальный: одно поле `{ client, tokenFingerprint, expiresAt }` + inflight-promise.

---

## 10. Критика предложенного порядка и рекомендуемая последовательность

### Что не так с roadmap-ordering

1. **CAL-102 как «contracts only, no migration, mapping plan»** — тикет без потребителя. Типы,
   которые ничего не исполняют, невозможно проверить, и они провоцируют разрастание. Кроме того
   «no migration yet» делает модель непредставимой в хранилище: `calendar_events` физически негде
   хранить `tzid`/wall-anchor, значит контракты останутся мёртвыми до CAL-103.
2. **Time и identity разнесены** (CAL-102 время / CAL-103 схема-identity). Они неразделимы:
   occurrence identity **является** значением времени (§3.3, `RECURRENCE-ID`). Разнесение по тикетам
   гарантирует вторую миграцию ключей.
3. **Кодек (CAL-106) стоит после провайдеров (CAL-104/105)**, хотя TZID-корректность (§2) — это
   вход в маппинг провайдера. Провайдерный слой, построенный до кодека, придётся переделывать.
4. **CAL-BUG-101/103 не имеют места в последовательности** — они найдены после составления roadmap.

### Рекомендуемая последовательность

Нумерация продолжает существующую линию CAL-101\* для багов, найденных гейтом CAL-101, и сохраняет
имя «Calendar Core Foundation» за CAL-102 — но с другим содержанием.

---

#### CAL-101B — Surface calendar load failures and stale state

- **Почему сейчас:** без этого нельзя доверять ручной верификации любого следующего тикета;
  сейчас частично разрушенный кэш неотличим от успешной загрузки.
- **Dependencies:** нет.
- **What NOT to include:** рефакторинг `CalendarPage` в service/store; retry/backoff; offline-очередь;
  редизайн баннеров.
- **DoD:** любая ошибка `loadEvents()` (не только Google 403) даёт пользовательское состояние;
  отображаемые из кэша данные помечаются stale с временем последней успешной синхронизации;
  ошибки локализованы и не содержат токенов/URL/названий событий; unit-тесты на error-mapping
  для не-Google ошибок; `console.error` перестаёт быть единственным каналом.

#### CAL-101C — CalDAV provider session and single-flight login

- **Почему сейчас:** дешёвый фикс, снимающий шум и flakiness из всех последующих live-smoke; §9.
- **Dependencies:** нет.
- **What NOT to include:** общий session-manager для всех провайдеров; connection pool; retry-политика;
  изменения OAuth-флоу.
- **DoD:** DAV-клиент переиспользуется, пока действителен токен; single-flight на создание;
  инвалидация по expiry, по 401 и по смене credential; `listCalendars` + N `fetchEvents` дают
  **один** login вместо N+1; тест на «токен обновился → создан новый клиент»;
  тест на «параллельные вызовы → один login».

#### CAL-102 — Calendar Core Foundation: event time & occurrence identity

Основной тикет. Детальный scope — §11.

- **Почему сейчас:** §2 и §3 — активные баги корректности; всё остальное (FreeBusy, scheduling,
  drag/resize, iTIP, reminders) — арифметика поверх интервалов и адресация поверх occurrence identity.
- **Dependencies:** CAL-101B, CAL-101C; решение владельца по зависимости-кодеку (§4.3).
- **What NOT to include:** см. §11 SHOULD NOT HAVE.
- **DoD:** см. §11 MUST HAVE.

#### CAL-103 — iCalendar codec ownership: serialization and round-trip preservation

- **Почему сейчас:** после CAL-102 кодек владеет временем; здесь он забирает остальные свойства и
  запись, закрывая асимметрию чтения/записи.
- **Dependencies:** CAL-102.
- **What NOT to include:** генерация iTIP-сообщений; Mail-пайплайн; VALARM-семантика (только сохранение
  при round-trip); UI.
- **DoD:** генерация через кодек с folding/escaping/TZID/VTIMEZONE; `SEQUENCE`/`DTSTAMP` по RFC при
  мутации; `TRANSP`/`CLASS`/`STATUS`/`URL`/`X-*` читаются и сохраняются при round-trip; неизвестные
  свойства не теряются; исправлен порядок unescape; ALTREP/quoted-params и LF-folded фикстуры зелёные;
  raw ICS редактируется из диагностики.

#### CAL-104 — Calendar sync and cache integrity

- **Почему сейчас:** после того как данные корректны, надо перестать их разрушать; §8.
- **Dependencies:** CAL-102.
- **What NOT to include:** push/websocket; полноценный offline-queue; delta-sync под каждого провайдера
  (только контракт + один рабочий режим); UI-редизайн.
- **DoD:** неразрушающее обновление диапазона (generation/tombstone), атомарность на календарь;
  устранён `calendar_id IS NULL`-leak и дубли RSVP-проекций; состояния `fresh|stale|partial|failed`
  на (account, calendar, range); orchestration вынесен из `CalendarPage` в сервис/стор;
  race-safety при быстрой смене аккаунта/диапазона; пагинация `fetchEvents` для Google.

#### CAL-105 — Provider capability matrix and write-path readiness

- **Почему сейчас:** запись (create/update/delete) должна научиться сохранять TZID и recurrence-scope
  до того, как появится редактор.
- **Dependencies:** CAL-102, CAL-103, CAL-104.
- **What NOT to include:** FreeBusy; ACL; reminders; UI редактора; iTIP.
- **DoD:** `CalendarProviderCapabilities` объявлены и заполнены для Google/CalDAV; conformance-набор
  проходит для обоих; create/update сохраняют TZID и all-day exclusive end; scope-aware mutation
  contract определён (instance/future/series) и реализован хотя бы для `series`; ETag/412 конфликт
  обрабатывается явно; live-smoke на Yandex.

#### CAL-106 — Participant identity and normalized attendees

- **Почему сейчас:** prerequisite FreeBusy; менять адресацию участников после появления кэша занятости
  дороже.
- **Dependencies:** CAL-102, CAL-103.
- **What NOT to include:** FreeBusy; scheduling UI; LDAP/directory-интеграция сверх существующей
  contacts-инфраструктуры; delegation-flow.
- **DoD:** нормализованная таблица attendees с account-scope; ROLE/CUTYPE/RSVP/PARTSTAT/delegation
  читаются и пишутся; `ParticipantRef` — единственный ключ адресации; participant picker поверх
  существующего `AddressInput`; дедупликация; тесты изоляции аккаунтов.

#### CAL-107 — Calendar layout engine (Month / Week / Day)

- **Почему сейчас:** после стабилизации модели; текущая почасовая корзина дублирует событие в каждый
  перекрытый час (`WeekView.tsx:50-59`) и непригодна как база для drag/resize.
- **Dependencies:** CAL-102, CAL-104. Решение по UI-библиотеке принимается здесь, не раньше.
- **What NOT to include:** drag/resize; scheduling-дорожки; редактор.
- **DoD:** непрерывное позиционирование и высота по длительности; детерминированные колонки перекрытий;
  all-day/multi-day дорожки и overflow; current-time индикатор; настраиваемое начало недели;
  рендер в зоне пользователя с явной зоной события; клавиатура и screen-reader; тесты плотностей и тем.

#### CAL-108 — Event editor: recurrence scope, timezone, reminders

- **Dependencies:** CAL-102, CAL-103, CAL-105, CAL-106, CAL-107.
- **What NOT to include:** FreeBusy-панель; scheduling assistant; iTIP-отправка.
- **DoD:** all-day, зона события, recurrence presets/custom, **обязательный scope-prompt** для
  instance/future/series при правке и удалении (сейчас удаление занятия удаляет весь `.ics`-объект —
  §12); reminders; TRANSP/CLASS; поля включаются по capability провайдера; a11y и i18n.

#### CAL-109 — Privacy-safe FreeBusy port

- **Dependencies:** CAL-104, CAL-105, CAL-106.
- **What NOT to include:** scheduling UI; suggested-time solver; working-hours-редактор (только чтение
  дефолтов).
- **DoD:** контракт §6 реализован; `unknown`/`permission-denied` никогда не сворачиваются в `free`;
  opaque-интервалы без summary/location — включая логи; короткий scoped TTL; batching, отмена,
  rate-limit; capability-driven native/derived/none; тесты приватности.

#### CAL-110 — Scheduling assistant

- **Dependencies:** CAL-107, CAL-109.

**Параллелизуемо:** Mail inbound ingestion и outbound iTIP (бывшие CAL-107/108 в старом roadmap)
зависят от CAL-103 и CAL-106, но не от layout — их можно вести параллельно ветке CAL-107/108,
если не пересекаются write-ветки по провайдерам и миграциям.

---

## 11. CAL-102 — точный scope

**Название:** `CAL-102 — Calendar Core Foundation: event time & occurrence identity`

Принцип: **вертикальный срез, а не слой типов.** Всё, что добавляется, должно иметь потребителя
в том же PR. Тикет закрывает ровно два класса дефектов — время и адресацию занятий — и ничего больше.

### MUST HAVE

1. **Доменная модель времени** (`src/services/calendar/domain/time.ts`, чистая, без импортов из
   `db/`, `components/`, `tsdav`, `@tauri-apps/*`):
   - `{ kind: "timed"; instant; tzid: string | null; wall: WallDateTime }`
   - `{ kind: "floating"; wall: WallDateTime }`
   - `{ kind: "allDay"; startDate: CalendarDate; endDateExclusive: CalendarDate }`
   - IANA-offset resolver на `Intl.DateTimeFormat` (без новых зависимостей);
   - явная и документированная политика DST: spring gap → сдвиг вперёд, fall overlap → более ранний
     offset.
2. **Кодек: временной слой.** Разбор `DTSTART`/`DTEND`/`DURATION`/`EXDATE`/`RDATE`/`RECURRENCE-ID`
   с `TZID`, `VALUE=DATE` и разрешением `VTIMEZONE`; сериализация обратно с сохранением `TZID`.
   Поддержка `DURATION` и множественных `EXDATE`/`RDATE`-строк. (Реализация — за портом
   `ICalendarCodec`; выбор реализации — §4.3.)
3. **Occurrence identity.** `occurrenceKey` = канонический UTC iCal-вид `RECURRENCE-ID`
   (зоно-независимая строка) вместо `${href}::${epochSeconds}`. Сопоставление `EXDATE` и
   `RECURRENCE-ID`-override'ов — по `occurrenceKey`, не по равенству epoch (§3.3).
4. **DST-безопасный expansion.** `rrule` сохраняется; разворачивание — в wall-clock, локализация —
   после, по `tzid` события. Поддержать `RDATE`. `CalDAVProvider.syncEvents` использует тот же путь,
   что и `fetchEvents` (сейчас — разные, §3.1).
5. **Additive-миграция** `calendar_events`: `time_kind`, `tzid`, `wall_start`, `wall_end`,
   `end_date_exclusive`, `series_uid`, `occurrence_key`, `is_recurrence_master`, `transp`, `sequence`.
   Только `ALTER TABLE ADD COLUMN`; существующие строки читаемы; backfill ленивый из `ical_data`;
   `start_time`/`end_time` сохраняются как производные для существующих запросов диапазона.
   **Требует APOSTLE migration confirmation.**
6. **Provider mapping boundary.** Оба провайдера мапят в доменную модель:
   - CalDAV — через кодек;
   - Google — `start.timeZone`/`end.timeZone` больше не выбрасываются; **исправить all-day
     exclusive-end** (`googleCalendarProvider.ts:246`); убрать
     `Intl.DateTimeFormat().resolvedOptions().timeZone` как источник зоны события.
7. **`ParticipantRef` (минимальный).** Нормализация email в одной функции; тип введён и используется
   в маппинге. Без нормализованной таблицы (§5).
8. **`CalendarProviderCapabilities` — только объявление типа и заполнение для двух провайдеров.**
   Реализация операций — не здесь (§7).
9. **Test matrix — главный acceptance-артефакт.**
   - vitest прогоняет time/codec/recurrence-наборы под **пиннингом TZ**:
     `UTC`, `Europe/Moscow`, `America/New_York`, `Australia/Lord_Howe` (30-минутный offset + DST);
   - фикстуры: `Z`, `TZID`, floating, all-day, `DURATION`, DST spring gap, DST fall overlap,
     `EXDATE` в обеих кодировках, `RECURRENCE-ID` override, `RDATE`, folded-строки (CRLF **и** LF),
     quoted-параметр с `:` (ALTREP);
   - **conformance-набор, единый для Google и CalDAV** (§7) — одинаковый вход, одинаковые ожидания
     на выходе домена;
   - тавтологические тесты (`icalHelper.test.ts:405-421`) переписаны на явные instant'ы;
   - результат каждого прогона идентичен во всех четырёх TZ.

### SHOULD NOT HAVE (сознательно отложено)

1. Нормализованная таблица attendees, ROLE/CUTYPE/delegation, participant picker → CAL-106.
2. Free/Busy — что угодно: порт, кэш, адаптеры, working hours → CAL-109.
3. iTIP-генерация, Mail inbound/outbound пайплайн, RSVP-доставка.
4. Reminders / VALARM-семантика (round-trip-сохранение — да, поведение — нет).
5. Recurrence-**редактирование**, scope-prompt UI, drag/resize, layout engine → CAL-107/108.
6. Полный вынос `CalendarPage` в service/store → CAL-104. В CAL-102 двигается только маппинг-шов.
7. Замена `rrule` (§3.6).
8. Любая timezone-библиотека — Temporal-полифилл, luxon, date-fns-tz (§4.3).
9. Любая календарная UI-библиотека.
10. Permissions / ACL / privacy projection.
11. Перезаливка/пересборка `calendar_events` — только additive.

### RISKS — где Codex вероятнее всего уйдёт в over-engineering

1. **DDD-слой без потребителя.** Aggregates, repositories, command bus, `CalendarEventAggregate`,
   мапперы в обе стороны на каждый слой. *Guard:* каждый новый тип обязан иметь вызывающего в том же
   PR; отсутствие потребителя = блокирующее замечание на ревью.
2. **Добавление time-библиотеки «для корректности».** Даёт вторую систему времени и bundle-рост.
   *Guard:* единственная разрешённая новая зависимость — ICS-кодек, и только с одобрения владельца.
3. **Переписывание парсера «начисто» вместо замены за портом**, или замена парсера и переработка
   views в одном PR. *Guard:* `ICalendarCodec` как обязательная граница; views в этом тикете не
   меняются.
4. **Миграция как rewrite таблицы** или как обязательный полный backfill-скрипт. *Guard:*
   только `ADD COLUMN`, ленивый backfill, отдельное подтверждение миграции.
5. **«Тесты зелёные — значит готово» без TZ-pinned матрицы.** Ловушка уже сработала один раз в этом
   репозитории (§4.4). *Guard:* матрица — явный DoD-пункт, не следствие.
6. **Расползание в FreeBusy/attendees «раз уж мы здесь».** *Guard:* SHOULD NOT HAVE — часть DoD;
   любой файл из `domain/freeBusy*`, `calendar_attendees` или `components/calendar/*` в диффе =
   выход за scope.
7. **Введение `Instant` как класса с методами** вместо числа/branded-типа → сериализация,
   equality, тесты. *Guard:* доменные типы — plain data, поведение — в чистых функциях.

---

## 12. Прочие находки, требующие тикета (вне CAL-102)

| # | Находка | Куда |
|---|---|---|
| 1 | Удаление занятия серии удаляет **весь** `.ics`-объект: `EventDetailModal.handleDelete` использует `remote_event_id` (URL мастера), guard по `recurring` есть только на полях времени. Предупреждение о серии показывается лишь в форме редактирования | CAL-108 (scope-prompt); до тех пор — рассмотреть быстрый guard |
| 2 | RSVP на занятии серии меняет PARTSTAT мастера для всей серии (`updateAttendeeParticipation` правит первое совпадение) | CAL-108 |
| 3 | RSVP-проекция пишет строки с `calendar_id = null`, невидимые для очистки, видимые для выборки → вечные дубли | CAL-104 |
| 4 | `executeCalendarQueuedAction` всегда `blocked`, хотя `respondToEvent` работает — два RSVP-пути, один мёртвый | CAL-105 / iTIP-тикет |
| 5 | `GoogleCalendarProvider.fetchEvents` без пагинации → молчаливое усечение на >250 событий | CAL-104 |
| 6 | `src/services/google/calendar.ts` — мёртвый код, 0 импортов | уборка, отдельный chore |
| 7 | `providerFactory.ts:41` — недостижимая ветка (`gmail_api` проверен на строке 37) | уборка, отдельный chore |
| 8 | `providerCache` не инвалидируется при удалении аккаунта / смене OAuth-credential (только `CalDavSettings`) | CAL-101C |
| 9 | `EventDetailModal.tsx:47` — regex по сырому ICS как бизнес-признак повторяемости | CAL-102 (побочно: появляется `is_recurrence_master`) |

---

## 13. Итог

Гипотеза «следующий фундаментальный этап — Calendar Core Foundation» **подтверждается**.
Содержание CAL-102 из roadmap **требует замены**: вместо «контракты и план маппинга без миграции» —
вертикальный срез «время + идентичность занятия», доведённый до провайдеров, хранилища и
TZ-pinned тестовой матрицы.

Два бага CAL-101 закрываются до него отдельными маленькими тикетами.

CAL-102 в переопределённом виде можно отдавать Codex: он ограничен, у него есть проверяемый
acceptance-артефакт (матрица под четырьмя TZ, идентичный результат), и у него есть явный
SHOULD NOT HAVE, который делает over-engineering видимым на ревью.

### Checks

```text
Изменения в исходниках: НЕТ
Создан файл: docs/calendar/CALENDAR_ARCHITECTURE_REVIEW_102.md
git status: CLEAN до ревью; после — только этот новый документ
Тесты (read-only прогон): npx vitest run src/services/calendar src/services/db/calendarEvents.test.ts
  src/components/calendar → 10 files, 128 tests, все зелёные
Доказательные прогоны выполнены на копиях чистых функций вне репозитория;
  один прогон rrule выполнен временным файлом внутри репозитория и удалён (git status подтверждён CLEAN)
Секреты: не читались, не выводились
Graphify: READ (query по calendar-подграфу; архитектура не менялась → UPDATE не требуется)
```
