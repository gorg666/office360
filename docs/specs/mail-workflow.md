# Office360 Mail Workflow Spec

## Статус

Draft

## Ветка для реализации

`office360-mail-workflow`

## Цель

Сделать почтовый workflow ближе к desktop-клиенту: пользователь должен писать письма, открывать письма в отдельных окнах и видеть очередь исходящих без блокировки основного интерфейса.

## Задачи мини-спринта

### 1. Новое письмо не блокирует основной экран

**Статус:** Done

**Реализация:** `6bec76b` fix(mail): make composer non-blocking

**Итог:**

* убран blocking backdrop (dim/blur-слой на весь экран);
* composer открывается как floating/non-blocking панель поверх интерфейса;
* основной интерфейс остаётся кликабельным, закрытие — через `×` / «Отменить».

#### Проблема

Сейчас создание нового письма может блокировать основной интерфейс или вести себя как модальное действие. Пользователь теряет возможность параллельно смотреть входящие, читать письма и работать с приложением.

#### Требуемое поведение

* При нажатии “Новое письмо” composer открывается как неблокирующее окно/панель.
* Основной интерфейс остаётся кликабельным.
* Пользователь может открыть другое письмо, не закрывая composer.
* Можно закрыть composer без потери введённого текста, если уже есть логика черновиков.
* Если уже есть отдельное окно composer — использовать его, а не писать второй механизм.

#### Acceptance criteria

* Основной экран не блокируется при создании письма.
* Можно открыть письмо из списка, пока composer открыт.
* Можно закрыть composer.
* Черновики/автосохранение не ломаются.
* Отправка письма работает.

---

### 2. Двойной клик по письму открывает письмо в отдельном окне

**Статус:** Done

**Реализация:** `38fca11` feat(mail): open message in separate window on double click

**Итог:**

* одинарный клик оставлен как preview;
* двойной клик открывает письмо в отдельном окне;
* повторный double-click фокусирует уже открытое окно;
* browser fallback не падает без Tauri.

#### Проблема

Сейчас письмо открывается в области чтения. Для desktop-клиента нужно поведение: один клик — preview, двойной клик — отдельное окно.

#### Требуемое поведение

* Одинарный клик по письму работает как сейчас.
* Двойной клик открывает выбранное письмо в отдельном окне.
* Новое окно показывает тему, отправителя, получателей, дату, тело письма и вложения.
* Если Tauri window API недоступен, в browser/dev режиме должен быть fallback без падения.
* Повторный двойной клик по тому же письму не должен плодить бесконечно одинаковые окна, если можно сфокусировать уже открытое.

#### Acceptance criteria

* Single click не сломан.
* Double click открывает письмо отдельно.
* В отдельном окне письмо читаемо.
* Вложения не ломаются.
* Browser preview не падает без Tauri.

---

### 3. Папка “Исходящие” для очереди отправки

**Статус:** Done

**Реализация:** `f908ac4` feat(mail): add outbox send queue view

**Семантика Outbox (фаза 2):** `8ca5be2` feat(mail): clarify outbox send queue status — Outbox = очередь pending/failed retryable отправки, **не** Sent.

* offline send → Outbox;
* online retryable send error → Outbox;
* failed after retry limit → Outbox (статус failed, retry в UI);
* online success → **не** показывается в Outbox; письмо появляется в Sent после sync;
* scheduled send (`scheduled_emails`) → отдельно, **не** смешивается с Outbox.

**Send feedback (фаза 1):** `701a127` fix(mail): preserve drafts on send failure — composer/inline reply обрабатывают `ActionResult`: success/queued очищают draft/reply; failed сохраняет черновик и показывает toast.

**Folder editing:** capability-gated in `372a3c5` — Gmail supported; IMAP/Yandex disabled until backend support is implemented.

**Итог UI (фаза 2):**

* добавлена папка `Outbox` / «Исходящие»;
* отображаются только `sendMessage` из `pending_operations` (pending / executing / failed);
* статусы EN: `Waiting to send`, `Sending…`, `Send failed`;
* описание и empty state объясняют, что это очередь отправки, а не Sent;
* badge в sidebar считает только outbox send ops (`getOutboxSendCount`);
* после восстановления сети очередь повторяет отправку;
* после успешной отправки письмо исчезает из Outbox;
* при ошибке доступен retry; для pending после backoff показывается «Last attempt failed».

#### Проблема

Пользователь должен видеть письма, которые:

* ожидают отправки;
* отправляются сейчас;
* не отправились из-за ошибки;
* находятся в offline queue.

#### Требуемое поведение

* В sidebar есть папка “Исходящие”.
* В “Исходящих” отображаются письма из очереди отправки.
* Для каждого письма показывается:

  * получатель;
  * тема;
  * дата создания/попытки отправки;
  * статус: “Ожидает отправки”, “Отправляется”, “Ошибка отправки”.
* После успешной отправки письмо исчезает из “Исходящих”.
* После успешной отправки письмо должно быть доступно в “Отправленные”, если текущая логика это поддерживает.
* Для ошибки отправки показывать понятную причину.
* Должна быть возможность повторить отправку, если такая логика уже есть. Если нет — добавить TODO.

#### Acceptance criteria

* Папка “Исходящие” открывается.
* Видны pending/failed send операции.
* Успешно отправленные письма не остаются в “Исходящих”.
* Ошибки отправки понятны пользователю.
* Существующая отправка писем не ломается.

---

## Что не трогаем в этом спринте

* OAuth / Yandex login flow.
* IMAP sync core без необходимости.
* Calendar.
* Files section.
* Messenger integrations.
* AI features.
* `src-tauri/Cargo.toml`, если он modified только из-за line endings.
* main branch.

## Файлы-кандидаты

### Composer

* `src/components/composer/Composer.tsx`
* `src/services/composer/draftAutoSave.ts`
* `src/services/emailActions.ts`

### Список писем / открытие письма

* `src/components/layout/EmailList.tsx`
* `src/components/email/ThreadView.tsx`
* `src/components/email/ThreadCard.tsx`
* Tauri window helpers, если уже есть

### Исходящие / очередь

* `src/components/layout/Sidebar.tsx`
* `src/services/db/pendingOperations.ts`
* `src/services/queue/queueProcessor.ts`
* `src/services/emailActions.ts`
* `src/services/db/scheduledEmails.ts`
* `src/services/gmail/syncManager.ts`

## Риски

* Можно сломать текущий composer/черновики.
* Можно создать дубли окон писем.
* Можно смешать “Исходящие” с “Отправленными”.
* Можно случайно зацепить syncManager шире, чем нужно.
* Browser Tab может падать, если Tauri API не загардить.

## План реализации

### Шаг 0. Подготовка ветки

* Сохранить текущие незакоммиченные изменения через stash, если они мешают.
* Перейти на `office360-api-ya`.
* Создать `office360-mail-workflow`.

### Шаг 1. Исследование текущей реализации

* Проверить текущий composer flow.
* Проверить обработчики кликов в списке писем.
* Проверить существующую очередь отправки.

### Шаг 2. Неблокирующий composer

* Минимальный патч.
* Проверка отправки и черновиков.

### Шаг 3. Double click → отдельное окно письма

* Реализация через существующий window mechanism.
* Browser-safe fallback.

### Шаг 4. Исходящие

* Отображение pending/failed operations.
* Статусы.
* Empty state.

### Шаг 5. Проверки

* `npm run build`
* `cargo build`
* `npm run tauri dev`

## Проверки перед коммитом

* Создать новое письмо.
* Проверить, что основной экран не блокируется.
* Открыть письмо одинарным кликом.
* Открыть письмо двойным кликом в отдельном окне.
* Отправить тестовое письмо.
* Проверить папку “Исходящие”.
* Проверить ошибку отправки, если возможно.
* Проверить, что Yandex OAuth не затронут.
* Проверить, что Files section не затронут.

## Коммиты

Планируемые коммиты:

1. `docs: add mail workflow spec`
2. `fix(mail): make composer non-blocking`
3. `feat(mail): open messages in separate window on double click`
4. `feat(mail): add outbox send queue view`
5. `701a127` `fix(mail): preserve drafts on send failure`
6. `8ca5be2` `feat(mail): clarify outbox send queue status`

## Сопутствующая стабилизация

Коммиты на `office360-mail-workflow` вне scope мини-спринта (composer / double-click / outbox):

* **`c52a868`** `fix(search): correct unread counts for smart folders and categories` — счётчики непрочитанных для smart folders и категорий; `COUNT(DISTINCT thread_id)` и учёт `message.is_read` на уровне сообщений. Влияет на split inbox / smart folders, не отдельная mail workflow фича.
* **`c9701da`** `feat(settings): restore i18n for about panel` — i18n Settings/About: EN в JSX + `TranslationLayer` / `i18n.ts`; `Г—` → `×` в shortcuts; EN для подсказки своего фона темы.
* **`3f4456c`** `fix(accounts): localize smtp test errors and timeouts` — EN user-facing ошибки SMTP test, RU через `i18n.ts`; таймаут проверки 20 с (UI + Rust); надёжность setup аккаунта, не mail workflow.
* **`057c64f`** `fix(accounts): require yandex mail scopes before saving` — managed Yandex OAuth не сохраняет аккаунт без `mail:imap_full` и `mail:smtp`; для dev — `VITE_YANDEX_OAUTH_SCOPES` (см. `docs/development.md`, `.env.example`).
