# CAL-AUDIT-001 — Office360 Calendar baseline audit

Дата: 2026-08-21
HEAD: `10c7a54fb8eb6c36c8e70bc0628b100405189bae` (`GORGDEV2-EFIM-INTEGRATION`)
Статус аудита: **PARTIAL** — static/code/build/test baseline подтверждён; живой Calendar/CalDAV/Tauri workflow не проверен.

## Executive summary

Office360 уже содержит рабочий фундамент Calendar, а не только placeholder: route и реальные Day/Week/Month views, несколько календарей, локальный SQLite cache, Google Calendar и CalDAV providers, event CRUD, базовые attendees/organizer/RSVP, recurrence expansion и Mail invitation cards. Код находится в production path и включён в текущий build.

При этом это не функциональный паритет с Яндекс 360 Календарём. Нет drag/resize, Free/Busy, scheduling assistant, working hours, shared-calendar permissions, privacy model, reminders, timezone-safe domain model, recurrence editor/exceptions workflow и полноценного iTIP delivery. Day/Week являются простыми hourly buckets, а не календарным layout engine. Исторический `A2 FAIL` был реальным runtime failure Yandex CalDAV/OAuth capability, а CAL1–CAL8 после него остались `NOT TESTED`.

Начинать большой UI implementation прямо сейчас не рекомендуется. Сначала нужны чистый/утверждённый Git baseline и foundation ticket, который стабилизирует calendar domain contracts, timezone/privacy semantics и provider capabilities. Существующий код следует расширять выборочно, а не переписывать целиком.

## Scope и доказательность

Аудит использовал:

- локальный Graphify index (`CalendarPage`, providers, SQLite, Mail MIME, contacts, notifications);
- текущие исходники и tests;
- Git history/branches/status;
- существующие QA/wiki docs;
- `npm run build`, полный `npm run test`, `cargo check`.

Не выполнялись:

- вход в реальные аккаунты, сетевые CalDAV/Google/Yandex операции;
- изменение DB или migrations;
- Tauri runtime/desktop smoke;
- отправка реальных писем/ICS/RSVP;
- `npm run tauri build`, installer build, deploy;
- проверка Яндекс 360 web UX (это отдельная задача).

## Project instructions и skills

Прочитаны и учтены:

- workspace `AGENTS.md`, `.ai/APOSTLE.md`, `.ai/PROJECT_CONTEXT.md`, `.ai/CURRENT_STATE.md`, `.ai/SECRETS_POLICY.md`, `.ai/DEPLOY_RUNBOOK.md`;
- repo `AGENTS.md`, `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`;
- `.agents/skills/office360-project/SKILL.md` и `.agents/skills/office360-testing/SKILL.md`;
- `.cursor/rules/*` safety/APOSTLE/HEADROOM/Graphify rules и соответствующие Cursor skills;
- `.claude/skills/react-best-practices/SKILL.md`, `composition-patterns/SKILL.md`, `web-design-guidelines/SKILL.md`;
- Office360 mail plugin entry skills: epic lead, mail developer, mail tester, handoff;
- `docs/architecture.md`, `docs/development.md`, Calendar wiki/QA документы.

Влияние на будущий Calendar:

- Graphify-first перед работой с существующими symbols; source остаётся truth.
- React 19 + strict TypeScript, Zustand только для ephemeral state, side effects в services, SQLite как durable source.
- Tailwind semantic tokens, Lucide icons, существующие primitives; UI changes требуют runtime/Tauri verification, не только build.
- migrations только append-only; существующие migrations не редактировать.
- provider behavior capability-driven; Yandex/IMAP/CalDAV и Gmail нельзя смешивать неявно.
- privacy, account isolation, sanitization и encrypted credentials обязательны.
- Conventional Commits и wiki updates — для последующей реализации, но не для этого audit.

Frontend performance/composition skills являются guidance для будущего сложного Calendar UI; отдельные rule-файлы следует читать по мере затрагивания соответствующих patterns. Web-design guidelines требуют актуальной внешней версии при отдельном UI review и в этом read-only audit не применялись как формальный внешний checklist.

## Карта архитектуры

```text
velo-office360-api-ya-clean/
├─ src/
│  ├─ App.tsx                         startup/background services
│  ├─ router/                         TanStack route tree + navigation helpers
│  ├─ components/
│  │  ├─ layout/                      Office360 shell/sidebar/service navigation
│  │  ├─ calendar/                    Calendar page/views/toolbar/event UI
│  │  ├─ email/                       Thread view, invite card, MIME-backed attachments
│  │  ├─ composer/                    message composer + recipient autocomplete
│  │  └─ ui/                          Button/Modal/TextField/ContextMenu/dialog primitives
│  ├─ services/
│  │  ├─ calendar/                    provider contract, CalDAV/Google, iCalendar, invites
│  │  ├─ email/                       Gmail/IMAP provider abstraction
│  │  ├─ gmail/ + imap/               sync, MIME/message/attachment access
│  │  ├─ db/                          SQLite migrations/repositories
│  │  ├─ contacts/                    CardDAV/LDAP/avatar support
│  │  ├─ notifications/               OS notifications
│  │  └─ queue/, followup/, snooze/    background checker patterns
│  ├─ stores/                          Zustand UI/account/thread/composer/etc.
│  ├─ utils/                           email builder, crypto, dates, sanitization
│  └─ styles/globals.css               semantic light/dark/theme tokens
├─ src-tauri/
│  ├─ src/                             Rust shell, IMAP, SMTP, OAuth, notifications
│  ├─ capabilities/                    Tauri permissions
│  └─ tauri.conf.json                  SQLite/plugin/window config
├─ docs/ + wiki/                        technical and living product knowledge
└─ package.json                         npm + Vite/Vitest/Tauri commands
```

### Stack

| Area | Реализация |
|---|---|
| Desktop shell | Tauri v2, Rust edition 2021 |
| Frontend | React 19.2, TypeScript 5.9, Vite 7 |
| Router | `@tanstack/react-router` |
| State | Zustand 5, ephemeral UI state |
| UI | Tailwind CSS v4 semantic tokens, Lucide |
| Persistence | SQLite through `@tauri-apps/plugin-sql`; append-only TS migrations |
| Mail | Gmail API или IMAP/SMTP provider; Rust IMAP/SMTP commands |
| Calendar | Google Calendar API + CalDAV (`tsdav`) in TypeScript |
| Recurrence | `rrule` 2.8.1 |
| DnD | `@dnd-kit/core` exists for Mail/sidebar, not Calendar |
| Tests | Vitest 4 + Testing Library/jsdom; Rust `cargo check` |

Calendar provider/network logic is TypeScript-side. Отдельного Rust Calendar module/command set нет; Rust нужен косвенно для shell, SQLite, OAuth/mail/notifications.

## Текущее состояние Calendar / A2

### Реально используется

- `CalendarPage` зарегистрирован в route tree и попадает в production bundle (`CalendarPage-*.js`).
- `CalendarToolbar` переключает `day | week | month`, навигацию и создание события.
- `CalendarList` управляет видимостью нескольких remote calendars.
- `CalendarPage` сначала читает SQLite cache, затем вызывает provider, upsert calendars/events и перечитывает cache.
- Create/Edit/Delete вызывают remote provider и отражаются в SQLite.
- Event details показывают organizer, attendees/response status, Telemost URL и direct provider RSVP.
- Google Calendar API и CalDAV providers реализуют list/fetch/create/update/delete; CalDAV использует ETag.
- Recurring CalDAV VEVENT расширяется в occurrences через `rrule`, `EXDATE` и `RECURRENCE-ID` overrides.
- Calendar/Telemost deep-link context использует `sessionStorage` для открытия/черновика.

### Ограничения UI

- Month: собственная grid, максимум 3 видимых events/day + count.
- Week/Day: 24 фиксированных hourly rows; событие рендерится в каждом пересечённом hour bucket, нет вычисления top/height/column overlap.
- Нет click/drag-on-empty-slot creation.
- Нет drag event, resize, keyboard move/resize, collision/accessibility announcements.
- Нет virtualization; текущие 24×7 cells невелики, но attendee/free-busy масштаб потребует отдельной стратегии.
- Create modal: title, start/end, location, comma-separated participant emails, description, calendar. Нет all-day control, recurrence, optional attendee, reminders, privacy, timezone.
- Edit: title/time/location/description; для recurring series время блокируется, чтобы не сдвинуть series. Нет “это событие / все / следующие”.
- Delete не различает instance/series.
- Calendar events окрашены главным образом accent color; provider calendar color не проведён последовательно через event layout.

### Почему A2 был FAIL

QA 2026-08-11 зафиксировал: PROFILE PASS, IMAP PASS, CALENDAR FAIL. На живом Yandex account были `calendars=0`, `calendar_events=0`, null CalDAV principal/home URL, `calendar_enabled=false`; PROPFIND с сохранённым token дал 401, token refresh — `invalid_client`. Это failure provider auth/capability/runtime, а не отсутствие route/UI.

После этого CAL1–CAL8 (load calendars/events, views, CRUD, timezone, recurrence) остались `NOT TESTED`. Следовательно, текущий код production-path, но runtime readiness Yandex Calendar не доказана.

## Calendar providers и sync

### Сильные стороны

- Общий `CalendarProvider` contract и factory по account/provider.
- Google и CalDAV implementations.
- Yandex OAuth account переиспользует mail token и отдельный Yandex CalDAV login helper.
- ETag передаётся на CalDAV update/delete.
- Google sync token и Calendar DB `sync_token/ctag` предусмотрены.
- Multiple calendars и local visibility реализованы.

### Проблемы

- `CalendarPage` выполняет provider sync непосредственно внутри component lifecycle; отдельного calendar sync manager/store нет.
- При каждом view/range load visible range локально удаляется, затем заново заполняется. Ошибка между delete и upsert может создать временно неполный cache; нет transaction/staging generation.
- CalDAV `syncEvents` фактически full fetch (−90 дней / +1 год), не delta; deletedRemoteIds не заполняется.
- UI path использует `fetchEvents`, а не persistent background sync. Нет offline mutation queue для event CRUD.
- Google list/fetch имеет `maxResults=250` и не обрабатывает pagination в обычном fetch path.
- Нет provider capability matrix для FreeBusy, ACL, attachments, reminders, recurrence scope, scheduling resources.
- Ошибки load местами проглатываются; пользователь получает полноценный error UI в основном для Google 403.

## Mail → Calendar audit

### 1. Может ли Mail получить ICS?

**PARTIAL / YES.** Gmail/IMAP providers умеют получать attachments; `.ics` или MIME `text/calendar` attachment с provider attachment ID считывается и разбирается. Также raw `VCALENDAR/VEVENT` в сохранённом body text/html обнаруживается при открытии thread.

Ограничение: invitation detection выполняется в `ThreadView`, то есть on-open, а не гарантированно при sync. Gmail body parser извлекает только `text/plain` и `text/html`; `text/calendar` part без filename/CID может не попасть ни в body, ни в attachment list. Это не полноценный recursive MIME calendar extractor.

### 2. Выделяется ли `text/calendar` из MIME?

**PARTIAL.** Attachment metadata сохраняет MIME type, а invitation service признаёт `text/calendar` и `.ics`. Но parser contract не возвращает first-class calendar MIME parts с `method`, charset, content-disposition и nesting context. Multipart/alternative/related/mixed semantics для calendar invitation не моделируются.

### 3. Может ли пользователь открыть приглашение?

**YES, ограниченно.** `CalendarInviteCard` отображается в Mail thread, показывает summary/time/organizer/location/update/cancel/timezone warning и кнопки RSVP. Отдельного безопасного raw ICS viewer/editor/import decision flow нет.

### 4. Может ли Mail отправлять ICS?

- Generic `.ics` attachment: **технически YES** — composer/email builder поддерживает arbitrary filename/MIME/base64 attachment и Gmail/SMTP передают raw RFC 2822.
- Специализированный `text/calendar; method=REQUEST|REPLY|CANCEL` MIME part: **NO**.
- Автоматическая генерация organizer invites/updates/cancellations: **NO**.
- Mail invitation RSVP delivery: **NO** — `calendarRsvp` сохраняется local-first, затем queue executor намеренно переводит action в blocked/unsupported.

### 5. Что добавить

- recursive provider-neutral MIME calendar extraction;
- нормализованный `CalendarMimePart` с method/charset/filename/raw bytes;
- iTIP/iMIP generator и отправка `REQUEST`, `REPLY`, `CANCEL` через `EmailProvider`;
- единая UID/SEQUENCE/RECURRENCE-ID idempotency policy;
- organizer update/cancel workflow и reconciliation с Sent/Outbox;
- provider capability delivery: direct Calendar API/CalDAV scheduling при поддержке, iMIP fallback;
- входящий import/update/cancel pipeline во время sync, не только при открытии thread.

### 6. Архитектурные препятствия

- direct provider RSVP из EventDetail работает отдельно от Mail invite queue, которая blocked;
- invitation projection создаёт local event с `calendar_id=null`, без связи с remote calendar;
- текущий handwritten iCalendar parser сохраняет raw data, но не покрывает весь RFC 5545/5546;
- composer строит generic attachments, но не calendar method parts;
- отсутствует calendar operation queue/sync conflict model.

## Данные и хранилище

### Уже есть

| Entity | Хранилище / состояние |
|---|---|
| Account | SQLite `accounts`; provider/OAuth/CalDAV fields |
| Contact | `contacts`, rich contact identities/directories; email-centric |
| Calendar | `calendars`: account/provider/remote/color/visibility/tokens |
| Event | `calendar_events`: basic fields + attendees JSON + raw iCal/UID/ETag |
| Invitation | `calendar_invitations`: UID/sequence/recurrence/method/RSVP/raw iCal |
| Attachment | `attachments` для Mail, не Calendar event attachments |
| Notification | settings/VIP/mail paths; Calendar reminder entity отсутствует |
| Reminder | только follow-up/task/snooze patterns, не event reminders |

### Рекомендованное расширение

Сохранить `calendars`, `calendar_events`, `calendar_invitations`, но добавить через новые migrations:

- `calendar_attendees` — event/occurrence, email, normalized identity, role, optional/required, PARTSTAT, RSVP, delegated fields;
- `calendar_recurrence_rules` и `calendar_recurrence_exceptions` — master/override/tombstone, range semantics;
- `calendar_event_reminders` — action, offset/absolute trigger, acknowledgement;
- `calendar_permissions` и `calendar_subscriptions` — provider ACL/subscription state;
- `calendar_free_busy_cache` — only opaque busy intervals, scoped/expiring;
- `calendar_working_hours` — account/person timezone-aware weekly rules;
- `calendar_resources` / attendee relation для rooms/resources;
- `calendar_sync_state` / `calendar_pending_operations` для provider delta/conflicts/offline mutations.

Не следует дублировать series occurrences как единственную source of truth. Нужны master + exceptions, а materialized occurrences могут быть cache. Raw iCalendar полезно сохранять для round-trip, но бизнес-логика не должна зависеть только от regex/JSON blobs.

## Contacts / users / attendees

Текущий composer autocomplete использует `searchContacts`/recent contacts. Есть rich contacts, multiple identities, CardDAV directories, LDAP directory service, organization/title/timezone fields. Это хорошая база для participant picker.

Проблемы:

- базовая историческая `contacts.email` имеет global UNIQUE semantics, а Calendar/FreeBusy требует account/domain-aware identity;
- внутренний corporate user ID не является общим контрактом; большинство flows связывает человека по normalized email;
- CardDAV contact не равен directory user и не гарантирует FreeBusy address/ACL;
- LDAP/CardDAV/provider directory results надо объединять с явным `identity_source`, account/domain и stable provider ID.

Рекомендация: attendee key в протоколе остаётся canonical email, но внутренне используется composite identity (`account_id`, `directory/provider`, `external_user_id`, normalized email). Corporate FreeBusy должен вызываться через organization directory/provider API, а не угадываться по локальному contact.

## Notifications и background execution

Есть пригодные patterns:

- Tauri/plugin + native Windows OS notifications;
- permissions/action types и foreground suppression;
- `createBackgroundChecker` с start/stop/overlap control;
- periodic follow-up, snooze, scheduled send, queue, bundle, cache checkers;
- startup initialization в `App.tsx`.

Calendar reminders отсутствуют: нет reminder table/service/checker, snooze/acknowledge/calendar deep-link action, recurring-instance scheduling и catch-up after sleep. Существующая архитектура может быть расширена, но minute polling в UI process не гарантирует точные/надёжные reminders при закрытом приложении. Для первого slice допустим app-running checker; production parity потребует OS/native scheduling или документированные delivery guarantees.

## Time / date / timezone

### Сейчас

- DB хранит event times как Unix seconds.
- UI широко использует native `Date`/`Intl.DateTimeFormat` и system local timezone.
- Google event create/update берёт `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- `rrule` используется для expansion.
- Calendar invitation хранит `timezone_id` только как metadata/warning.

### Критические риски

- `parseICalDateTime` не применяет `TZID`; non-Z values интерпретируются в system local timezone. Валидный чужой TZID может не вызвать warning, но дать неверный instant.
- Event model не хранит original event timezone, floating-time semantics, all-day exclusive end и DST disambiguation.
- Recurrence expansion начинается от уже вычисленного epoch и raw RRULE; DST wall-clock recurrence может сдвигаться.
- Google all-day end mapping использует end date + `T23:59:59`, хотя provider end date обычно exclusive.
- UI week start hardcoded Sunday; working week/locale preferences отсутствуют.
- Нет user/account timezone setting и zone conversion UI.

Foundation должен хранить: UTC instant для timed occurrences, canonical IANA TZID, local wall time/zone для recurrence masters, explicit floating flag, exclusive date range для all-day. Требуются DST tests (spring gap, fall overlap, cross-zone invite, series across DST).

## UI / design system

Office360 имеет semantic light/dark/system themes, color themes, typography scaling и Tailwind tokens (`bg-bg-*`, `text-text-*`, borders/accent/success/danger/warning). Shell/sidebar/routes уже готовы.

Можно переиспользовать:

| Calendar need | Existing base |
|---|---|
| Toolbar/buttons | `Button`, CalendarToolbar patterns, Lucide |
| Event editor | `Modal`, `TextField`, DateTimePicker patterns |
| Event popover | current EventDetail portal, но оформить как reusable anchored popover |
| Participant picker | `AddressInput` + contact/directory services |
| Context menu | `ContextMenu`/portal/store |
| Confirmation | `ConfirmDialog` |
| Calendar selector | CalendarList + standard select/dropdown styling |
| Empty/loading/errors | EmptyState, Skeleton, ErrorBoundary, banners |

Пробелы: нет общего production-grade Popover/Menu/Combobox abstraction, participant chips слишком просты, current event detail имеет custom positioning, calendar grid/layout tokens отсутствуют. Free/Busy scheduler должен быть отдельным compound component, а не расширением current modal десятками boolean props.

## Drag & drop / resize / virtualization

- `@dnd-kit/core` установлен и используется для Mail thread → sidebar label interactions.
- Calendar components не используют DnD hooks.
- `fullcalendar`, `react-big-calendar`, `react-dnd`, `react-beautiful-dnd`, SortableJS, Interact.js, react-window и TanStack Virtual не установлены/не используются.

Рекомендация: не выбирать Calendar library до spike с требованиями recurring scope, overlapping layout, keyboard/a11y, multi-timezone и pixel-level Office360/Yandex UX. Existing `@dnd-kit/core` пригоден для pointer/keyboard drag orchestration, но resize/time-grid collision/layout всё равно потребуют calendar-specific engine. FullCalendar имеет мощный feature set, но потенциально затруднит точный UX и может потребовать premium/resource licensing review. На текущем этапе зависимости не добавлять.

## Build/test baseline

| Проверка | Результат | Примечание |
|---|---|---|
| `npm run build` | PASS | `tsc && vite build`; Vite warnings о large main chunk и mixed dynamic/static imports |
| TypeScript | PASS | включён в `npm run build` |
| `npm run test` | PASS | 194 files, 1962 tests; 86.58s |
| Calendar tests | PASS в составе suite | providers, iCal, invitations, DB, CalendarList/Toolbar; нет полноценных Page/Day/Week/Month/Create/Edit integration tests |
| `cargo check` | PASS | 2 warnings: unused `app`, `event` в `src/lib.rs:360` |
| Lint | NOT AVAILABLE | `lint` script отсутствует |
| `cargo test` | NOT RUN | Calendar logic TypeScript-side; минимальный runbook требует `cargo check` |
| `npm run tauri build` | NOT RUN | installer/production bundle не нужен для read-only audit |
| Web smoke | NOT RUN | Vite-only не доказывает Tauri/SQLite/providers |
| Desktop/Tauri smoke | NOT RUN | нужны runtime account/provider и отдельная безопасная сессия |

Vitest stderr содержит существующие React `act(...)` warnings и ожидаемые error-path logs; они не привели к test failures и не классифицированы как Calendar defects в этом audit.

## Security / privacy

### Существующие patterns

- account-scoped mail/calendar queries в основном используют `account_id`;
- CalDAV passwords и OAuth secrets encrypt/decrypt через existing crypto utilities;
- HTML sanitization, sandboxed rendering, remote image blocking;
- diagnostic redaction и provider capability guards;
- Tauri permissions/plugin boundaries.

### Calendar risks

- `calendar_events` содержит organizer/attendees/description/raw iCal локально; нет field-level privacy или retention policy.
- `CalendarEventData` не моделирует `CLASS`, visibility, ACL, guestsCanSeeGuests, transparency.
- shared calendars/permissions отсутствуют.
- contacts identity может пересекать accounts через email-centric uniqueness.
- raw iCalendar может содержать sensitive description/attendees и не должен попадать в logs/debug bundles.
- FreeBusy нельзя вычислять выдачей чужих event details. Provider/service должен возвращать opaque `[start,end,busyType]`, а UI без permission показывает только «Занят».

Для FreeBusy authorization должен исполняться на server/provider boundary. Local client не может сам доказать право видеть детали чужого календаря. Cache должен быть account/org scoped, короткоживущим и не содержать summary/location.

## KEEP / EXTEND / REPLACE

### KEEP

- Office360 shell, routing и service navigation.
- semantic theme/tokens, Button/Modal/TextField/ContextMenu/Confirm primitives.
- Calendar provider abstraction/factory как архитектурный seam.
- SQLite connection/migration/repository patterns.
- Calendar account setup, encrypted CalDAV credential path.
- Mail `EmailProvider`, generic attachment pipeline, contacts/directory foundation.
- notification/background-checker patterns.
- raw iCalendar preservation и существующие regression tests как fixtures.

### EXTEND

- `calendars`, `calendar_events`, `calendar_invitations` через additive normalized tables/columns.
- Google/CalDAV providers с capability matrix, pagination, delta/conflicts, FreeBusy/ACL/reminders.
- CalendarPage — вынести sync/state из component, сохранить route/shell.
- EventCreate/EventDetail — добавить reusable editor model, attendees roles, recurrence/reminders/privacy/timezone.
- Mail parser/builder — first-class calendar MIME parts и iTIP delivery.
- contacts autocomplete — directory-backed corporate identity.
- notification manager/background checker — event reminder actions/deep links.
- recurrence tests — DST, overrides, cancellations, range scope.

### REPLACE

- Day/Week hourly bucket rendering — заменить calendar layout engine: continuous positioning, overlap columns, all-day lanes, drag/resize, keyboard/a11y. Текущий простой grid полезен как визуальный prototype, но не масштабируется до parity.
- handwritten iCalendar parsing as authoritative parser — заменить/обернуть standards-oriented parser/serializer; текущие helpers сохранить как compatibility tests. Причина: TZID, escaping/params, VTIMEZONE, recurrence scope и iTIP слишком сложны для regex parser.
- comma-separated attendee input — заменить participant picker с identities/roles/status/free-busy.
- blocked `calendarRsvp` executor — заменить реальной capability-driven delivery; local-first queue contract можно сохранить.

Не требуется переписывать working Mail, shell, contacts или provider factory ради архитектурной чистоты.

## Главные риски / blockers

1. Yandex Calendar runtime auth/capability исторически FAIL и не перетестирован.
2. Git baseline dirty, `origin/HEAD` некорректен для автоматического branching, текущая integration branch имеет отдельный open checkpoint.
3. Timezone/DST/recurrence model недостаточен и опасен для данных.
4. Mail RSVP delivery и organizer iTIP отсутствуют.
5. Privacy/ACL/FreeBusy contracts отсутствуют; их нельзя безопасно «добавить позже» поверх detail-first API.
6. Current time-grid UI требует replacement, а не постепенного добавления drag/resize.

## Рекомендация

`CAL-AUDIT-001` завершён как **PARTIAL**: code/build/tests audited, runtime not proven. После очистки/утверждения Git baseline создать `feat/calendar-yandex360` от `10c7a54` или явно принятого successor. Первый implementation cycle должен быть foundation/domain/provider-capability ticket, а не Calendar UI redesign.

До начала implementation нужно отдельно решить:

- считать ли текущий EFIM integration HEAD продуктовой базой;
- какой Yandex Calendar transport/capability является целевым (CalDAV OAuth и/или иной corporate API);
- privacy/FreeBusy authority и identity source;
- timezone/recurrence storage contract.

## Graphify

- queried: YES
- affected subgraph: CalendarPage/views → CalendarProvider/Google/CalDAV → SQLite; ThreadView/MIME attachments → invitations/queue; contacts/notifications/account
- updated: NO — изменена только audit documentation, architecture/source graph не менялся
- stale findings: Graphify подтвердил symbols/paths; архитектурные факты перепроверены по current source

## CAL-101 update — Git/runtime gate

Дата: 2026-08-21. Полный результат находится в `CALENDAR_RUNTIME_BASELINE.md` и обновлённом `CALENDAR_GIT_BASELINE.md`.

- Tauri startup и Calendar route: PASS.
- Month / Day / Week: PASS.
- Local cache/calendar list/render: PASS.
- Yandex CalDAV endpoint reachability: PASS.
- OAuth refresh, DAV login/discovery/home-set/remote collection+event freshness: PARTIAL/NOT TESTED на response level.
- Remote CRUD: NOT TESTED; реальный cloud account не изменялся.
- Mail invitation static/unit path: PASS; live invite card NOT TESTED; remote Mail RSVP delivery остаётся FAIL/unsupported.
- Historical A2/CAL-001: не воспроизведён как явный 401/invalid_client, но остаётся PARTIAL и не закрыт.
- Bugs: `CAL-BUG-101` hidden CalDAV errors, `CAL-BUG-102` unredacted account identifier in runtime diagnostics, `CAL-BUG-103` repeated Yandex CalDAV login/session creation.
- Git baseline: NOT CLEAN; feature branch не создана.
- CAL-102: **NO**.

Повторные проверки: TypeScript PASS, build PASS, 194/1962 Vitest PASS, cargo check PASS, Tauri Calendar UI smoke PASS. Calendar feature code, migrations, secrets, deploy и production configs не менялись.

## CAL-101A closure — response-level baseline

- Git noise локализован: `Cargo.toml` имел identical blobs и stale OneDrive/index stat metadata; точечное безопасное index refresh убрало false `M` без content diff.
- Generated QA artifacts сохранены вне repo, secret-like local backup остаётся untracked/ignored и не открывался.
- Yandex account/provider/credential resolution: PASS; OAuth DAV login: PASS.
- Refresh: **NOT APPLICABLE** — expiry metadata valid, реальный credential намеренно не инвалидировался.
- DAV evidence: initial resource probe `PROPFIND 404 text/html`, затем `current-user-principal`, `calendar-home-set`, collection/supported-report `PROPFIND 207 text/xml`; event `REPORT 207 text/xml`.
- Calendar list, ICS parse, mapping и Month/Day/Week render: PASS через fresh remote query.
- Historical A2/CAL-001 закрыт для текущего baseline: terminal auth/DAV failure не воспроизведён; прежний PARTIAL был observability gap.
- `CAL-BUG-101`: confirmed, UX fix deferred; `CAL-BUG-102`: closed минимальным redaction helper/test; `CAL-BUG-103`: confirmed, оптимизация deferred.
- Calendar feature code, remote cloud data, migrations, secrets, deploy и production configs не менялись.
- Graphify updated: NO — source change ограничен log redaction и не меняет архитектурный subgraph.

После зелёных финальных проверок допустим successor baseline commit и создание `feat/calendar-yandex360`; CAL-102 можно начинать с отдельного ticket, не смешивая baseline cleanup с feature scope.
