# Office360 Calendar — visual design

> **FROZEN.** Approved at `feat/design-001` @ `a1d9464` — see
> [DESIGN_FREEZE.md](DESIGN_FREEZE.md). Bug, regression, accessibility and
> integration fixes only; no new visual work.

DESIGN-001C. This describes how the Calendar *looks* and why. It is a visual
document: it changes nothing about the calendar domain, recurrence, free/busy,
scheduling logic, sync, DB, migrations, providers, iTIP, ACL semantics, reminder
runtime, or cloud behaviour.

It builds on the foundation from DESIGN-001B — see `src/styles/tokens.css` and
`src/styles/materials.css`.

---

## 1. The one rule

**Chrome is glass. Data is solid.**

| Region | Material |
|---|---|
| Toolbar, day header, all-day lane | `.material-subtle` |
| Search results, month overflow, reminder toasts | `.material-elevated` |
| Create / detail / ACL dialogs | `.material-modal` |
| **Time grid, month cells, event chips** | **opaque — `.surface-solid`** |

`src/styles/calendar.css` contains no `backdrop-filter` at all. A blur under
hour lines and event text destroys exactly the readability the grid exists to
provide. Translucency here would be decoration bought with legibility.

---

## 2. Grid hierarchy

Before this pass every line in the grid — day boundaries, hour lines, half-hour
marks — was drawn with the same `rgba(0,0,0,0.04)`. At 4% on a light pane they
were nearly invisible, and because they were identical the eye had no way to
parse the grid's structure.

Now there are three deliberately different weights, defined once in
`calendar.css`:

| Token | Light | Dark | Purpose |
|---|---|---|---|
| `--cal-day-line` | `rgba(0,0,0,.14)` | `rgba(255,255,255,.16)` | between day columns — strongest, so the week reads as seven columns first |
| `--cal-hour-line` | `rgba(0,0,0,.09)` | `rgba(255,255,255,.10)` | on the hour |
| `--cal-half-line` | `rgba(0,0,0,.045)` | `rgba(255,255,255,.05)` | on the half hour — a hint, not a rule |

Plus two washes:

- `--cal-offhours` — hours outside 08:00–20:00 recede (`workingHours.ts`).
  Purely presentational; it does not touch availability or event placement.
- `--cal-today-wash` — today's column and today's month cell.

The half-hour mark is **painted** (a background gradient on the hour cell), not
added as an extra element, so the row count — and therefore the grid geometry
that drag/resize maths depends on — is unchanged.

### Not changed

Hour heights (`WEEK_HOUR_HEIGHT_PX`, `DAY_HOUR_HEIGHT_PX`), column maths,
`timedGrid/geometry.ts`, `overlapLayout.ts`, hit-testing, drag/resize thresholds
and snapping. The DnD and geometry test suites pass unmodified.

---

## 3. Event colours

Previously **every** event rendered as `bg-accent/10 text-accent`. Events from
different calendars were indistinguishable, and since the accent was grey, the
whole calendar was grey.

`src/constants/calendarColors.ts` maps a calendar to a rendering set:

```
calendar -> { marker, fill, border, text }
```

- **Source.** The provider colour (`calendars.color`) when present. Otherwise a
  stable hue chosen by hashing the calendar id, so the same calendar looks the
  same across sessions and machines.
- **Materials differ by theme.** A 14% tint that reads as "tinted white" on a
  light pane is invisible on a dark one, so dark uses a 26% fill and light text.
- **Contrast is enforced, not assumed.** `text` is pushed toward black (light) or
  white (dark) until it clears **4.5:1 against its own fill**. This is what makes
  an arbitrary provider-supplied colour safe to put text on. It is unit tested
  across the full fallback palette *and* against hostile inputs (`#ffffff`,
  `#000000`, `#ffff00`, `#00ffff`, mid-grey) in both themes.

The module is pure — no React, no DB, no I/O — which is why the guarantee is
testable rather than aspirational.

### Delivery

`CalendarColorProvider` (a React context) supplies the resolver to the grid.
A context rather than props: the resolver is needed by `EventCard`, the timed
grid overlay and the all-day lane, and threading it through Month/Week/Day would
mean editing behaviour signatures on six components for a purely visual concern.
Rendering a view without the provider is supported and falls back to the brand
colour, so existing view tests run unchanged.

### Event chip

Tinted fill, a 3px marker bar on the leading edge in the calendar's own colour,
`--radius-tight`, caption text in the contrast-checked ink. No glass inside the
grid. Selected state is a focus-coloured ring; drag reduces opacity.

---

## 4. Current time

The indicator was a red dot and a hairline with no time on it. It now carries a
label formatted through `Intl` in the UI locale.

The label sits **inside today's own column**, not in the hour gutter. The
indicator spans one column, so a gutter-side label lands on the previous day for
any day except the first — that was a real defect caught during the visual
smoke, not a hypothetical.

---

## 5. Locale

The hour gutter used to be built from a hardcoded expression:

```ts
`${hour % 12 || 12}${hour < 12 ? "am" : "pm"}`
```

so the Russian UI showed `1am / 2pm`. It now goes through
`hourGutterLabel(hour, locale)` in `weekLocale.ts`, which uses `Intl` — 24-hour
in RU, 12-hour in EN. Existing formatting infrastructure, not a new formatter.
Covered by tests asserting no `am`/`pm` appears anywhere in the RU gutter.

---

## 6. Controls

| Surface | Now |
|---|---|
| Prev / Today / Next | `<Button>` — ghost, secondary, ghost |
| Month / Week / Day | `<SegmentedControl>` (the toolbar previously hand-rolled one) |
| Create | `<Button variant="primary">` |
| Calendar list toggle | `<Button>`, `subtle` when open |
| Search field, recurrence, reminders, participants, ACL fields | shared field treatment: `--radius-control`, `--color-outline`, real focus ring |
| `+N ещё` | chip-shaped control instead of bare tertiary text |

Every one of these gained a `:focus-visible` ring. The calendar previously used
`focus:border-accent` in most places, which only recoloured a 1px border and made
no distinction between clicking into a control and tabbing to it.

---

## 7. PeoplePicker

Three levels of hierarchy in each result, which the spec asked for and the old
row did not have (name, email and job title were all the same size and colour):

```
Имя Фамилия          meta / medium / ink-primary
email@example.com    caption / ink-secondary
Должность · Отдел    caption / ink-tertiary
```

- **Keyboard-active ≠ hover.** The active option gets a brand tint plus a left
  marker bar; hover only changes the background. Previously both were
  `bg-bg-hover` and therefore indistinguishable while arrowing through results.
- Avatars fall back to initials on a stable per-person hue rather than one grey.
- Chips are compact, carry a 16px avatar, and reveal their remove control on
  hover or keyboard focus.
- The dropdown is `.material-elevated` and materialises rather than appearing.

PEOPLE-001 business logic — search, debounce, manual-email handling, directory
fallbacks, keyboard semantics — is untouched.

---

## 8. Preserved behaviour

Explicitly verified as unchanged by the existing suites:

- focus trap and focus restore in every dialog
- recurrence editing and scope dialogs
- participants and RSVP
- reminders
- Scheduling Assistant
- ACL semantics
- narrow-desktop layout
- month overflow keyboard handling and event-open behaviour

---

## 9. Verification

| Gate | Result |
|---|---|
| `tsc` + `vite build` | pass |
| Calendar targeted tests | 36 files / 246 tests pass |
| Full Vitest | 269 files / 2600 tests pass |
| TZ matrix (UTC, Europe/Moscow, America/New_York, Australia/Lord_Howe) | pass |
| Calendar migrations v34–v39 | pass |
| `cargo check` | pass (2 pre-existing warnings, no Rust touched) |
| i18n audit | at pre-change baseline |

Cloud mutations: **NONE**.

### Runtime visual smoke

Run against the real components via `design-lab/calendar.html` (dev-only). The
browser preview of the full app cannot load calendar data — there is no Tauri
SQLite backend — so the harness feeds fixture events through the production
Month/Week/Day views, toolbar, modals and PeoplePicker.

Covered: Month, Week, Day, light, dark, narrow desktop, create modal, detail
modal, PeoplePicker with keyboard navigation, Scheduling Assistant (inside the
create modal), `+N` overflow popover.

**Not covered:** `npm run smoke:desktop` is macOS-only (it targets
`/Applications/Office360.app`) and cannot run on this Windows host. The packaged
WebView2 smoke remains a manual step, consistent with the note already in
`.ai/CURRENT_STATE.md`. ACL dialog and the reminder centre were migrated and are
covered by their unit tests, but were not exercised in the runtime smoke.
