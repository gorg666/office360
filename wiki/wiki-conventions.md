# Правила ведения wiki

Wiki ведётся в `velo/wiki/`.

## Что сохранять здесь

Обновляй wiki, когда изменение затрагивает:

- system architecture;
- provider behavior;
- user-visible workflows;
- account setup;
- sync/offline behavior;
- security/privacy assumptions;
- build or deployment behavior;
- smoke checklists;
- long-lived product decisions.

## Как писать entries

Пиши коротко и operational.

Каждое важное изменение должно содержать:

- дату;
- что изменилось;
- почему это важно;
- affected files/modules, если полезно;
- verification performed;
- residual risks или known gaps.

## Куда класть информацию

- Product/system behavior: `system-overview.md`.
- Provider-specific rules: `provider-capabilities.md`.
- Delivery history: `change-log.md`.
- Repo process и wiki rules: этот файл.

## Язык

Product decisions и system descriptions для Office360 team пишем на русском. English допустим для code identifiers, file paths, APIs, protocols и коротких technical descriptions.
