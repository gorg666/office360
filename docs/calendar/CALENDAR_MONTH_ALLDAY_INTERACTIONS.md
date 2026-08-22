# CAL-114 — Month and all-day interactions

Pointer mutations for Month cells, Week/Day all-day rows, and timed ↔ all-day conversion. Canonical follow-up to `CALENDAR_DRAG_RESIZE.md` (CAL-113). Writes still go only through `CalendarMutationService` via the shared CalendarPage pending-commit path. There is no second mutation stack.

## Interaction model

| Gesture | Result |
|---|---|
| Month timed card → another date | Calendar-date shift. Wall-clock start/end and duration are preserved. The event stays timed; it is not converted to all-day. |
| Month all-day card → another date | Stays all-day. Exclusive `endDate` span is shifted by the same number of calendar days. |
| Month multi-day span | The whole span moves by the delta from the **grabbed cell date** to the drop cell. Grabbing the start day of Aug 20–22 and dropping on Aug 25 yields Aug 25–27. Grabbing a middle day uses that day as origin. |
| Week/Day all-day row → another all-day day | Same all-day date-shift semantics. |
| Timed grid → all-day row | Explicit `timed → all-day`. Occupied calendar-day span is preserved. Drop date becomes the new start. No host-midnight hack. |
| All-day row → timed grid | Explicit `all-day → timed`. Start is snapped with the CAL-113 15-minute policy. Duration is **60 minutes** (`DEFAULT_TIMED_DURATION_MINUTES`). Multi-day all-day collapses to a single 60-minute timed slot. |
| Click / move under 6 px | Opens details. No mutation. |
| Recurring occurrence drop | CAL-112 scope dialog (`Только это событие` / `Всю серию`). No write until Save. Cancel restores the original date/type. |

Native HTML5 `draggable` is off. Gestures use pointer capture, same 6 px threshold as CAL-113.

Month auto-scroll is not required. Week all-day/timed edge auto-scroll is optional and is not implemented.

## Preview

- Month: ghost + target-date highlight (`data-testid=month-drag-preview`). Mutation runs on drop only.
- All-day / conversion: the preview label is `Весь день` or the snapped timed range so the user sees the type change before drop.
- Timed overlay converting to all-day also shows `data-testid=timed-convert-preview`. Resize over the all-day row does **not** convert.

## Mutation flow

```text
pointer drop
  → applyDateGridDraft (CAL-102 time)
  → visual override + pending lock
  → if occurrence: RecurrenceScopeDialog
  → CalendarMutationService.update
  → calendarSyncService.loadRange
  → layout recompute (Month packing / +N / spans)
```

Forbidden: React → SQLite, React → provider, React → manual cache patch.

Unchanged drafts (`deltaDays === 0`, same all-day range) do not call the service.

## Conversion policy

No product setting exists for default timed duration. CAL-114 uses a deterministic **60 minutes**, snapped to 15.

| Conversion | Domain |
|---|---|
| timed → all-day | `kind: "all-day"`, `startDate` = drop date, `endDateExclusive` = start + occupied span days. |
| all-day → timed | `kind` stays `floating` if the source was floating; otherwise `timed-zoned` with `event.tzid` or `UTC`. Start = snap(drop Y). End = start + 60 min. |

All-day never uses host-local midnight as a date. Month date moves use calendar-date arithmetic (`addCalendarDays` / `addWallSeconds` of whole days), so a New York 09:00 event that crosses a DST boundary stays 09:00 wall-clock. Floating stays floating.

## Recurrence and identity

Same as CAL-113/112:

- `single` → `scope=single` plus canonical `occurrenceKey` / RECURRENCE-ID. The UI does not create a standalone event.
- `series` → one `scope=series` write.
- `this-and-future` stays hidden under current capabilities.
- Cancel / network / conflict / permission: override removed, original Month position and time kind restored. Error copy is the CAL-113 `dragResizeFailureCopy` (`data-testid=timed-mutation-error`).

## Read-only

`canDragDateEvent` requires `events.update === "remote"`, CAL-112 recurring capability, and a non-cancelled event. All-day **is** allowed here (unlike timed-grid `canDragResizeTimedEvent`). Capability-driven, not provider-name-driven.

## Keyboard accessibility

CAL-114 does not emulate mouse DnD with the keyboard.

| Action | Equivalent |
|---|---|
| Open event | Event block is a focusable `button` with `aria-label` and visible focus. Enter/Space opens details. |
| Move date/time | Event Edit (`Изменить`) labeled `Начало` / `Окончание` (`datetime-local`). |
| Resize timed start/end | The same Event Edit fields. There is no keyboard resize handle. Pointer resize handles are `aria-hidden` so they do not steal focus. |

## Snap

All-day → timed reuses CAL-113 `SNAP_MINUTES = 15`. There is no second snap implementation.

## Layout

Month applies `visualOverrides` before `eventsByDay`, multi-day spans, and overflow `+N`. After a successful write the override is cleared and `loadRange` refreshes packing.

## Tests

- Domain: `src/components/calendar/dateGrid/dateShift.test.ts` (same-week / cross-week / cross-month, all-day span, conversions, floating, DST matrix zones).
- UI: `MonthView.test.tsx`, `AllDayLane.test.tsx`, overlay conversion in `timedGrid/TimedGridOverlay.test.tsx`.
- Page: `CalendarPage.dateGrid.test.tsx` (mutation once, scope dialog, cancel/network/conflict/permission rollback).
- A11y: Month keyboard focus + `EventDetailModal.a11y.test.tsx` (start/end via Event Edit).
- TZ: `dateShift.test.ts` is in `npm run test:calendar-tz`.

## Known limitations

1. Multi-day all-day → timed becomes one 60-minute timed slot, not a timed span covering every occupied day.
2. Month span delta is relative to the grabbed cell, not always the series start day.
3. No keyboard drag/resize handles; Event Edit is the accessibility equivalent for move and resize.
4. Month auto-scroll is not implemented; Week edge auto-scroll is not implemented.
5. Create-by-empty-slot selection remains CAL-117.
6. Live Tauri / cloud writes are not part of this ticket’s proof.
