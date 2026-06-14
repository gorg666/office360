# Testing Process

Эта страница фиксирует минимальный процесс проверки Office360, чтобы UI changes не считались проверенными только по unit tests или сборке.

## Verification Layers

1. Targeted tests
   - Запускать ближайшие `*.test.ts` / `*.test.tsx` для измененных сервисов, компонентов и helpers.
   - Для provider guardrails обязательно покрывать service enforcement, UI copy и docs/help consistency.

2. Full frontend checks
   - `npm run test`
   - `npm run build`

3. Desktop build
   - `npm run tauri build`
   - Проверить fresh artifact: `src-tauri/target/release/bundle/macos/Office360.app`.

4. Installed app refresh
   - Остановить текущий Office360.
   - Заменить `/Applications/Office360.app` свежим bundle через `ditto --rsrc --extattr`.
   - Проверить подпись установленного bundle: `codesign -vvv --strict /Applications/Office360.app`.
   - Если локальный `.app` после `ditto` не проходит strict-проверку, переподписать его ad-hoc: `codesign --force --deep --sign - /Applications/Office360.app`, затем повторить strict-проверку.
   - Запустить installed app, а не только Vite/dev server.

5. Desktop smoke evidence
   - Запустить `npm run smoke:desktop` для общего smoke или feature-specific сценарий для измененного workflow.
   - Для UI guardrails Add Account / Exchange запускать `npm run smoke:desktop -- --restart --scenario add-account-exchange --screenshot artifacts/desktop-smoke/add-account-exchange.png`.
   - Проверить JSON output: `ok: true`, app path, process info, screenshot path, screenshot size.
   - Открыть generated screenshot и убедиться, что виден Office360, а не перекрывающее окно.

## UI Smoke Rules

- UI change нельзя считать полностью проверенным без desktop screenshot evidence или явного accepted residual risk.
- Если окно перекрыто Code/Chrome, использовать `npm run smoke:desktop`; скрипт скрывает типовые blockers, активирует bundle id и снимает screenshot.
- Для UI-фичи нужен smoke того же workflow, который менялся. Generic `app-visible` smoke подтверждает только запуск и не заменяет сценарий.
- Если smoke script не может поднять/снять окно, report должен быть `blocked` или `residual risk`, а не `passed`.
- Browser-only smoke не заменяет installed desktop smoke для Tauri-visible changes.
- Screenshot artifacts пишутся в `artifacts/desktop-smoke/` и не коммитятся.

## Current Desktop Smoke Tool

Command:

```bash
npm run smoke:desktop
npm run smoke:desktop -- --scenario add-account-exchange --screenshot artifacts/desktop-smoke/add-account-exchange.png
```

Script:

```text
scripts/desktop-smoke.mjs
```

Default output:

```text
artifacts/desktop-smoke/office360.png
```

What it verifies:

- `/Applications/Office360.app` exists.
- `com.office360.desktop` launches or focuses.
- `office360` process has a visible window.
- Screenshot file is created and has non-trivial size.
- `add-account-exchange` scenario opens Add Account and asserts that IMAP/SMTP Microsoft OAuth is not labeled native Exchange, while Microsoft 365 / Exchange is not shown as a provider choice until an adapter exists.

What remains manual:

- Workflow-specific clicks for scenarios not yet automated.
- Field entry for real accounts or OAuth flows.
- Provider-specific live network behavior.

## Reporting Template

Use this shape in handoff/final reports:

```text
Targeted tests: passed/failed, command list.
Full tests: passed/failed.
Build: passed/failed.
Tauri build: passed/failed, artifact path.
Installed refresh: passed/failed, installed path.
Desktop smoke: passed/failed, screenshot path.
Residual risk: exact untested workflow, if any.
```
