# Office360

Office360 - local-first desktop workspace для почты, календаря, задач, вложений, мессенджеров и AI-assisted productivity.

Основной продуктовый фокус: IMAP/SMTP и Yandex-based mail workflows. Gmail API остаётся только явным compatibility provider и скрыт в product UI по умолчанию.

## Продуктовый scope

- Desktop mail client на Tauri v2, React, TypeScript и Rust.
- Local-first хранение почты в SQLite и offline-capable workflows.
- Целевые почтовые провайдеры: IMAP/SMTP, Yandex Mail через Yandex ID/OAuth и будущие POP3-oriented flows.
- Calendar support через CalDAV и provider-specific integrations.
- AI features для summaries, replies, writing assistance, inbox search и categorization.
- Workspace surfaces для tasks, attachments, messengers, smart folders, rules и quick actions.

## Wiki

Project knowledge ведётся в [wiki/](wiki/README.md).

Wiki используется для:

- архитектуры системы и поведения продукта;
- provider capability decisions;
- delivery notes и smoke checklists;
- change history, которая влияет на работу Office360.

Если изменение затрагивает provider behavior, user-facing flows, system architecture или build/deployment behavior, обновляй релевантную wiki-страницу в той же ветке.

## Разработка

Установка зависимостей:

```bash
npm install
```

Запуск desktop app в dev mode:

```bash
npm run tauri dev
```

Запуск только Vite frontend:

```bash
npm run dev
```

Frontend build:

```bash
npm run build
```

Native app build:

```bash
npm run tauri build
```

Тесты:

```bash
npm run test
```

Точечный тест:

```bash
npx vitest run src/path/to/file.test.ts
```

## Структура проекта

- `src/` - React/TypeScript frontend.
- `src/components/` - UI components и feature surfaces.
- `src/services/` - mail providers, DB access, sync, AI, calendar, filters и integration logic.
- `src/stores/` - Zustand stores.
- `src/hooks/` - shared React hooks.
- `src/router/` - route/navigation helpers.
- `src-tauri/src/` - Rust backend, Tauri commands, IMAP/SMTP/OAuth/native integrations.
- `docs/` - существующая техническая документация app-проекта.
- `wiki/` - living Office360 project wiki и change history.
- `landing/` - marketing/landing page project.

## Provider model

Office360 использует provider capabilities, чтобы решать, какие действия доступны для конкретного account type.

- `gmail_api` получает Gmail API и native label capabilities.
- `imap`, Yandex mail accounts, будущие POP3-like accounts и unknown provider values используют IMAP-compatible capability profile по умолчанию.
- IMAP/Yandex profiles не показывают Gmail-native label UI.
- CalDAV accounts считаются calendar-only в mail capability checks.

См. [wiki/provider-capabilities.md](wiki/provider-capabilities.md).

## Build notes

На macOS `npm run tauri build` может успешно создать:

- `src-tauri/target/release/office360`
- `src-tauri/target/release/bundle/macos/Office360.app`

и после этого упасть на packaging `.dmg` в `bundle_dmg.sh`. В таком случае `.app` bundle всё равно можно использовать для локального deployment.

## Security

Не коммитить secrets, OAuth credentials, tokens, local databases, generated app bundles или runtime artifacts.

Базовые требования:

- local-first mail behavior;
- sanitized HTML rendering;
- encrypted credential/token storage;
- remote image blocking;
- provider-aware action gating before executing mail operations.

## Лицензия

Office360 распространяется по закрытой proprietary-лицензии. См. [LICENSE](LICENSE).
