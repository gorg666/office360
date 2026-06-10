# Журнал изменений

Эта страница фиксирует behavior и system changes, которые влияют на работу Office360. Это не замена Git history, а проектное объяснение важных решений.

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
