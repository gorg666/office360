# Журнал изменений

Эта страница фиксирует behavior и system changes, которые влияют на работу Office360. Это не замена Git history, а проектное объяснение важных решений.

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
