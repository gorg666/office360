# CAL-AUDIT-001 — Git baseline

Дата аудита: 2026-08-21 (Asia/Bangkok)
Репозиторий: `velo-office360-api-ya-clean`
Режим: read-only Git audit; ветки, stash, index и история не изменялись.

## Итог

Git-история пригодна как основа, но рабочее дерево нельзя считать чистым. Новую Calendar-ветку пока создавать не следует: сначала нужно сохранить или классифицировать текущие незакоммиченные артефакты и явно утвердить интеграционный HEAD как baseline.

## Текущая точка

| Поле | Значение |
|---|---|
| Ветка | `GORGDEV2-EFIM-INTEGRATION` |
| HEAD | `10c7a54fb8eb6c36c8e70bc0628b100405189bae` |
| Subject | `feat: integrate Yandex services and stabilize hybrid navigation` |
| Upstream | `origin/GORGDEV2-EFIM-INTEGRATION` |
| Upstream status | синхронизирован, ahead 0 / behind 0 |
| Ближайшая интеграционная база | `GORGDEV2` @ `2aaa905` |
| Расхождение с `GORGDEV2` | behind 0 / ahead 2 |
| Расхождение с `origin/main` | behind 0 / ahead 7 |
| `origin/HEAD` | `origin/chore/office360-plugin-installed-refresh` |
| `gitverse/HEAD` | `gitverse/main` |

`origin/HEAD` не указывает на `origin/main` и не должен использоваться как автоматический источник новой feature-ветки. Фактическая линия продукта сейчас также не совпадает с простым `main`: активная работа находится на GORGDEV/GORGDEV2/EFIM integration branches.

## Remotes

| Remote | Fetch / push |
|---|---|
| `origin` | `https://github.com/gorg666/office360.git` |
| `gitverse` | `git@gitverse.ru:mega_team/velo.git` |

В URL remotes встроенных credentials не обнаружено. Содержимое credential/config файлов не читалось.

## Рабочее дерево

`git status --short` на момент аудита:

```text
 M src-tauri/Cargo.toml
?? [REDACTED SECRET-LIKE FILE]
?? docs/qa/_i18n_scan_raw.json
?? docs/qa/_vitest_gorgdev2.json
?? docs/qa/evidence/
```

Наблюдения:

- `src-tauri/Cargo.toml` отмечен modified, но `git diff`, `git diff --stat`, `git diff --name-status` и `git diff --numstat` не показали содержательного diff; Git предупреждает о будущем LF → CRLF. Это похоже на line-ending/worktree noise, но файл нельзя автоматически восстанавливать без решения владельца.
- `[REDACTED SECRET-LIKE FILE]` по имени выглядит секретоподобным backup. Его содержимое намеренно не открывалось. Его нельзя добавлять в commit; рекомендуется безопасно переместить за пределы репозитория или удалить вручную после проверки владельцем.
- QA JSON/evidence являются untracked и могут быть незавершённой пользовательской работой.
- Staged changes отсутствуют; `git diff --cached` пуст.
- Запуск build создал/обновил только игнорируемый `dist/`; он не появился в status.

## Stash

```text
stash@{0}: On GORGDEV: wip-unrelated-before-merge-gorgdev-efim-final
stash@{1}: On office360-files-section: wip: save files-section leftovers before mail workflow branch
```

Stash не применялся и не просматривался. Перед branch cleanup следует убедиться, что оба stash задокументированы и не содержат незаменимой работы.

## Значимые ветки

### Локальные

- `GORGDEV2-EFIM-INTEGRATION` — текущая интеграционная линия, HEAD `10c7a54`.
- `GORGDEV2` — защищённая база `2aaa905`; текущая ветка на 2 commit впереди.
- `GORGDEV` — i18n/mail линия `f26a3da`.
- `baseline/office360-2026-08-11` — отдельный worktree, `5d17112`.
- `merge/gorgdev-efim-final` — историческая merge/QA линия.
- `office360-mail-workflow`, `office360-files-section`, `office360-api-ya` — старые специализированные линии.

### Calendar/Mail/Auth remote branches

- `origin/feat/epic-08-calendar-invitations` @ `d12a0e6` — полностью находится в ancestry текущего HEAD (`HEAD...branch = 84/0`); это не незамердженная Calendar-ветка.
- `origin/feat/epic-05-compose-mime-reliability` — значима для будущего outgoing iTIP/MIME.
- `origin/feat/epic-07-contacts-address-book` и `origin/feat/epic-13-full-address-book` — значимы для attendee picker/directory identity.
- `origin/feat/epic-09-security-privacy` — значима для privacy/access-control patterns.
- `origin/feat/epic-12-yandex360-work-account-foundation` — значима для corporate identity/provider scopes.
- `origin/efim-11-08-auth`, `origin/fix/telemost-cef-profile-isolation`, `origin/merge/efim-gorgdev-main` — релевантны OAuth/Telemost/shell integration.

Удалённые dependabot/release branches не являются Calendar baseline.

## Значимая история Calendar

| Commit | Суть | Статус относительно HEAD |
|---|---|---|
| `08e05ff` | CalDAV integration для IMAP/standalone account | в ancestry |
| `799eb4c` | ранний «календарь яндекс» | в ancestry; исторический слой |
| `d12a0e6` | Mail invitation cards, local RSVP queue | в ancestry |
| `e59453c` | recurrence expansion + Calendar/Telemost fixes | в ancestry |
| `f4e5124` | event details и direct provider RSVP | в ancestry |
| `4730f17` | Telemost event context | в ancestry |
| `0ece544` | Telemost scheduling + account OAuth | в ancestry |

Текущий HEAD уже содержит наиболее значимые Calendar-наработки. Возврат на `origin/main` или `GORGDEV2` без переноса этих commit потеряет часть актуального Calendar foundation.

## Риск потери работы

Риск есть по трём причинам:

1. modified `Cargo.toml` и untracked QA artifacts;
2. секретоподобный backup нельзя случайно stage/commit;
3. `origin/HEAD` указывает не на ожидаемую main branch.

Безопасная последовательность перед созданием ветки:

1. Владелец вручную классифицирует `Cargo.toml`, QA artifacts и `.mcp...bak`.
2. Нужные QA artifacts сохраняются отдельным commit/stash/внешним архивом; secret-like backup исключается из Git.
3. Выполняется повторный `git status --short` и подтверждается отсутствие чужих изменений.
4. Владелец утверждает `10c7a54` либо более новый принятый EFIM integration commit как Calendar baseline.

## Рекомендованная стратегия веток

После выполнения условий выше:

- базовый commit: `10c7a54` **или его явно утверждённый successor** после закрытия/waiver текущего integration checkpoint;
- основная ветка: `feat/calendar-yandex360` (соответствует существующей convention `feat/...`, а не `feature/...`);
- для больших независимых slices: короткоживущие ветки вида `feat/calendar-yandex360-cal-10x` от основной Calendar-ветки;
- merge только через проверяемые CAL tickets, без долгоживущих параллельных DB-migration branches;
- provider contracts, DB migrations, recurrence/timezone и Mail iTIP не разрабатывать одновременно в пересекающихся ветках.

Не рекомендуется:

- создавать ветку от `origin/HEAD`;
- создавать ветку от `origin/main` без явного cherry-pick/merge актуальных Calendar commit;
- переключать ветку при текущем dirty state;
- использовать старую `feat/epic-08-calendar-invitations` как новую основу — она уже поглощена текущей историей.

## Выполненные read-only команды

Выполнены: `git status`, `git status --short`, `git branch`, `git branch -a`, `git branch -vv`, `git remote -v`, `git log --oneline --decorate -30`, `git log --graph --oneline --decorate --all -40`, тематические `git log`, path history, `git diff`, `git diff --cached`, `git stash list`, `git rev-list --left-right --count`, `git merge-base`, `git for-each-ref`, `git show --stat`.

Git fetch/pull/push, checkout/switch, add, commit, reset, stash mutation и branch creation не выполнялись.

## CAL-101 повторный аудит — 2026-08-21

Baseline не изменился: `GORGDEV2-EFIM-INTEGRATION` @ `10c7a54`, upstream `+0/-0`, staged changes отсутствуют.

### Классификация dirty worktree

| Category | Объекты | Решение |
|---|---|---|
| A — реальные source changes | Нет подтверждённых | Не найдено содержательного source diff |
| B — line-ending/stat noise | `src-tauri/Cargo.toml` | Worktree и index blob оба `24ee8b80...`; `git diff` пуст, EOL `i/lf w/lf`; не восстанавливать автоматически |
| C — generated QA artifacts | 2 QA JSON + `docs/qa/evidence/hybrid-runtime-2026-08-11/` | Сохранить; ownership/disposition должен подтвердить владелец |
| D — secret-like backup | `[REDACTED SECRET-LIKE FILE]` | Не открыт, не ignored, не stage/commit; переместить вне repo или удалить только владельцем |
| E — build artifacts | `dist/`, `src-tauri/target/` | Ignored; в status не появились |
| F — intentional audit docs | `docs/calendar/*.md` | Сохранить как CAL-AUDIT-001/CAL-101 documentation; пока untracked |
| G — unknown source work | Нет | Stash перечислены отдельно и не трогались |

`.gitignore` проверен. Очевидная будущая защита — ignore-rule для этого класса local backup; оно не добавлено автоматически, потому что само стало бы новой незакоммиченной правкой, а secret-like file сначала должен быть вынесен владельцем. QA evidence не следует игнорировать автоматически: оно может быть предназначено для отдельного QA commit.

### Решение по ветке

`feat/calendar-yandex360` **НЕ СОЗДАНА**. Причины:

1. QA artifacts и Calendar docs ещё не сохранены commit/stash/external archive.
2. `[REDACTED SECRET-LIKE FILE]` находится внутри repo и не ignored.
3. `Cargo.toml` остаётся ложным `M` в status, хотя content идентичен index.

Безопасный base candidate после preservation: `10c7a54` (либо явно принятый successor). `origin/HEAD` по-прежнему нельзя использовать как base.

## CAL-101A closure — 2026-08-21

Предыдущий dirty-state сохранён без потери данных и полностью классифицирован:

| Объект | Решение | Итог |
|---|---|---|
| `src-tauri/Cargo.toml` false `M` | SAFE INDEX REFRESH | Worktree/index/HEAD blob одинаковы (`24ee8b80...`), `i/lf w/lf`; cached stat size был устаревшим на OneDrive при system `core.autocrlf=true`. Точечный `git add -- src-tauri/Cargo.toml` обновил index metadata, не создал cached diff и убрал ложный `M` |
| 2 generated QA JSON | MOVE OUTSIDE REPO | Сохранены вне repo в workspace `.ai/preserved/cal-101a-20260821/qa/`; не удалены и не входят в baseline commit |
| hybrid runtime evidence directory | MOVE OUTSIDE REPO | Сохранён в том же внешнем каталоге; предыдущие QA evidence не смешаны с Calendar baseline |
| `[REDACTED SECRET-LIKE FILE]` | IGNORE | Untracked, не найден в history, не открыт; узкое правило `.mcp.json.bak-*` гарантирует отсутствие в status/commit |
| `docs/calendar/*.md` | COMMIT | Legitimate audit/runtime/architecture/roadmap documentation; secret-pattern scan clean |
| IMAP runtime identifier | MINIMAL SECURITY FIX | Native username заменён на `[redacted]` / `[missing]`, добавлены unit tests |

Stash не изменялся. Не выполнялись reset/clean/restore, deploy, migration, seed или удаление. Baseline successor должен содержать только `.gitignore`, пять Calendar documents и изолированный native log-redaction fix; после его создания `feat/calendar-yandex360` можно безопасно создать от этого commit.
