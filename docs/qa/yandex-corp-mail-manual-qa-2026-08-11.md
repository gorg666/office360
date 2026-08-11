# Manual QA — корпоративная Яндекс-почта (Office360)

**Дата:** 2026-08-11  
**Проект:** `velo-office360-api-ya-clean`  
**Цель:** ручная проверка на реальной корпоративной почте Яндекса (IMAP/SMTP).  
**Режим:** только наблюдение и фиксация багов. Код не править в рамках этого теста.

### Контекст Graphify / известные риски

- Яндекс работает через IMAP/SMTP, не через Yandex Mail API.
- Общий `EmailProvider` есть, но часть функций его обходит.
- Scheduled Send hardcoded на Gmail client.
- Outbox есть, но нет Cancel/Delete.
- Drag-and-drop на labels / Starred / Spam для Yandex/IMAP может молча ничего не делать.
- DnD вложений может обходить лимит 24MB.
- Аватарки могут плохо грузиться на корпоративных адресах.
- Disk не реализован — не демонстрировать.
- Calendar и Messenger реальные, но требуют живой проверки.

---

## Hot files (закрепить в IDE)

### Account / Yandex

- `src/services/oauth/oauthFlow.ts`
- `src/services/oauth/oauthTokenManager.ts`
- `src/services/oauth/providers.ts`
- `src/services/oauth/yandexProfile.ts`
- `src/components/accounts/AddImapAccount.tsx`
- `src/components/accounts/AddAccount.tsx`
- `src-tauri/src/oauth.rs`
- `src/services/imap/autoDiscovery.ts`
- `src-tauri/src/imap/client.rs`
- `src-tauri/src/smtp/client.rs`

### Composer / Send

- `src/components/composer/Composer.tsx`
- `src/utils/emailBuilder.ts`
- `src/services/emailActions.ts`
- `src/services/email/imapSmtpProvider.ts`
- `src/services/email/providerFactory.ts`
- `src/services/email/providerCapabilities.ts`
- `src/components/composer/AttachmentPicker.tsx`
- `src/services/composer/draftAutoSave.ts`
- `src/utils/handleSendEmailResult.ts`

### Outbox / Scheduled

- `src/services/queue/queueProcessor.ts`
- `src/services/db/pendingOperations.ts`
- `src/components/outbox/OutboxList.tsx`
- `src/services/snooze/scheduledSendManager.ts`
- `src/services/db/scheduledEmails.ts`

### Folders / Labels

- `src/components/settings/LabelEditor.tsx`
- `src/components/labels/LabelForm.tsx`
- `src/stores/labelStore.ts`
- `src/components/dnd/DndProvider.tsx`

### Contacts / Avatars

- `src/services/contacts/gravatar.ts`
- `src/components/ui/ContactAvatar.tsx`
- `src/utils/accountAvatar.ts`
- `src/services/db/contacts.ts`

### Localization

- `src/i18n.ts`
- `src/components/i18n/TranslationLayer.tsx`

### Docs / QA

- `docs/specs/mail-workflow.md`
- `docs/specs/mail-qa-defects-2026-06.md`
- `docs/architecture.md`

---

## Ручной QA-чеклист

Для каждого пункта: **Pass / Fail / Blocked** + скрин при Fail. Баги — по шаблону ниже.

### A. Подключение аккаунта

| # | Тест | Ожидание | Watch | Result |
|---|---|---|---|---|
| A1 | OAuth корпоративного `@company` через Yandex | Аккаунт добавляется | `AddImapAccount.tsx`, `oauthFlow.ts` | |
| A2 | Scope guard: в токене есть `mail:imap_full` + `mail:smtp` | Без mail scopes — отказ / явный fallback | `REQUIRED_YANDEX_MAIL_SCOPES`, `providers.ts` (дефолт = login-only) | |
| A3 | Fallback: Manual IMAP / app password | Inbox синхронизируется | `AddImapAccount.tsx`, `autoDiscovery.ts`, `imap/client.rs` | |

### B. Почта core

| # | Тест | Ожидание | Watch | Result |
|---|---|---|---|---|
| B1 | Inbox sync | Письма появляются | `imapSmtpProvider.ts`, IMAP sync | |
| B2 | Отправка | Письмо уходит | `Composer.tsx` → `emailActions` → SMTP | |
| B3 | Sent | Есть в Sent на сервере и в UI | `imapSmtpProvider` save-sent | |
| B4 | Reply / Forward | Корректные заголовки, доставка | `emailBuilder.ts`, reply headers | |
| B5 | Draft autosave | Черновик сохраняется (возможен DEF-03: дубли IMAP) | `draftAutoSave.ts` | |

### C. Outbox / Scheduled

| # | Тест | Ожидание | Watch | Result |
|---|---|---|---|---|
| C1 | Offline send → Outbox | Появляется в очереди | `queueProcessor.ts`, `OutboxList.tsx` | |
| C2 | Retry при failed | Есть Retry | `OutboxList` — только Retry | |
| C3 | Cancel / Delete в Outbox | **Нет** (DEF-09) — зафиксировать | `OutboxList.tsx` | |
| C4 | Scheduled Send на Яндексе | **Ожидаем fail** (hardcoded Gmail) | `scheduledSendManager.ts` | |

### D. Вложения / DnD

| # | Тест | Ожидание | Watch | Result |
|---|---|---|---|---|
| D1 | Picker > 24MB | Блок / warn | `AttachmentPicker.tsx` | |
| D2 | DnD файла > 24MB в Composer | **Ожидаем bypass** (DEF-13) | `Composer.tsx` `handleDrop` | |
| D3 | DnD письма на label / Starred / Spam | **Silent no-op** на IMAP (DEF-05) | `DndProvider.tsx` → `imapSmtpProvider.addLabel` | |

### E. UX / прочее

| # | Тест | Ожидание | Watch | Result |
|---|---|---|---|---|
| E1 | Аватарки corp / без Gravatar | Могут быть пустые / stub yapic | `yandexProfile.ts`, `ContactAvatar.tsx`, `gravatar.ts` | |
| E2 | Русский UI | Основные экраны на RU | `i18n.ts`, `TranslationLayer.tsx` | |
| E3 | Calendar | События при живом CalDAV/oauth | calendar provider | |
| E4 | Messenger | Базовый обмен / бот | messenger services | |
| E5 | Disk | **Не тестировать / не демо** | — | N/A |

---

## Шаблон бага

```text
Название:
Приоритет: P0 / P1 / P2 / P3
Где: Account | Composer | Outbox | Scheduled | Labels/DnD | Attachments | Avatars | Calendar | Messenger | i18n
Шаги:
1.
2.
3.
Ожидалось:
Фактически:
Скрин: (путь/вложение)
Файл/подозреваемая зона:
Известный DEF (если есть): DEF-XX
```

---

## Готовые заготовки багов

### 1. Scheduled Send на Yandex

- **Приоритет:** P0
- **DEF:** DEF-02
- **Где:** Scheduled
- **Файл/зона:** `src/services/snooze/scheduledSendManager.ts` → `getGmailClient`
- **Ожидалось:** SMTP через `EmailProvider`
- **Фактически (ожидаем):** Gmail client / fail на Yandex/IMAP

### 2. Outbox без Cancel/Delete

- **Приоритет:** P1
- **DEF:** DEF-09
- **Где:** Outbox
- **Файл/зона:** `src/components/outbox/OutboxList.tsx`
- **Ожидалось:** Cancel / Delete
- **Фактически (ожидаем):** только Retry

### 3. DnD на Starred / Spam / Label

- **Приоритет:** P1
- **DEF:** DEF-05
- **Где:** Labels/DnD
- **Файл/зона:** `src/components/dnd/DndProvider.tsx` + `src/services/email/imapSmtpProvider.ts` (`addLabel`)
- **Ожидалось:** действие на сервере или явная ошибка
- **Фактически (ожидаем):** silent no-op (+ `console.warn`)

### 4. DnD вложений > 24MB

- **Приоритет:** P1
- **DEF:** DEF-13
- **Где:** Attachments
- **Файл/зона:** `src/components/composer/Composer.tsx` (`handleDrop`)
- **Ожидалось:** отказ как в picker
- **Фактически (ожидаем):** файл принимается без лимита

---

## Рабочая карта

### What to test first

1. A1–A3 (OAuth + scopes + IMAP fallback)
2. B1–B4 (Inbox → Send → Sent → Reply)
3. C1–C4 (Outbox + Scheduled — поймать блокеры)
4. D1–D3 (attachments + DnD labels)
5. E1–E4 (avatars, RU, Calendar, Messenger)

### Expected blockers

| Риск | DEF | Файл |
|---|---|---|
| Login-only scopes без `VITE_YANDEX_OAUTH_SCOPES` | DEF-01 | `providers.ts` |
| Scheduled = Gmail-only | DEF-02 | `scheduledSendManager.ts` |
| Labels/DnD no-op на IMAP | DEF-05 | `imapSmtpProvider.ts` |
| Outbox без Cancel/Delete | DEF-09 | `OutboxList.tsx` |
| DnD attachments без 24MB | DEF-13 | `Composer.tsx` |
| Аватары corp / yapic stub | — | `yandexProfile.ts` |
| Folder edit только Gmail | — | `providerCapabilities.ts` |

### Files to watch during test

- **Connect:** `AddImapAccount.tsx`, `oauthFlow.ts`, `providers.ts`
- **Send:** `Composer.tsx`, `emailActions.ts`, `imapSmtpProvider.ts`, `smtp/client.rs`
- **Failures:** `scheduledSendManager.ts`, `OutboxList.tsx`, `DndProvider.tsx`, `AttachmentPicker.tsx`
- **Avatars:** `yandexProfile.ts`, `ContactAvatar.tsx`

### Bug report template

См. раздел «Шаблон бага» выше.

### What not to demo

- **Disk** — не готов
- Folder create / rename / delete на Yandex/IMAP (`supportsFolderEditing` = false)
- Scheduled Send как «работает»
- DnD labels / Starred / Spam как рабочий UX
- «Полный Yandex Mail API» — транспорт только IMAP/SMTP

---

## Ссылки

- Дефекты: `docs/specs/mail-qa-defects-2026-06.md`
- Workflow: `docs/specs/mail-workflow.md`
- Архитектура: `docs/architecture.md`
