# design-lab

Design review surface. **Not part of any production bundle.**

`vite.config.ts` lists only `index.html` and `splashscreen.html` as rollup inputs,
and `tsconfig.json` includes only `src`, so nothing here is compiled into `dist/`
or typechecked by `tsc`. Verified: `dist/` contains no `styleguide*` output.

## Contents

| File | What it is |
|------|------------|
| `styleguide.html` + `styleguide.tsx` | Live styleguide rendering the real `src/components/ui/*` primitives against the real token layer, with a light/dark switch. |
| `calendar.html` + `calendar.tsx` | Calendar visual smoke: the real Month/Week/Day views, toolbar, create/detail modals and PeoplePicker driven by fixture events. The browser preview of the full app cannot load calendar data (no Tauri SQLite), so this is how the grid, per-calendar colours and current-time indicator get reviewed. |
| `mail.html` + `mail.tsx` | Mail visual smoke: the real ThreadCard, security banners, skeletons and PeoplePicker driven by fixture threads, including a deliberately hostile long-content row. |
| `logo/office360-a-clean.svg` | Mark, variant **A — Clean**. Flat master: 16 px, monochrome, tray, favicon, print/export, and any surface where material effects do not read. |
| `logo/office360-b-glass.svg` | Mark, variant **B — Glass**. The app icon. |
| `logo/office360-a-mono.svg` | Flat monochrome master of A, in `currentColor`. The container carries the light value and the darker plane prints over it at full strength, so the internal division survives in a single ink. For tray, favicon, print and stencil contexts. |
| `logo/logo-final-ab.html` | Final review sheet: A/B at 16/32/64/128/256/512 on light and dark, the monochrome ramp, the material detail, and 16/20 px in titlebar chrome. |

## Running the styleguide

```bash
npm run dev
```

Then open `/design-lab/styleguide.html`, `/design-lab/calendar.html` or
`/design-lab/mail.html` on the dev server's port.

The logo sheet is a plain file — open `logo/logo-final-ab.html` directly.

## Logo status

Both variants are refinements of the **existing** Office360 mark, not a new symbol.
Silhouette, the internal ogee division and the blue/violet palette were measured
off `src/assets/logo_office_360.png`; what changed is geometric precision
(continuous-curvature corners in place of circular ones, a trued vertical tail),
balance, and the gradient ramp.

**Production logo and icon assets have not been replaced.** `src/assets/*` and
`src-tauri/icons/**` are untouched pending sign-off on the comparison sheet.

## Production icon mapping (DESIGN-002)

Production assets are rendered from the masters above. The split follows how the
mark actually behaves: B's material stops being resolvable below roughly 32 px,
so small sizes get the flat A.

| Target | Variant |
|--------|---------|
| `src-tauri/icons/32x32.png`, `Square30x30Logo.png` | A |
| `src-tauri/icons/64x64.png`, `128x128.png`, `128x128@2x.png`, `icon.png` | B |
| `Square44x44` … `Square310x310`, `StoreLogo.png` | B |
| `icon.ico` | A at 16/20/24/32, B at 48/64/128/256 |
| `icon.icns` | A at 16/32, B at 64…1024 |
| `src/assets/logo_office_360.png` (titlebar, 20 px) | A, rendered at 128 |
| `src/assets/icon.png` (About panel, 44 px) | B, rendered at 256 |
| `public/logo_office_360.png` (splash, 180 px) | B, rendered at 512 |

`icon.ico` and `icon.icns` are written by hand rather than by a converter,
because a single-image writer cannot carry *different* artwork per size — which
is the entire point of the split. Both were validated by decoding every entry
back, and by confirming `tauri-build` embeds the new `.ico` into `resource.lib`
as resource `32512 ICON`.

Rasterisation went through the browser's own SVG renderer (canvas `drawImage` at
each exact pixel size), since this host has no ImageMagick, cairosvg or sharp.

`A Mono` has no production consumer today: the system tray reuses
`default_window_icon()` in `src-tauri/src/lib.rs`, so pointing the tray at a
dedicated monochrome asset would be a code change. It ships as a master for
print, stencil and any future tray work.
