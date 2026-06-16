# Обзор системы

Office360 - Tauri v2 desktop application с React/TypeScript frontend и Rust backend.

## Границы продукта

Office360 - local-first workspace вокруг почты:

- чтение почты, search, folders, smart folders, rules и quick actions;
- compose, drafts, send, aliases, signatures, templates и attachments;
- calendar через CalDAV/provider integrations;
- tasks, attachments, messengers и AI-assisted productivity;
- Yandex 360 work account hub для обычных Яндекс ID аккаунтов.

Основная provider-модель: IMAP/SMTP плюс Yandex-specific OAuth work account capabilities. Gmail API support является compatibility-only и скрыт по умолчанию. Org-level Yandex 360 administration is a separate admin scenario, not the primary user flow.

## Frontend

Frontend code находится в `src/`.

- `src/components/` - UI surfaces.
- `src/stores/` - Zustand state stores.
- `src/services/` - provider, DB, sync, AI, calendar, filter, quick-step и integration logic.
- `src/hooks/` - shared interaction hooks.
- `src/router/` - navigation helpers.

## Backend

Rust backend code находится в `src-tauri/src/`.

Backend отвечает за native/Tauri integration, IMAP/SMTP commands, OAuth helpers, audio, messenger/native bridges и app-level command registration.

## Data model

Office360 хранит user data локально, в первую очередь через SQLite-backed services в `src/services/db/`.

Mail state является local-first. Provider operations обновляют local state, queue при необходимости и синхронизируются с upstream provider через provider-specific adapters.

## Provider abstraction

Mail providers реализуют `EmailProvider` из `src/services/email/types.ts`.

Provider selection находится в `src/services/email/providerFactory.ts`.

Текущее поведение:

- `gmail_api` создаёт `GmailApiProvider`.
- все остальные mail provider values создают `ImapSmtpProvider`.
- CalDAV обрабатывается calendar provider code и считается mail-disabled в capability checks.

## Capability gating

Provider-specific behavior описывается через `ProviderCapabilities`.

UI и service entry points должны проверять capabilities до показа или выполнения provider-specific actions. Это не даёт Gmail-native actions, особенно labels, протекать в Yandex/IMAP workflows.

См. [Provider Capabilities](provider-capabilities.md).

## Build и deployment

Основные команды:

```bash
npm run build
npm run tauri build
npm run test
```

Для локального macOS deployment usable `.app` находится здесь:

```text
src-tauri/target/release/bundle/macos/Office360.app
```

Packaging `.dmg` может упасть после создания `.app`; это packaging issue, а не обязательно failure application build.
