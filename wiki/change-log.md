# Журнал изменений

## 2026-08-11 — единая авторизация Яндекс ID из четырёх grants

- Managed-подключение Яндекс Почты больше не отправляет пользователя через пустые шаги IMAP и SMTP: параметры серверов сохраняются автоматически, даже когда Яндекс не вернул поле `scope` в token response.
- Исправлена ложная ошибка «выполнен вход как другой аккаунт» для `Работа`, `Коммуникации` и `Администрирование`: grants проверяются по стандартному Yandex UID, а не по отсутствующему без `login:email` адресу.
- Подключение Яндекс-аккаунта последовательно получает `Основное`, `Работа` и `Коммуникации` в одной браузерной сессии; административные права остаются отдельным повышением доступа.
- Client ID четырёх приложений встроены как публичная конфигурация, а поля и запросы Client Secret удалены из пользовательского сценария.
- Для MVP Web OAuth-приложения получают временные встроенные секреты только в нативной Rust-части; `OFFICE360_YANDEX_*_CLIENT_SECRET` переопределяют fallback. Перед production все четыре секрета должны быть отозваны и перенесены в серверный broker.
- Диск и Трекер используют только token set `Работа`; Мессенджер и Телемост — только `Коммуникации`; Yandex 360 Admin API — только `Администрирование`.
- Дополнительные access/refresh tokens хранятся зашифрованно и привязаны к нормализованному e-mail, поэтому переключение аккаунтов не переиспользует чужую сессию.
- Settings > Яндекс 360 показывает состояние всех четырёх частей и позволяет продолжить обычное подключение либо отдельно выдать права администратора.

## 2026-08-11 — планирование Телемоста и единая OAuth-сессия

- Промежуточный экран Телемоста «Продолжить в браузере» скрывается; найденное действие отображается кнопкой «Продолжить →» на карточке соответствующей встречи в Office360.
- Телемост использует общий CEF-профиль `oauth`, в котором пользователь уже подтвердил Яндекс ID при подключении grants. Отдельный Passport-вход перед встречей удалён.
- Домашняя страница встроенного Телемоста остаётся невидимым техническим DOM-исполнителем; CEF показывается только для встречи или авторизации.
- CEF закреплён поверх WebView2 только в границах рабочей панели: домашняя страница не перекрывает Office360, а встреча не остаётся под чёрным HTML-контейнером.
- Во встроенной встрече скрываются только внешние навигационные панели Телемоста (боковая рейка, тарифная шапка и сервисный футер); элементы управления звонком сохраняются.
- Удалено принудительное возвращение на предыдущий URL встречи после навигации Телемоста: штатный выход и внутренние переходы больше не запускают цикл отключения и переподключения.
- CEF больше не запускает отдельный Passport account chooser для создания встречи; OAuth-операции и Телемост используют общий технический профиль.
- Команда скрытия Телемоста применяется ко всем сохранённым CEF HWND, а не только к текущему указателю профиля, поэтому отложенно созданное окно предыдущего аккаунта не может остаться поверх интерфейса.
- Профили аккаунтов размещаются непосредственными дочерними каталогами `root_cache_path`, как требует Chrome runtime; ошибка `Cannot create profile` больше не должна приводить к возврату в общий профиль.
- Каждый Chromium browser HWND помещён в отдельный дочерний контейнер Office360. Видимость и границы задаются контейнеру, поэтому Chromium не может самостоятельно восстановиться поверх боковой панели или другой вкладки.
- «Запланировать» подготавливает ссылку Телемоста и сразу открывает карточку нового события календаря с этой ссылкой, датой и полем участников.
- Участники из карточки передаются календарному провайдеру как приглашённые на событие.
- Пользовательские чаты Яндекс Мессенджера встроены официальным inline-виджетом и получают обновляемый OAuth-токен блока `Коммуникации` со scope `yamb:all`.
- Токен организационного бота используется только дополнительным экраном автоматизации Bot API и больше не блокирует обычный пользовательский Мессенджер.
- Проверка API OAuth для Трекера выполняется по актуальной конфигурации Client ID; стандартное приложение Office360 включает `tracker:read` и `tracker:write`, после повторной выдачи доступа токен обновляется для выбранного аккаунта.

## 2026-08-11 — папки переписок и рабочая область Телемоста

- IMAP-переписки получают папки по всем сохранённым сообщениям цепочки: входящие ответы остаются во «Входящих», а исходящие копии одновременно отображаются в «Отправленных».
- После каждой IMAP-синхронизации физические папки сверяются с локальными метками переписок, включая пользовательские папки.
- В Телемосте рабочая область Chromium больше не дублирует адресную панель Office360; домашняя страница открывается без внешней навигационной оболочки Яндекса.
- Панель встреч объединяет созданные встречи, ссылки из событий календаря и ранее открытые встречи; доступны поиск и фильтры по источнику.

## 2026-08-11 — надёжность IMAP-отправки и синхронизации

- Имена отправителей выровнены независимо от маркера непрочитанного.
- Локальная копия отправленного IMAP-письма сразу сохраняет метаданные MIME-вложений.
- Очистка доставленного письма из «Исходящих» повторяется при кратковременной блокировке SQLite.
- Курсор IMAP-папки откатывается на безопасное окно, если локальная папка пуста, восстанавливая пропущенные «Отправленные».
- В переключателе аккаунтов отображаются текущий этап и счётчик синхронизации.

## 2026-08-11 — надёжное удаление аккаунтов и восстановление IMAP-курсора

- Диалог удаления аккаунта закрывается сразу после завершения каскадного удаления; сохранение нового активного аккаунта больше не удерживает интерфейс в состоянии загрузки.
- Delta-синхронизация IMAP сверяет сохранённый UID с максимальным UID локальной папки и автоматически повторно запрашивает небольшой пропущенный хвост.
- UID папки продвигается только через фактически полученные сообщения и сохраняется после успешной записи писем в SQLite.

Эта страница фиксирует behavior и system changes, которые влияют на работу Office360. Это не замена Git history, а проектное объяснение важных решений.

## 2026-06-15 - EPIC-12 Yandex 360 work account foundation

Добавлено:

- OpenSpec change `epic-12-yandex360-work-account-foundation`.
- Settings > Яндекс 360 теперь показывает рабочий аккаунт Яндекс 360 для подключенных через Яндекс ID почтовых аккаунтов вместо raw Admin API console.
- Статус сервисов по аккаунту: Почта, Календарь, Мессенджер и Задачи.
- Persisted `oauth_granted_scopes` для вычисления missing scopes после Yandex OAuth onboarding/reauth.
- Yandex 360 diagnostics distinguish missing/expired scopes, provider 403/tariff limits and 429 throttling.

Важно:

- Административное управление сотрудниками, доменами, аудитом и общими ящиками не смешивается с обычным подключением почтового аккаунта и требует отдельного администраторского сценария.
- Raw admin OAuth token entry and raw endpoint execution are not part of the primary Yandex 360 UX.
- Support bundle and diagnostics must not include OAuth tokens, OAuth client secrets, auth headers or raw Yandex API responses.

## 2026-06-15 - Address Book contact photos

Добавлено:

- Contact preview and contact list use the shared `ContactAvatar` renderer instead of static initials/user icons.
- Inline contact editor supports staged contact photo changes: remote URL, local image upload, and remove.
- Uploaded contact photos are center-cropped to a square avatar, stored as managed local files under app data `contact-avatars/`, and referenced through `contacts.avatar_url`.

Важно:

- Photo changes are applied only on contact save and participate in the dirty-form confirmation flow.
- Cleanup deletes only app-managed local avatar files, never remote URLs.

## 2026-06-14 - EPIC-13 Full Address Book

Добавлено:

- OpenSpec change `epic-13-full-address-book`.
- Additive migration v31 для address book directories, rich contact methods, postal addresses, special dates, mailing lists и sync metadata.
- Dedicated route `/contacts` и sidebar item `Contacts`.
- Full Address Book UI: directories, contacts, mailing lists, rich contact editor, vCard import/export, CardDAV setup/test/sync, LDAP setup/test/search.
- Address Book creation actions now live in the left Address Book column: `New contact` is the primary action, address-book setup opens in a modal, and contact creation selects the target address book in the form.
- Contact create/edit and import now open in the right details pane instead of modal dialogs; dirty contact forms require confirmation before navigation.
- Address Book columns are resizable and persist widths in `contacts.columnWidths.v1`; import uses a Thunderbird-like wizard with functional vCard import and placeholder unsupported formats.
- Rich vCard parser/export для `N`, `NICKNAME`, repeated `EMAIL`/`TEL`/`URL`, `ADR`, `TZ`, `ORG`, `TITLE`, `ROLE`, `BDAY`, `ANNIVERSARY`, `IMPP`.
- Composer autocomplete теперь использует recipient suggestions и показывает mailing lists alongside contacts.
- Contact sidebar получил переход в Address Book.
- Settings > People no longer contains contact/address-book management; contacts are managed from the sidebar `Contacts` route.

Важно:

- `contacts` и `contact_identities` остаются compatibility layer для существующих mail flows.
- Existing inferred contacts backfill в `Collected Addresses`, managed/user contacts - в `Personal Address Book`.
- CardDAV sync использует `tsdav` и encrypted password reference; текущая стратегия - full-fetch/upsert с ETag metadata.
- LDAP в этом slice read-only: directory config, backend reachability test и bounded search без LDAP write.
- CardDAV/LDAP secrets не логируются и не должны попадать в support bundle.

## 2026-06-14 - EPIC-11 Support debug bundle first slice

Добавлено:

- OpenSpec change `epic-11-support-debug-bundle`.
- `SupportDebugBundle` schema v2 поверх existing `DebugBundle` schema v1.
- Support bundle export включает app/system metadata, sanitized account summary, persisted diagnostics, account sync health, redacted queue inspector summaries и optional security warning summaries.
- Desktop save flow через Tauri save dialog + local JSON write, с browser Blob fallback.
- Account Repair Center экспортирует support bundle даже без persisted diagnostics.
- Settings > About получил карточку `Support bundle`.
- Wiki contract для privacy-safe support bundle и redaction policy.

Важно:

- Thunderbird/provider import/export, backup/restore, automatic upload и DB migration не входят в этот slice.
- Queue export использует redacted `QueueInspectorItem`, не raw `pending_operations.params`.
- Bundle не должен включать tokens, passwords, OAuth client secrets, auth headers, raw MIME, raw bodies или full DB dumps.

## 2026-06-14 - EPIC-10 Enterprise and Exchange strategy

Добавлено:

- OpenSpec change `epic-10-enterprise-exchange-strategy`.
- ADR `DEC-007`: Graph-first для будущего Exchange Online/Microsoft 365 native adapter.
- Wiki page `microsoft-365-exchange-status.md`.
- Explicit unsupported `exchange` provider capabilities.
- `providerFactory` reject для `provider = "exchange"` вместо IMAP fallback.
- Account setup guardrails: Microsoft OAuth is IMAP/SMTP compatibility; Microsoft 365/Exchange native path is hidden from provider choices until an adapter exists.
- Help copy для Outlook/Microsoft OAuth обновлен без implied native Exchange support.

Важно:

- Graph/EWS runtime calls, DB migration, production Exchange adapter, shared mailboxes, Exchange calendar и Exchange contacts не входят в этот slice.
- Existing Outlook/Hotmail/Live setup remains IMAP/SMTP over Microsoft OAuth.

## 2026-06-14 - Desktop smoke process

Добавлено:

- Script `scripts/desktop-smoke.mjs`.
- NPM command `npm run smoke:desktop`.
- Wiki page `testing-process.md`.
- `artifacts/` ignored for generated smoke screenshots.

Важно:

- UI changes больше нельзя считать полностью проверенными без installed desktop smoke evidence или явного residual risk.
- Desktop smoke запускает installed `/Applications/Office360.app`, активирует `com.office360.desktop`, проверяет окно `office360` и пишет screenshot evidence в `artifacts/desktop-smoke/`.

## 2026-06-14 - EPIC-08 Calendar invitations

Добавлено:

- OpenSpec change `epic-08-calendar-invitations`.
- Additive migration v30 для `calendar_invitations`.
- Invite-aware iCalendar parser для `METHOD`, `SEQUENCE`, `RECURRENCE-ID`, `TZID`, cancellation, organizer и attendees.
- Detection из raw calendar body и `.ics` / `text/calendar` attachments.
- Thread invite card с event details, cancellation/update state, timezone warning и RSVP buttons.
- Local-first RSVP для Accept/Tentative/Decline с projection accepted/tentative invites в local calendar event store.
- Queue dispatch для `calendarRsvp`, отделенный от existing email queue actions.
- Wiki page `calendar-invitations.md`.

Важно:

- Remote provider RSVP delivery пока не реализован и явно блокируется как `unsupported_capability`; local RSVP decision остается сохраненным и visible.
- Full calendar replacement UI, Exchange calendar и scheduling assistant остаются вне первого slice.

## 2026-06-14 - EPIC-07 Contacts and address book

Добавлено:

- OpenSpec change `epic-07-contacts-address-book`.
- Additive migration v29 для contact aggregate metadata и `contact_identities`.
- Existing inferred contacts backfill в primary identity без потери `contacts.email`, frequency, notes и avatar fields.
- Managed contact APIs для display name, multiple email identities, identity lookup и inferred-update preservation.
- vCard import/export helpers для core fields: `UID`, `FN`, `EMAIL`, `NOTE`, `ORG`, `TITLE`.
- Composer autocomplete ищет и выбирает matched identity email, сохраняя frequency ranking.
- Settings > People > Contacts редактирует display name и comma-separated email identities.
- Contact sidebar показывает дополнительные identities и сохраняет notes/avatar/stats/same-domain/files/auth context.
- Wiki page `contacts-address-book.md`.

Важно:

- Live CardDAV/Google/Microsoft/Yandex contacts sync, mailing lists и отдельный address book route остаются future scope.
- `contacts.email` остается compatibility primary email для существующих callers.

## 2026-06-10 - EPIC-06 Search and smart folders

Добавлено:

- OpenSpec change `epic-06-search-smart-folders`.
- Search help синхронизирован с parser-supported operators: `from:`, `to:`, `subject:`, `has:attachment`, `is:read`, `is:unread`, `is:starred`, `before:`, `after:`, `label:`, `labelid:`, `folderpath:`.
- Operator-only searches for `labelid:` and `folderpath:` теперь выполняются через structured SQL query builder, а не через FTS fallback.
- Regression tests закрепляют db search routing, help/parser consistency и smart folder reference maintenance для `labelid:`/`folderpath:`.

Важно:

- Unsupported operator-like tokens, например `priority:high`, остаются plain text search, пока parser явно их не поддерживает.
- AI/Ask Inbox остается слоем поверх deterministic search; generated answer copy не смешивается с deterministic citations.

Verification:

- Targeted Vitest для db search, help content, smart folders, parser и query builder passed.
- Full `npm run test` passed.
- `npm run build` passed с существующими Vite chunk/dynamic-import warnings.
- `npm run tauri build` passed и собрал `src-tauri/target/release/bundle/macos/Office360.app`.

## 2026-06-10 - EPIC-09 SecurityWarning reader layer

Добавлено:

- Общий `SecurityWarning` contract для remote content, suspicious links, sender auth и unsafe attachments.
- Remote image warning переведен на общий warning UI; Spam больше не предлагает persistent sender allowlist и продолжает блокировать remote images.
- Expanded message reader запускает phishing scan и передает result в renderer для link confirmation.
- High-risk/suspicious links открываются только после confirmation с target URL и displayed link text.
- Sender auth failure banner использует общий warning layer.
- Executable/script/archive-risk attachments требуют explicit confirmation перед preview/download.
- Debug bundle поддерживает privacy-safe security warning summaries без raw HTML/body/MIME/secrets.
- Wiki page `security-privacy.md`.

Важно:

- OpenPGP/S/MIME, malware scanning и server-side anti-spam остаются вне P0 scope.
- Sender allowlist для remote images остается scoped by account and sender.

## 2026-06-03 - Full test suite и local app build stabilization

Изменено:

- Full Vitest suite стабилизируется как отдельный change от `main`, без расширения EPIC-05 scope.
- Default Tauri bundle target переведён на macOS `.app`, чтобы локальный `npm run tauri build` не падал на secondary DMG packaging.
- DMG packaging оставлен явной release-only командой `npm run tauri:build:dmg`.

Важно:

- `npm run build` уже собирает frontend без ошибок; Vite warnings по chunks/dynamic imports остаются известным техническим долгом.
- DMG issue остаётся отдельной packaging задачей: `.app` artifact создаётся успешно, failure происходит внутри generated `bundle_dmg.sh`.

## 2026-06-03 - EPIC-05 Compose/MIME reliability

Добавлено:

- OpenSpec change `epic-05-compose-mime-reliability`.
- MIME regression fixtures for outgoing `emailBuilder`: CRLF/header injection, Unicode subjects/display names, Bcc, IDN/plus addressing, non-ASCII filenames, empty/large attachments, inline CID images, multipart nesting, and reply headers.
- Header hardening for reply headers and attachment MIME parameters.
- ASCII-safe encoded MIME parameters for non-ASCII attachment filenames.
- Base64 wrapping helper for attachment and inline-image payloads.
- Draft autosave now includes Cc, Bcc, and attachments in saved raw MIME.
- Scheduled send stores attachment payload with the inserted scheduled row, avoiding latest-row lookup races.
- Scheduled send lifecycle tests cover `pending -> sending -> sent`, transient retry back to `pending`, and permanent failure to `failed`.
- Send lifecycle tests cover offline queued send, retryable SMTP/network queueing, permanent SMTP rejection, and IMAP Sent-copy fallback.

Важно:

- Bcc remains present in raw outgoing MIME for delivery, but local IMAP fallback sent copies continue to redact stored Bcc fields.
- IMAP Sent-copy success still avoids a local optimistic sent duplicate; Sent-copy failure creates exactly one local fallback copy.
- Full MIME parser rewrite, OpenPGP/S/MIME, and cloud attachments remain out of scope.

## 2026-06-03 - EPIC-04 Folder/Label completeness

Добавлено:

- OpenSpec change `epic-04-folder-label-completeness`.
- IMAP backend commands for folder `CREATE`, `DELETE`, `RENAME`, `SUBSCRIBE`, `UNSUBSCRIBE`, `LSUB`, `CAPABILITY`, and `GETQUOTAROOT`.
- Provider contract fields for raw IMAP path, subscription state, selectability, children, quota, and retention support reason.
- IMAP provider supports folder CRUD, subscription toggles, and best-effort quota discovery.
- Gmail provider keeps native labels and exposes folder subscription/quota as unsupported with clear reasons.
- Local labels persist IMAP folder metadata: raw path, special-use, subscribed, selectable, and has-children.
- Smart folders support stable `labelid:` and `folderpath:` operators.
- Smart folders are marked `missing_reference` after app-driven label/folder delete; sidebar shows warning state.
- IMAP move dialog and drag-and-drop use raw `imap_folder_path`, not synthetic local label IDs.

Важно:

- System/special-use IMAP folders are protected from rename/delete in provider service layer.
- Retention policy remains unsupported and explicit.
- Full folder management UI is not a separate new screen in this change; future UI surfaces should call the provider folder APIs and capability helpers documented in `provider-capabilities.md`.

Verification:

- Targeted Vitest suite for IMAP commands, provider capabilities, providers, smart/search folders, label store, and move dialog passed.
- `cargo build` passed in `src-tauri`.
- `npm run build` passed; Vite emitted existing chunk/dynamic-import warnings.

## 2026-06-03 - EPIC-03 Sync health и offline queue

Добавлено:

- Explicit queue lifecycle для `pending_operations`: `pending`, `executing`, `retry_scheduled`, `failed`, `blocked`, `cancelled`.
- Queue Inspector route `/queue` с account/status фильтрами, retry/cancel actions и safe operation preview.
- Redacted queue DTO: inspector не показывает raw MIME, `rawBase64Url`, body, tokens, passwords, OAuth secrets или auth headers.
- Outbox использует shared queue status для `sendMessage`, показывает retry scheduled/blocked/failed и поддерживает cancel.
- Account sync health aggregation: online state, queue counts, diagnostics, sync callbacks и last successful sync.
- Repair Center и Account Switcher показывают health/queue state without replacing existing diagnostic actions.
- Offline/global indicators показывают active queue count.
- IMAP UIDVALIDITY reset сохраняет warning diagnostic и запускает safe folder resync вместо silent data loss.
- Back navigation между Settings, Repair Center и Queue Inspector теперь возвращает на предыдущий уровень перед выходом из настроек.

Важно:

- Queue storage не переписан полностью; change эволюционирует текущую `pending_operations` table migration-safe.
- Cancelled операции не исполняются queue processor.
- Scheduled retries больше не скрываются как обычный `pending`: они видны как `retry_scheduled`.

## 2026-06-02 - EPIC-02 Account Diagnostics and Repair Center

Добавлено:

- `ConnectionDiagnostic` contract для OAuth, IMAP, SMTP, Gmail API, CalDAV, database/network/provider failures.
- SQLite persistence для latest account diagnostics в `account_diagnostics`.
- Отдельный Account Repair Center route: `/repair` и `/repair/$accountId`.
- Entry points из sync error toast и Settings > Accounts.
- OAuth refresh failures теперь сохраняют diagnostic с re-auth action.
- IMAP/SMTP test failures получают отдельные diagnostic states.
- CalDAV test/sync failures сохраняются как `caldav` diagnostics.
- Queue/outbox failures сохраняют diagnostic alongside existing retry state.
- Privacy-safe debug export JSON с redaction.
- Wiki page `account-diagnostics.md`.

Важно:

- Debug export не делает automatic upload.
- Tokens, passwords, OAuth secrets, raw mail, raw MIME и DB dumps не включаются в bundle.
- TLS/certificate failures классифицируются отдельно от password/auth failures.

## 2026-06-02 - Office360 Wiki и provider capability corrections

Добавлено:

- `wiki/` как project knowledge base.
- Office360-focused `README.md`.
- Provider capability documentation и smoke checklist.
- Workspace-level `README.md` в `mail/`, который указывает на Office360 app и wiki.

Исправлено:

- Gmail скрыт по умолчанию в account picker.
- Только explicit `gmail_api` accounts получают Gmail capabilities.
- Yandex/IMAP/POP3-like/unknown provider values используют IMAP-compatible capabilities.
- Yandex/IMAP sidebar больше не показывает `Labels`, даже если local DB содержит old label rows.
- Yandex/IMAP context menu больше не renders disabled `Apply Label`; item скрыт полностью.
- Settings hide `Google API`, `Labels` и `Smart Labels` для non-Gmail mail accounts.
- Filters и quick steps hide label actions для non-native-label providers.

Verification:

- targeted Vitest provider/action/menu checks passed.
- frontend build passed.
- Tauri release `.app` built successfully; `.dmg` packaging failed at `bundle_dmg.sh`, known local packaging issue after `.app` creation.

## 2026-06-01 - EPIC-01 Provider Capabilities

Implemented provider capability plumbing:

- добавлены `ProviderCapabilities` и `CapabilitySupport` в email provider contract;
- capabilities exposed from Gmail и IMAP providers;
- добавлены capability helpers;
- email actions gated before optimistic updates, local DB updates, provider calls и offline queue writes;
- label CRUD gated before Gmail API access;
- command palette, keyboard shortcuts, context menu, move dialog, drag-and-drop, settings и sidebar surfaces gated.

Initial product correction:

- Gmail не является target default provider для Office360.
- IMAP/SMTP и Yandex являются target mail paths.

## 2026-06-02 - Закрытая лицензия Office360

Изменено:

- `LICENSE` заменён с Apache-2.0 на Office360 Proprietary License.
- `package.json` и root entry в `package-lock.json` переведены на `UNLICENSED`.
- `src-tauri/Cargo.toml` и AppStream metadata переведены на `LicenseRef-Proprietary`.
- RPM spec переведён на `Proprietary`.
- Settings About panel показывает `Office360 Proprietary License`.
- README и CONTRIBUTING обновлены под закрытую лицензию.
- Landing copy и metadata больше не позиционируют продукт как open-source/free.

Важно:

- License entries сторонних зависимостей в `package-lock.json` и `landing/package-lock.json` не менялись, потому что они описывают лицензии dependency packages, а не Office360.
## 2026-08-11 - Сохранение авторизации Яндекс Диска

- API OAuth Диска и Трекера теперь привязан к нормализованному адресу Яндекс-почты, а не к временному ID локального аккаунта.
- После удаления и повторного подключения того же аккаунта прежняя зашифрованная авторизация переносится автоматически.

## 2026-08-11 - Изоляция окна Яндекс OAuth

- Стандартная авторизация Яндекс с локальным callback открывается в отдельном дочернем окне `yandex-oauth` и закрывается после получения кода.
- CEF Телемоста используется только для служебного потока с экранным кодом; callback больше не может заменить содержимое главного окна Office360.
# 2026-08-11 — синхронизация повторяющихся событий и масштаб Телемоста

- CalDAV-синхронизация разворачивает повторяющиеся события `RRULE` в выбранном диапазоне, учитывает `EXDATE` и отдельные экземпляры серии.
- После успешного ответа провайдера локальный диапазон календаря заменяется актуальным набором, поэтому отменённые и удалённые события не остаются в интерфейсе.
- В комнате Телемоста автоматически применяется адаптивный масштаб по высоте рабочей области Office360, чтобы нижняя панель управления оставалась видимой.
# 2026-08-11 — изоляция Яндекс-сервисов и подключение почты

- Диск и Телемост используют только текущий активный аккаунт, подключённый через Яндекс ID; автоматическая подстановка другого сохранённого Яндекс-аккаунта удалена.
- При смене или удалении аккаунта данные Диска, список встреч и нативное окно CEF очищаются до проверки нового аккаунта.
- Локальная история встреч Телемоста хранится отдельно для каждого Яндекс-аккаунта.
- Устранено взаимное ожидание очереди SQLite при первичной IMAP-синхронизации, из-за которого подключение Яндекс Почты и удаление аккаунта могли зависать.
- Закрытие окна OAuth теперь завершает попытку подключения с диагностикой вместо бесконечного состояния «Подключение».
## 2026-08-11 - Переключение аккаунта Яндекс в Диске и Телемосте

- Токен API Диска проверяется по владельцу и больше не переносится на другой локальный аккаунт по эвристике единственного сохранённого токена.
- При несовпадении владельца токен удаляется, а интерфейс предлагает выдать доступ выбранному аккаунту.
- При смене активного аккаунта Chromium Телемоста очищает cookies и HTTP-авторизацию, затем открывает Яндекс ID с подсказкой email нового аккаунта.
- Создание и планирование встреч выполняются через Telemost API нативным HTTP-клиентом; ошибки тарифа или прав показываются напрямую без перехода на повторную авторизацию.
# 2026-08-11 — Yandex Tracker and Messenger transport

- Tracker and Yandex 360 organization requests now use Tauri native HTTP, avoiding WebView CORS failures shown as `Failed to fetch`.
- User Yandex Messenger works through the official inline widget with the Communications OAuth token. A saved organization bot token is used only by the optional Bot API automation panel.
