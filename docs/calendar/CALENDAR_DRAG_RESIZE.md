# CAL-113 — Event drag and resize

Day/Week timed-grid pointer mutations. Canonical interaction contract for Office 360 Calendar.

## Interaction model

Timed events in Day and Week are positioned by `TimedGridOverlay` on the existing hour axis. The overlay does not replace Month/Week/Day chrome, all-day rows, or hour headers.

| Gesture | Result |
|---|---|
| Drag body | Move start and end by the same snapped wall-clock delta. Duration is preserved. |
| Resize top | Change start only. |
| Resize bottom | Change end only. |
| Click / tiny move | Opens event details. Does not mutate. |
| Recurring occurrence drop/resize | Existing CAL-112 scope dialog (`Только это событие` / `Всю серию`). No write until Save. Cancel restores the original position. |

Month drag/drop, all-day row drag, timed ↔ all-day conversion, and keyboard Event Edit shipped under **CAL-114** (`CALENDAR_MONTH_ALLDAY_INTERACTIONS.md`). Create-by-empty-slot selection shipped under **CAL-117** (`CALENDAR_CREATE_BY_SELECTION.md`). Edge auto-scroll is still not implemented.

## Snap

One policy for every view and handle:

- Snap: **15 minutes** (`SNAP_MINUTES`)
- Minimum duration: **15 minutes** (`MIN_DURATION_MINUTES`)
- Drag threshold: **6 px** (`DRAG_THRESHOLD_PX`)
- Day hour height: 56 px (`h-14`)
- Week hour height: 48 px (`h-12`)

Pointer deltas are converted through the hour axis, then snapped once in `timedEventMutation`. Components must not invent a second snap.

A duration below 15 minutes is clamped (resize) or rejected (if clamp cannot apply). `end <= start` cannot be committed.

## Drag preview

While the pointer is down past the threshold, the overlay shows a floating preview with the new wall-clock range and geometry. The original block stays mounted (faded) so pointer capture is not lost on a cross-day remount.

Remote writes are **not** sent on `pointermove`. `CalendarMutationService.update` runs once on drop / resize end.

## Mutation flow

```text
pointer drop
  → visual override + pending lock
  → if occurrence: RecurrenceScopeDialog
  → CalendarMutationService.update
  → provider
  → sync/reconcile (`calendarSyncService.loadRange`)
  → UI
```

Forbidden:

- React → SQLite
- React → provider
- React → manual cache patch

## Optimistic UX and rollback

After drop the event may render at the new unix range via `visualOverrides`. If the write fails, the override is cleared and the event returns to the cached position.

| Failure | Copy |
|---|---|
| `conflict` | Событие было изменено в другом месте. Обновите календарь и попробуйте снова. |
| other typed failures | Same as CAL-112 `writeFailureCopy` |

While a write is in flight, that event cannot be dragged or resized again (`pendingEventIds` + in-flight set).

## Read-only / capabilities

Drag and resize require `capabilities.events.update === "remote"` and CAL-112 `canMutateRecurring`. All-day and cancelled events are not interactive. Gating is capability-driven, not provider-name-driven.

## Recurrence

- Occurrence drop/resize → scope dialog. `this-and-future` stays hidden under current capabilities.
- `single` → `scope=single` plus canonical `occurrenceKey`. Series identity is unchanged.
- `series` → one `scope=series` write. Occurrences are not moved one-by-one.
- Cancel → no mutation, override removed.

## Timezone / DST

Grid geometry uses the host-local hour axis for pointer math. Committed times use CAL-102 wall-clock helpers (`addWallSeconds`, `zonedWallDateTimeToInstant`). Floating events stay floating.

A +60 wall-clock-minute drag is not `unix + 3600` when a DST gap or 30-minute spring-forward changes elapsed time. Covered for `America/New_York` and `Australia/Lord_Howe` in `timedEventMutation.test.ts` and `npm run test:calendar-tz`.

## Overlap layout

After a committed move/resize, `packOverlappingEvents` runs on the overlay’s current unix ranges (including visual overrides). Geometry is not cached across gestures.

## Accessibility

Event blocks remain keyboard-activatable buttons (click/details). Resize handles are pointer-only `aria-hidden` divs; they must not steal event keyboard focus. Keyboard move/resize uses Event Edit (`Начало` / `Окончание`) — see CAL-114.

## Known limitations

1. Create-by-empty-slot selection shipped under CAL-117 (`CALENDAR_CREATE_BY_SELECTION.md`).
2. Edge auto-scroll is not implemented (Month auto-scroll is not required).
3. No keyboard resize handle; Event Edit is the accessibility equivalent (CAL-114).
4. Touch is not a CAL-113/114 acceptance target.
5. Live Tauri / cloud writes are not part of this ticket’s proof; automated mutation tests are the write path evidence.
