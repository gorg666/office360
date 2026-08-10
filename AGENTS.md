## Mandatory APOSTLE preflight

Before any task, follow `.ai/APOSTLE.md`.

If the task involves deploy, seed, migration, reset, delete, production runtime files, or secrets, explicit user confirmation is required.

The agent must output an `APOSTLE_CHECK` block before doing work.

# AGENTS — HEADROOM Rules

Универсальные правила для AI-агентов (Cursor, Codex, Claude Code, и др.).

## Контекст

- Не читать весь репозиторий без причины.
- Сначала targeted audit: структура, релевантные файлы, `.ai/PROJECT_CONTEXT.md`.
- Перед чтением больших файлов или логов — объяснить зачем; читать только нужные секции.
- Не вставлять большие логи в чат — кратко резюмировать.
- При большом контексте обновлять `.ai/CURRENT_STATE.md` и продолжать от него.

## Планирование и правки

- Перед правками кратко описать план: какие файлы, что изменится, зачем.
- Маленькие инкрементальные изменения; не переписывать проект целиком без запроса.
- Сохранять существующие соглашения: naming, стиль, архитектура.
- При ошибке команды — остановиться, диагностировать, не повторять вслепую.

## Секреты и production

- **Не читать, не логировать, не коммитить:** `.env`, `.env.local`, `.env.deploy.local`, `config.php`, `cms-config.php`, API tokens, SMTP passwords, FTP credentials, private keys.
- См. `.ai/SECRETS_POLICY.md`.
- Не трогать production config и server-only runtime без явной команды.
- Не делать deploy, migration, seed, reset, delete без явной команды пользователя.
- Перед destructive actions — спросить подтверждение.

## Проверки

- После смысловых изменений — минимальные проверки (см. `.ai/DEPLOY_RUNBOOK.md`): typecheck, lint, build, endpoint smoke.
- После deploy — smoke по runbook проекта.
- Не запускать полные test suite без необходимости.

## Финальный отчёт

Каждая задача завершается кратким отчётом:

1. **Что изменилось** — файлы и суть правок.
2. **Что не трогалось** — код, конфиги, секреты, deploy.
3. **Проверки** — что запускалось и результат.
4. **Риски / blockers** — что проверить вручную.
5. **Следующий шаг** — одно конкретное действие.
