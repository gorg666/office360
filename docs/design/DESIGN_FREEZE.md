# Office360 Design System — FROZEN

```
Office360 Design System: APPROVED
DESIGN-001B: APPROVED
DESIGN-001C: APPROVED
DESIGN-001D: APPROVED
DESIGN-002:  APPROVED
Design branch: feat/design-001
Approved HEAD: a1d9464
```

Approved 2026-08-27. The visual result at `a1d9464` is the reference state.

## What is frozen

| Stage | Scope | Reference |
|---|---|---|
| DESIGN-001B | Tokens, materials, primitives, app shell | `src/styles/tokens.css`, `src/styles/materials.css` |
| DESIGN-001C | Calendar | [OFFICE360_CALENDAR_DESIGN.md](OFFICE360_CALENDAR_DESIGN.md) |
| DESIGN-001D | Mail + shared UI | [OFFICE360_MAIL_DESIGN.md](OFFICE360_MAIL_DESIGN.md) |
| DESIGN-002 | Production logo/icon assets | [../../design-lab/README.md](../../design-lab/README.md) |

Commits: `9202a79` → `8ec0ca2` → `4cabafb` → `363c74a` → `a1d9464`.

## What is no longer allowed

- New visual concepts
- New redesign stages
- Additional glass experiments
- Logo changes
- Polish for its own sake

## What is still allowed

- Bug fixes
- Regression fixes
- Accessibility fixes
- Integration fixes
- Whatever merge, build or CI requires

## Working inside the freeze

The design decisions are recorded in the two design documents above; read them
before changing anything visual, because most of what looks like an arbitrary
value is a decision with a reason attached.

Load-bearing invariants — breaking one of these is a regression, not a tweak:

- **Chrome is glass, data is solid.** Reading pane, message list body, calendar
  time grid, month cells, long forms and tables stay opaque. Glass belongs to
  toolbars, sidebars, popovers, menus and dialogs.
- **Never nest glass in glass**, and never put a translucent fill on a surface
  without its matching `backdrop-filter`.
- **No lift on list rows.** Hover changes background only. `unreadVisual.test.ts`
  asserts that no row state produces `translate`, `shadow` or `scale`.
- **Calendar event text clears 4.5:1 against its own fill.** Enforced in
  `src/constants/calendarColors.ts` and covered by tests, including hostile
  provider colours.
- **One focus contract.** `.focus-ring` / `.focus-ring-inset`, keyboard-only,
  never a bare border-colour change.
- **`prefers-reduced-transparency`, `prefers-contrast` and reduced motion are
  supported.** Materials collapse to opaque; motion drops to near-zero.
- **Type floor is 11px** (`--text-caption`). Nothing smaller.

## Icon variant policy

| Size | Variant |
|---|---|
| ≤ 32 px | A — Clean (flat) |
| ≥ 40 px | B — Glass (app icon) |
| monochrome / stencil / print | A Mono |

Masters live in `design-lab/logo/`. Production assets are rendered from them;
the mapping and the regeneration method are in `design-lab/README.md`.

`A Mono` has no production consumer today: the tray reuses
`default_window_icon()` in `src-tauri/src/lib.rs`, so wiring it up would be a
code change.

## Known gaps carried past the freeze

Recorded so they are not rediscovered as surprises. None of these block the
freeze; all are outside the frozen visual contract.

- `npm run smoke:desktop` is macOS-only, so the packaged WebView2 smoke has
  never been run on the Windows host. Remains a manual step.
- `src-tauri/icons/android/**` and `ios/**` still carry the previous mark. They
  are not in `bundle.icon`, the product is desktop-only, and adaptive-icon safe
  zones need their own pass.
- `landing/public/logo.svg` is still the legacy VELO bird. The landing site is a
  separate Vite project outside the audited paths.
- `src/assets/vfyvfyfy44.mp3` has zero references — a cleanup candidate, not a
  design concern.
- The i18n audit reports 3 pre-existing candidates; that is the baseline, not a
  regression introduced by these stages.
