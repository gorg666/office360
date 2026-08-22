# CAL-109 — Scheduling Assistant UI

Status: **PASS** on `feat/calendar-yandex360`, 2026-08-22. Feature: `5edefcf`. Live smoke closed the previous CEF file-lock PARTIAL.
Code: `src/components/calendar/scheduling/`, wired from `EventCreateModal` and `EventDetailModal` (edit mode).
Migration: **NONE**. The UI is a thin consumer of CAL-108.

CAL-109 is the visual Scheduling Assistant. It must not recompute availability, rank slots,
read Calendar DB, parse events, or talk to providers. Ranking, classification and busy
geometry come from `SchedulingAssistantService.planMeeting()` → `GroupSchedulingResult`.

## UI structure

```text
EventCreateModal / EventDetailModal (editing, non-recurring)
        ↓
SchedulingAssistant
        ├── toolbar (prev / today / next, granularity 15/30/60, timezone)
        ├── participant column + availability timeline
        ├── group row «Все обязательные участники»
        ├── suggested slots (engine `suggestions`, no re-rank)
        └── legend
```

Helpers that only map engine data to layout/copy live in `schedulingView.ts`
(datetime-local ↔ unix, day range, ticks, privacy strip of busy intervals, RU labels).
They do not classify slots.

## Engine integration

Production path:

```text
createAccountSchedulingAssistant(accountId).planMeeting(request)
```

Tests inject `planMeeting`. The request is built from:

| Editor state | Request field |
| --- | --- |
| self + attendee emails / parsed attendees | `requiredParticipants` / `optionalParticipants` |
| current start/end | `durationSeconds` |
| IANA zone of the datetime-local fields | `timeZone` |
| selected day (event date or prev/next/today) | `range` (one local calendar day) |
| toolbar «Шаг» | `options.granularitySeconds` |

`AbortSignal` and a generation counter drop late responses. Debounce is 200 ms in
production (`debounceMs={0}` in tests). Changing participants, required/optional,
duration, day or granularity re-runs the engine without a page reload.

Working-hours constraints are **not** invented in the UI. Bands and captions appear
only when the engine returns `workingHoursApplied` / `outsideWorkingHoursParticipants`.

## State mapping

| Engine | UI |
| --- | --- |
| `availability[].busy` (`busy` / `tentative`) | participant row blocks; tooltip «Занят» / «Под вопросом» |
| reliability `unsupported` / `unknown` / `error` | striped `?` fill + «Нет данных о занятости» |
| reliability `permission-denied` | «Нет доступа к занятости» |
| reliability ≠ `known` | unknown fill (never a free/green background) |
| `segments[].classification` | group row: confirmed / possible / unknown / blocked |
| `suggestions[]` | «Подходящее время» buttons |
| `optionalConflicts` reason `busy` | «N необязательный участник занят» — slot stays selectable |
| `outsideWorkingHoursParticipants` | dashed band + «вне рабочего времени» |

Unknown/unsupported is never painted as free. That matches current remote reality:
self is local-derived; other Yandex participants are `unsupported` until a later
provider ticket.

## Privacy

Busy intervals are passed through `publicBusyIntervals()`, which copies only
`start` / `end` / `busyType`. The UI never renders foreign event title, description
or location. A fixture title such as `Secret board meeting` must not appear in
DOM text, `title` or `aria-label`. Tooltip for hard busy is always «Занят».

## Interaction and selection sync

- Click a candidate on the timeline or a suggested slot → `onSelectRange(start, end)`
  writes datetime-local into the editor. The event is **not** saved.
- Manual change of Start/End updates the translucent selection overlay and, after
  debounce, re-queries if duration or day changed.
- Required ↔ optional toggle is local UI state, then a new `planMeeting` call.
- Recurring events hide the assistant: time fields are disabled, and slot pick
  would not be writable without a recurrence rewrite.

Timezone shown in the assistant is the same IANA zone used to interpret
datetime-local (`Intl` in production, injected `timeZone` in tests). It is not
`event.tzid` (storage zone ≠ editor wall clock).

## Entry points

- **Create:** `CalendarPage` → `EventCreateModal` with `accountId`, `selfEmail`,
  `selfDisplayName`. Empty attendees and no self → «Добавьте участников…».
- **Edit:** `EventDetailModal` after «Изменить», hidden when `recurring`.
  Participants come from `parseCalendarParticipants` (`non-participant` skipped).

Month / Week / Day views are unchanged.

## Remote availability

CAL-110 supplies remote answers for Google and discovery-confirmed generic CalDAV. Unsupported
providers (including Yandex) still render as unknown. The UI must never imply they are free.

Working-hours UI is **PASS** for the CAL-109 contract: no fake working hours; if the
engine supplies `workingHoursApplied` / `outsideWorkingHoursParticipants`, the UI
can represent them (dashed band + legend «Вне рабочего времени»). Live smoke had
**no configured working-hours fixture**, so no 09:00–18:00 band was drawn.

## Live smoke (2026-08-22, Asia/Bangkok)

Read-only `npm run tauri -- dev`. Cloud mutations: **NONE**. Unsigned window: Computer Use
allowlist does not drive the app; smoke used PrintWindow + UIA.

| Check | Result |
| --- | --- |
| Create assistant | PASS |
| Edit assistant (non-recurring) | PASS |
| Slot selection | PASS — start/end changed, duration preserved, no auto-save |
| Editor sync | PASS — datetime change updated timeline/suggestions without reload |
| Unknown remote participant | PASS — «Нет данных о занятости», not painted free |
| Privacy | PASS — availability semantics only on foreign rows |
| Working hours UI | PASS — engine mapping only; no live WH fixture |
| Responsive | PASS — usable at ~720px; local timeline scroll; no page-level overflow blocker |
| Month | PASS |
| Week | PASS |
| Day | PASS |
| cargo check | PASS after releasing `cef-runtime` lock |

Recurring edit: assistant remains **not** wired (`EventDetailModal` hides it when
`is_recurrence_master === 1 || occurrence_key !== null`). That is documented future
scope, not a CAL-109 live failure. No confirmed recurring fixture was required to
close this ticket.
