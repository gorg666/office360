# design-lab

Design review surface. **Not part of any production bundle.**

`vite.config.ts` lists only `index.html` and `splashscreen.html` as rollup inputs,
and `tsconfig.json` includes only `src`, so nothing here is compiled into `dist/`
or typechecked by `tsc`. Verified: `dist/` contains no `styleguide*` output.

## Contents

| File | What it is |
|------|------------|
| `styleguide.html` + `styleguide.tsx` | Live styleguide rendering the real `src/components/ui/*` primitives against the real token layer, with a light/dark switch. |
| `logo/office360-a-clean.svg` | Mark, variant **A — Clean**. Flat master: 16 px, monochrome, tray, favicon, print/export, and any surface where material effects do not read. |
| `logo/office360-b-glass.svg` | Mark, variant **B — Glass**. The app icon. |
| `logo/logo-final-ab.html` | A/B comparison at 16/32/64/128/256/512 on light and dark, plus 16/20 px in titlebar chrome. |

## Running the styleguide

```bash
npm run dev
```

Then open `/design-lab/styleguide.html` on the dev server's port.

The logo sheet is a plain file — open `logo/logo-final-ab.html` directly.

## Logo status

Both variants are refinements of the **existing** Office360 mark, not a new symbol.
Silhouette, the internal ogee division and the blue/violet palette were measured
off `src/assets/logo_office_360.png`; what changed is geometric precision
(continuous-curvature corners in place of circular ones, a trued vertical tail),
balance, and the gradient ramp.

**Production logo and icon assets have not been replaced.** `src/assets/*` and
`src-tauri/icons/**` are untouched pending sign-off on the comparison sheet.
