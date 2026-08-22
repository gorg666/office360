# CAL-112 — Recurring event edit/delete UX

Status: **PASS** on `feat/calendar-yandex360`.
Code: `src/components/calendar/recurrence/`, wired from `EventDetailModal`.
Backend contract: `CALENDAR_RECURRENCE_MUTATIONS.md` (CAL-111).
Migration: **NONE**.

CAL-112 is the production prompt for editing and deleting existing recurring events.
React does not implement EXDATE, RECURRENCE-ID, overrides or series splits. It only
classifies the opened target and calls `CalendarMutationService` with an explicit
`recurrenceScope`.

## Target classification

Identity comes from domain fields, not from an RRULE on the rendered occurrence:

| Opened row | `kind` | Available scopes (if capability allows) |
| --- | --- | --- |
| `occurrence_key` present | `occurrence` | `single`, then `series` |
| `is_recurrence_master` and no occurrence key | `series-master` | `series` only (`single` is omitted) |
| neither | `plain` | no scope dialog |

Override occurrences are treated as occurrences for UX: they still have an occurrence
key, so the user can choose «Только это событие» or «Всю серию».

## When the dialog appears

The scope dialog is shown **after** Save or Delete intent, not when the editor opens.
The user can change summary, times, place, description and Scheduling Assistant slots
first. Cancel on the dialog:

- does not call the mutation service;
- keeps the editor (or detail panel) open;
- preserves in-progress field values.

Non-recurring events skip the dialog and mutate immediately, matching the previous
plain-event flow. Plain delete still uses the existing two-step inline confirm.

## Edit scope dialog

Title: **Изменить повторяющееся событие**

| Option | Mutation |
| --- | --- |
| Только это событие | `scope = single` plus `seriesUid` and `occurrenceKey` |
| Всю серию | `scope = series` plus `seriesUid`; occurrence key is omitted |

Confirm: **Сохранить**. Cancel: **Отмена**.

A single occurrence move sends the updated `startTime` / `endTime`. Original
recurrence identity is preserved by the CAL-111 backend; the UI does not create a
new standalone event and does not rewrite the rendered occurrence cache.

## Delete scope dialog

Title: **Удалить повторяющееся событие**

| Option | Description shown | Mutation |
| --- | --- | --- |
| Только это событие | Удалить только выбранное событие из серии | `scope = single` |
| Всю серию | Удалить всю серию событий | `scope = series` |

Confirm is a destructive **Удалить**. Single delete must not call a generic
whole-resource delete (`isRecurring: false` or missing scope).

## Capability-driven options

Choices are built from `supportsRecurrenceScope(capabilities, operation, scope)`.
There are **no** `provider === "google"` / `"yandex"` branches.

Offer order is stable: `single`, `series`, `this-and-future`. Unsupported scopes are
**omitted**, not silently remapped. If a later provider advertises `this-and-future`,
the option appears without a UI rewrite.

## This-and-future limitation

Current Google and CalDAV/Yandex capabilities declare only `single` and `series`.
«Это и последующие события» is therefore **hidden**. The UI never submits
`this-and-future`. There is no fallback to `series`.

## Scheduling Assistant

Occurrence and series-master edit both show the CAL-109 assistant. It plans against
the **rendered** occurrence `start` / `end`, duration and participants. Clicking a
suggested slot writes datetime-local into the editor and does **not** save. Save
then opens the scope dialog; the chosen scope is applied to those updated times.

## Error handling

Typed CAL-111 results stay in the editor. The editor is not closed as if Save
succeeded.

| Status | Copy |
| --- | --- |
| `conflict` | Событие было изменено в другом месте. Обновите данные и попробуйте снова. |
| `unsupported` | Этот способ изменения не поддерживается календарём. |
| `permission-denied` | Недостаточно прав для изменения этого календаря. |
| `auth-required` | Сессия календаря истекла. Подключите аккаунт повторно. |
| `network-error` | Не удалось связаться с сервером календаря. Повторите попытку. |

Success still goes through the existing `onUpdated` → CalendarSyncService /
range reconciliation path. React does not patch the event cache.

Save/Delete while a remote mutation is in flight: controls are disabled and an
in-flight guard drops duplicate submits.

## Accessibility

The dialog is a modal with native radios (`radiogroup`), keyboard focus on the
selected option, Escape/backdrop Cancel (blocked while busy), and a danger confirm
for delete.

## Out of scope

Recurrence rule builder on create. If create already stores an RRULE, CAL-112 does
not change that path.
