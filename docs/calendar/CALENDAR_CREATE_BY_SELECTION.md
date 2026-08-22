# CAL-117 — Create by grid selection

Create an event from the calendar grid through the existing `EventCreateModal`. There is no second create flow and no extra provider write service.

Drafts are local until the user presses **Create**. **Cancel** drops the selection, creates no local event, and writes nothing to the cloud.

## Day / Week timed grid

Empty overlay surface only. Pointer-down on an existing timed event stays CAL-113 (click / drag / resize).

| Gesture | Draft |
|---|---|
| Click empty time | Snap to 15 minutes, then **60-minute** default duration (`DEFAULT_TIMED_DURATION_MINUTES`, same source as CAL-114). |
| Drag empty time | Snap both edges, reverse-safe, clamp to **15-minute** minimum. Short drags are not converted to clicks. |
| Week column | Timed selection is locked to the **origin day**. Crossing into a neighbor column does not create a multi-day timed event. |
| Preview | `timed-create-preview` uses `minutesToY` / the same hour axis as CAL-113. |

Threshold: **6 px** (`DRAG_THRESHOLD_PX`). Movement below that is a click.

Pointer-drag on empty timed grid is create-selection, not pan-scroll. Wheel / trackpad scroll is unchanged. Auto-scroll during selection is not implemented.

## Month

Empty day-cell click (including padding around cards) opens an **all-day** draft for `data-calendar-date` of that cell.

Spillover cells from the previous / next month use the cell’s actual date, not the visible month number.

| Must not create |
|---|
| Event card click (details) |
| Overflow `+N` (`data-testid="month-overflow"`) |
| Month event drag (CAL-114) |

Toolbar **Создать** stays the timed next-hour default. Month empty-cell create is all-day by product convention.

Keyboard: the day-number control (`data-testid="month-create-day"`) is a single focusable create button per cell when create is allowed.

## All-day row

Click on empty all-day cell → single-day all-day draft (`startDate` + exclusive `endDate`).

Existing all-day event click / drag stays CAL-114 (`stopPropagation` on the event button).

**Not in CAL-117:** multi-day all-day drag-selection (`Wednesday → Friday`). Click-only so CAL-114 event drag is not rewritten. Keyboard: visually hidden `allday-create-*` control per cell.

## Snap and duration

Shared constants from CAL-113 / CAL-114:

- Snap: 15 minutes
- Minimum drag duration: 15 minutes (never zero-length)
- Click default timed duration: 60 minutes
- Reverse drag `11:30 → 10:00` → `10:00–11:30`

## Timezone / DST

Timed drafts use Calendar display timezone via CAL-102 helpers (`zonedWallDateTimeToInstant`, `instantSecondsToWallDateTime`). Grid selection does not use `new Date(cellDate + …)` in the host zone for domain `time`.

DST gap policy is existing shift-forward. After resolve, wall time is converted back so the modal never shows an impossible local time. The visual hour axis remains 24 equal civil hours; a gap slot that still exists visually is shift-forwarded, not rejected by inventing a second axis.

Grid drafts are standard **timed-zoned** (display TZ) or **all-day**. No new floating default.

`EventCreateModal` datetime-local widgets remain host widgets; submit rebuilds domain `time` from form fields + `timeZone`. All-day fields are `type="date"` and must not be validated with `new Date("YYYY-MM-DD")`.

## Read-only

Create is capability-driven: `events.create === "remote"`. Otherwise click/drag create is disabled and the modal is not opened.

## Keyboard / ARIA

- Timed overlay: one tab stop (`role="grid"`), arrow keys move the focused slot by snap / day, Enter / Space opens a click draft. No keyboard drag-selection.
- Aria example: `Создать событие 27 августа в 14:30`.
- Toolbar **Создать** remains available.

## Interaction boundaries

| Surface | Create | Existing event |
|---|---|---|
| Day / Week timed overlay | Empty click / drag | CAL-113 click / drag / resize |
| All-day row | Empty click | CAL-114 click / drag |
| Month | Empty cell / day number | CAL-114 click / drag; overflow ignored |

## Save path

`CalendarPage.handleGridCreate` → `toEventCreateInput` → `EventCreateModal` → existing `calendarMutationService.create` with `isAllDay` and `time`. No new write service.

## Tests

- `createSelection/draft.test.ts` (also in `npm run test:calendar-tz`)
- `TimedGridOverlay.test.tsx` create suite
- `MonthView.test.tsx` create suite
- `AllDayLane.test.tsx` create suite
- `EventCreateModal.test.tsx` all-day hydrate / Cancel
- `CalendarPage.createSelection.test.tsx` modal + Cancel, no mutation

Live Tauri smoke, if a session exists: open modal from grid and **Cancel**. Do not create a real Yandex cloud event without a separate permission.

## Known limitations

1. All-day multi-day drag-selection is not implemented (click-only).
2. No keyboard drag-selection; keyboard is slot/cell + Enter, plus toolbar create.
3. No auto-scroll during selection.
4. Month empty click is all-day; toolbar create remains timed next-hour.
5. EventCreateModal datetime-local is still a host widget; domain `time` on submit is the TZ-correct path.
6. The hour axis is 24 equal civil hours; DST gap slots still exist visually and resolve via shift-forward.
