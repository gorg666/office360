# CAL-130 — Final Calendar UI / accessibility / responsive polish

Дата: 2026-08-24 (Asia/Bangkok).  
Ветка: `feat/calendar-yandex360`.  
База: `52006f4 feat(calendar): harden delta sync and offline policy`.  
Migration: NONE. Cloud event / RSVP / Mail / ACL mutations: NONE.

Цель: не добавлять Calendar features. Довести существующий UI до цельного production polish перед CAL-131 parity audit.

Канон: этот файл. Runtime evidence — `CALENDAR_RUNTIME_BASELINE.md` § CAL-130. Roadmap — `CALENDAR_IMPLEMENTATION_ROADMAP.md` § CAL-130. Финальный parity verdict **не** ставится здесь (CAL-131).

## Scope

Исправления только polish-класса:

- visual consistency, overflow, wrap/shrink toolbar и sidebar;
- visible focus rings, Tab trap, restore focus;
- RU copy в user-visible Calendar surfaces;
- light/dark через design tokens;
- empty / loading / error / offline / stale / syncing различаются в UI;
- typed offline write errors в recurrence/ACL copy.

Не менялись provider/domain/sync архитектура, migrations, secrets, deploy.

## Surfaces

| Surface | Polish |
|---|---|
| Month | `+N` popover: `aria-modal`, initial focus, Tab wrap, Escape, restore focus на overflow control |
| Week / Day | current-time line остаётся token `bg-danger`; Create footer wrap на узком окне |
| Toolbar | wrap, truncate title, `aria-pressed` у view switcher, RU aria-labels, focus-visible |
| Sidebar / list | truncate длинных имён, ACL focus ring, checkbox aria-label, badge на второй строке, ширина `w-44…xl:w-52` |
| Mini calendar | нет в продукте; не создавался (accepted limitation) |
| Create/Edit | footer `flex-col-reverse` на узком окне; typed write-failure copy |
| Event detail | dialog semantics, Escape, focus trap/restore, InfoRow stack на узком окне |
| Search | combobox / `aria-activedescendant`, focus-visible, shrink width |
| ACL UI | RU notices и error codes; форма column на узком окне; live write не выполнялся |
| Offline/sync | отдельный banner «Нет сети» даже при fresh cache; stale/error banners только online |

## Keyboard / focus / a11y

Проверено автоматикой: Tab wrap в Modal и Month overflow; Escape; search list navigation; overflow restore focus. Keyboard drag-and-drop не реализовывался (accepted limitation).

Очевидные a11y правки: `role="dialog"` / `aria-modal`, labels, disabled buttons, focus-visible. WCAG AA сертификация не проводилась.

## RU localization

User-visible Calendar copy для locale `ru` (default): toolbar, list badges, EventCard untitled, ACL roles/errors, recurrence write failures, Calendar route suspense fallback. Provider technical names оставлены. CalendarSearch EN locale сохранён для существующих тестов (`locale="en"`).

## Light / dark / responsive

Цвета событий/индикаторов — design tokens (`text-*`, `bg-*`, `border-*`, `accent`, `danger`, `warning`). Галочки visibility на цветном квадрате календаря остаются overlay `#000`/`#fff` (контраст на произвольном calendar color, не theme token).

Узкое окно: toolbar wrap, search shrink, list/create/detail/ACL не разваливают layout. Mobile app layout не требовался.

## Bundle / orchestration

Безопасный cleanup: `focusTrap.ts` (`queryFocusable` / `trapTabKey`); Modal не импортирует calendar. Большой rewrite `CalendarPage` не делался.

## Accepted limitations (не CAL-130)

- background reminders при полностью завершённом process;
- keyboard drag-selection и auto-scroll drag;
- Yandex ACL writes без standard capability;
- nth-weekday full RFC5545 editor;
- full fuzzy/FTS search;
- mini-calendar в sidebar.

## Tests

| Check | Result |
|---|---|
| TypeScript `npx tsc --noEmit` | PASS (включая `routeTree.tsx` suspense copy) |
| Targeted Calendar UI | PASS — CalendarList, CalendarPage, MonthView, Modal, CalendarSearch, CalendarAclDialog, EventDetailModal, EventCreateModal |
| Full Calendar battery | PASS — 75 files / 672 tests |
| Full Vitest | PASS — 264 files / 2564 tests |
| TZ matrix | PASS — 15 files / 186 tests × UTC, Europe/Moscow, America/New_York, Australia/Lord_Howe |
| Frontend production build | PASS — CalendarPage 162.86 kB / 47.11 kB gzip; main 2,131.41 kB / 632.35 kB gzip |
| `cargo check` | PASS; 2 pre-existing unused-variable warnings в `src/lib.rs:378`; Rust не менялся |

## Live Tauri

Дата live smoke: 2026-08-24 (Asia/Bangkok). Runtime: `npm run tauri -- dev` + WebView2 CDP `127.0.0.1:9222` (не Chrome на Vite). Chrome против `http://localhost:1420` по-прежнему не считается desktop webview. Production code в CAL-130-FINAL не менялся. Cloud event / RSVP / Mail / ACL write: **NONE**. Save/Create/Delete в модалках не нажимались; Create-формы закрывались **Отмена**. Скриншоты только в `%TEMP%/cal130-smoke/`, в git не коммитились. Account id / email / calendar names / event titles в этот отчёт не копировались.

| Letter | Result | Observation |
|---|---|---|
| A Month | PARTIAL | Event detail с карточки открылся и закрылся. Live `+N` N/A: в текущем месяце и ±4 соседних ни один день не имел >3 событий (`month-overflow=0`). Overflow → Create live не воспроизводился; guard остаётся в `MonthView` + unit tests |
| B Week | PASS | `current-time-indicator` виден. Toolbar **Создать** → **Отмена** |
| C Day | PASS | Create form: recurrence, participant role (local `example.com`, без save), reminders. Footer `flex-col-reverse` class присутствует. **Отмена** |
| D Search | PASS | Combobox нашёл существующее событие, открыл detail, закрыл |
| E ACL | PASS | Список календарей → «Управление доступом» → RU unsupported copy, без Добавить/Сохранить/Отозвать. Закрыто без write |
| F Theme | PASS | Settings **Тема**: Светлая ↔ Тёмная (`html.dark`). Календарь остался RU. Тема возвращена на Светлая |
| G Narrow | PASS | Window 900×780: horizontal overflow нет, Create footer `flex-col-reverse`, **Отмена** доступна. Ширина возвращена 1200 |
| H Keyboard | PASS with note | Tab / Shift+Tab остаются внутри dialog; Escape закрывает. Restore на opener в CDP после Escape даёт `BODY` (не toolbar **Создать**). `Modal.tsx` restore path не менялся; не трактовалось как пользовательский баг без ручного Tab с клавиатуры |

Focus trap: PASS. Focus restore: not confirmed to opener via CDP. Responsive: PASS. RU Calendar chrome: PASS (Сегодня / День / Неделя / Месяц / Создать / Поиск событий / Пн-first; случайных EN toolbar strings нет). Syncing vs loading различимы («Обновление календаря…» vs «Загрузка календаря…»). Offline/stale/error banners в этой online-сессии не всплывали.

CAL-130-FINAL: **PARTIAL** только из-за live `+N` N/A. Код не менялся.

## Graphify

`graphify update .` → 7,085 nodes / 18,309 edges / 417 communities. `graphify diagnose multigraph` PASS. Community labels stale vs current set; integrity unaffected. Semantic docs/image `--update` not used.
