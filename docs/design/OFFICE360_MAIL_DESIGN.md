# Office360 Mail — visual design

> **FROZEN.** Approved at `feat/design-001` @ `a1d9464` — see
> [DESIGN_FREEZE.md](DESIGN_FREEZE.md). Bug, regression, accessibility and
> integration fixes only; no new visual work.

DESIGN-001D. Visual only. Nothing here changes SMTP, IMAP, mail sync, iTIP,
provider adapters, the Calendar domain, DB/schema, migrations, Tauri/Rust code,
auth/token semantics, or send/draft/autosave behaviour. Cloud mutations: NONE.

Builds on DESIGN-001B (`src/styles/tokens.css`, `src/styles/materials.css`) and
follows the same rule established in DESIGN-001C.

---

## 1. The rule, again

**Chrome and floating surfaces are glass. Content and long-form data are solid.**

| Region | Material |
|---|---|
| Mail toolbar (`ActionBar`), list header, `CategoryTabs`, composer editor toolbar | `.material-subtle` |
| Context menus, `TemplatePicker`, `AskInbox` results, toasts | `.material-elevated` |
| Composer, `MoveToFolderDialog`, `CommandPalette` | `.material-modal` |
| **Message list body, ReadingPane, message bodies** | **opaque `.surface-solid`** |

The ReadingPane became opaque in DESIGN-001B and stays that way. There is no
blur under an email body — the HTML in there is third-party and unpredictable,
and translucency over it costs contrast for nothing.

---

## 2. Message list

### The row state model

Row presentation used to live inline in `ThreadCard`, alongside a test file that
re-declared the same rules ("helpers mirroring ThreadCard's rules"). A mirror
test can pass while the component says something else, so the model moved into
`src/components/email/threadRowVisual.ts` — a pure module that `ThreadCard`
imports and the tests actually assert against.

Precedence, highest first: **dragging → multi-selected → selected → unread → read**.
Spam is an independent overlay, so a thread can be spam in any of those states.

| State | Before | Now |
|---|---|---|
| Selected | `bg-bg-selected` — a flat grey wash | brand tint + a 3px left marker, text emphasised |
| Unread | `bg-accent/[0.04]` — 4% of a grey accent, i.e. invisible | visible brand tint, semibold sender and subject, brand dot |
| Hover | `hover-lift`: `translateY(-1px)` + shadow | background only |
| Read | grey-on-grey | `ink-secondary`, normal weight |
| Spam | `bg-red-500/8` hardcoded | `bg-danger-surface` token, layered over the base state |

The left marker is drawn with `::before`, so it needs no extra element and cannot
disturb the row's flex layout.

### No lift

`hover-lift` translated every row by 1px and added a shadow on hover. In a dense
desktop list that reads as jitter and forces a repaint per row. It is gone, and
a test asserts that **no** row state in any combination produces `translate`,
`shadow` or `scale`.

### Density

`densityPadding()` reuses `EmailDensity` from the store rather than redeclaring
it — a local copy would drift the moment a density is added or renamed. Compact
is genuinely compact (`py-1.5`); normal tightened from `py-3` to `py-2.5`.

### Long content

Sender, subject and snippet each truncate to a single line, so an
over-long value cannot change the row height or wrap the list. Verified in the
runtime smoke with a deliberately hostile fixture.

---

## 3. Banners

All security surfaces now go through one `Banner` contract with four tones —
info, warning, danger, success. `SecurityWarningBanner` became a thin mapping:
severity → tone, kind → icon, actions → buttons.

Security semantics are unchanged: the same severity logic, the same titles, the
same action list, the same handlers. What changed is that every tone is a
**tinted surface with dark text** instead of hand-rolled
`border-danger/30 bg-danger/10 text-danger` triples that each differed slightly.

`Banner` gained a `trailing` slot so `PhishingBanner` can keep its
"Trust this sender" affordance at the trailing edge.

---

## 4. Composer

- Panel on `.material-modal` with `--radius-panel`; the overlay moved off the
  ad-hoc `z-50` onto `z-modal` from the layer scale.
- Editor toolbar on `.material-subtle`.
- Footer on `.surface-sunken` with a matching bottom radius.
- The drag-and-drop target reads as a real drop zone (brand tint plus a ring)
  rather than a faint wash.
- Address fields use the DESIGN-001C `PeoplePicker` language.

Send, draft and autosave behaviour is untouched.

---

## 5. Attachments

- One radius (`--radius-control` for list rows, `--radius-card` for grid tiles)
  and one border token.
- Hover actions on grid tiles were `opacity-0 → group-hover`, which made them
  unreachable by keyboard. They now also appear on `focus-within`, and they sit
  in an absolutely positioned layer so revealing them **cannot shift layout**.
- File name, sender and size use the caption/meta scale instead of three
  different arbitrary sizes.
- Destructive actions use `danger-surface` / `danger-text`, consistently with
  every other destructive control.

---

## 6. Focus

The mail surfaces gained the shared focus treatment. One defect was found and
fixed while checking it: `.focus-ring-inset` defined only its `:focus-visible`
rule and never reset the base outline the way `.focus-ring` does, so controls
using it fell through to the UA default outline in some states. Both classes now
spell the same contract.

Rows use `focus-ring-inset` because they sit flush against the list edge and
cannot afford an outward ring.

---

## 7. Verification

| Gate | Result |
|---|---|
| `tsc` + `vite build` | pass |
| Full Vitest | 271 files / 2608 tests pass |
| Mail + shared UI targeted | 31 files / 257 tests pass |
| Calendar regression | 37 files / 259 tests pass |
| PeoplePicker regression | pass |
| TZ matrix | pass |
| `cargo check` | pass (2 pre-existing warnings; no Rust touched) |
| i18n audit | at pre-change baseline |

### Runtime visual smoke

`design-lab/mail.html` (dev-only) drives the real `ThreadCard`,
`SecurityWarningBanner`, `Banner`, skeletons and `PeoplePicker` against
fixtures, because the browser preview of the app has no Tauri/SQLite backend and
so never loads an inbox.

Covered: message list with unread / selected / read / long-content rows, loading
skeleton, all four banner tones with actions and dismiss, To/Cc/Bcc recipients,
light, dark, narrow desktop, and keyboard focus (verified as a real
`:focus-visible` brand ring via Tab, not a programmatic `.focus()`).

**Not covered:** no Send was performed, by instruction. The packaged WebView2
smoke remains manual — `npm run smoke:desktop` is macOS-only and cannot run on
this Windows host. `ReadingPane` and `Composer` were migrated and are covered by
their unit tests, but were exercised in the harness only through their
constituent parts, not as full assembled screens with live message data.
