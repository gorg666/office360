# SECURITY TRIAGE — npm audit (read-only) — 2026-08-11

**Project:** `velo-office360-api-ya-clean`  
**Branch:** `office360-mail-workflow`  
**HEAD:** `8f5b6ac`  
**Command:** `npm audit --json` (read-only)  
**Not done:** `npm audit fix`, dependency upgrades, code changes

## Summary

| Severity | Count |
|---|---|
| critical | 2 |
| high | 6 |
| moderate | 2 |
| low | 2 |
| **total** | **12** |

Source: npm audit metadata on this workspace (2026-08-11).

## Critical / High findings

### SEC-AUDIT-01 — `seroval` (critical)

| Field | Value |
|---|---|
| package | `seroval` |
| dependency path | `office360 > @tanstack/react-router > @tanstack/router-core > seroval` (+ via `seroval-plugins`) |
| severity | critical |
| advisory | [GHSA-mv8w-475r-vwqw](https://github.com/advisories/GHSA-mv8w-475r-vwqw) — `fromJSON()` Promise resolver type confusion |
| production/dev | **production** (transitive via `@tanstack/react-router`) |
| current version | `1.5.0` |
| fixed version | advisory: `>1.5.2` (confirm before upgrade) |
| likely reachable | **INVESTIGATE** — router uses seroval; exploitability depends on attacker-controlled deserialization inputs |
| release blocker | **INVESTIGATE** |

### SEC-AUDIT-02 — `vitest` (critical)

| Field | Value |
|---|---|
| package | `vitest` |
| dependency path | `office360 > vitest` (direct) |
| severity | critical |
| advisory | [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp) — Vitest UI server arbitrary file read/execute |
| production/dev | **dev** (`devDependency`; test runner) |
| current version | `4.0.18` |
| fixed version | advisory range fixed in `>=4.1.0` |
| likely reachable | **NO** for end-user Tauri production build if Vitest UI is not shipped/run in prod |
| release blocker | **NO** (dev-only; still patch before enabling Vitest UI on shared hosts) |

### SEC-AUDIT-03 — `vite` (high)

| Field | Value |
|---|---|
| package | `vite` |
| dependency path | direct + via `@tailwindcss/vite`, `@vitejs/plugin-react`, `vitest` |
| severity | high (rollup of several advisories; package severity high) |
| advisory | e.g. [GHSA-v2wj-q39q-566r](https://github.com/advisories/GHSA-v2wj-q39q-566r), [GHSA-p9ff-h696-f583](https://github.com/advisories/GHSA-p9ff-h696-f583) — fs.deny bypass / arbitrary file read via Vite Dev Server |
| production/dev | **dev tooling** for build/dev server; not a typical production runtime dependency of the packaged Tauri app |
| current version | `7.3.1` |
| fixed version | advisories cite fixes beyond `7.3.1` (verify latest `7.3.x+` before bump) |
| likely reachable | **YES** during local/CI `vite`/`tauri` **dev** with exposed server; **NO/UNKNOWN** for released packaged app without Vite middleware |
| release blocker | **INVESTIGATE** for shared-dev / CI exposure; usually **NO** for offline desktop release if only packaging artifacts |

### SEC-AUDIT-04 — `postcss` (high)

| Field | Value |
|---|---|
| package | `postcss` |
| dependency path | `office360 > vite > postcss` |
| severity | high |
| advisory | e.g. [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q), [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) — sourceMappingURL file disclosure |
| production/dev | **build/dev** (via Vite) |
| current version | `8.5.6` |
| fixed version | beyond advisory ranges (confirm `>8.5.17` / current fixed) |
| likely reachable | **YES** in malicious CSS processing during **dev/build**; **NO** typical for packaged runtime |
| release blocker | **NO** for packaged app; patch in dependency hygiene pass |

### SEC-AUDIT-05 — `picomatch` (high)

| Field | Value |
|---|---|
| package | `picomatch` |
| dependency path | via `vite` / `vitest` (`fdir`, `tinyglobby`) |
| severity | high |
| advisory | [GHSA-c2c7-rcm5-vvqj](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj) ReDoS; also method injection advisory |
| production/dev | **dev/build** |
| current version | `4.0.3` |
| fixed version | `>=4.0.4` |
| likely reachable | **UNKNOWN/low** for end users; **YES** for tooling that feeds untrusted globs |
| release blocker | **NO** |

### SEC-AUDIT-06 — `nanoid` (high)

| Field | Value |
|---|---|
| package | `nanoid` |
| dependency path | `office360 > vite > postcss > nanoid` |
| severity | high |
| advisory | [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv), [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) — infinite loop with bad size / custom generator |
| production/dev | **build/dev** (via postcss) |
| current version | `3.3.11` |
| fixed version | `>=3.3.17` (for full listed fixes) |
| likely reachable | **NO** for typical app usage of postcss pipeline |
| release blocker | **NO** |

### SEC-AUDIT-07 — `undici` (high)

| Field | Value |
|---|---|
| package | `undici` |
| dependency path | `office360 > jsdom > undici` |
| severity | high |
| advisory | e.g. [GHSA-f269-vfmq-vjvj](https://github.com/advisories/GHSA-f269-vfmq-vjvj) WebSocket parser overflow; related undici issues |
| production/dev | **dev/test** if `jsdom` is test-only; confirm package.json placement |
| current version | `7.21.0` |
| fixed version | advisories cite `>=7.24.0` for several issues |
| likely reachable | **NO** for production Tauri UI if only used under vitest/jsdom |
| release blocker | **NO** (verify jsdom is not bundled into production) |

### SEC-AUDIT-08 — `linkify-it` (high)

| Field | Value |
|---|---|
| package | `linkify-it` |
| dependency path | `office360 > @tiptap/pm > prosemirror-markdown > markdown-it > linkify-it` |
| severity | high |
| advisory | [GHSA-22p9-wv53-3rq4](https://github.com/advisories/GHSA-22p9-wv53-3rq4), [GHSA-v245-v573-v5vm](https://github.com/advisories/GHSA-v245-v573-v5vm) — quadratic DoS on crafted text |
| production/dev | **production** (composer/markdown path via TipTap) |
| current version | `5.0.0` |
| fixed version | `>5.0.1` (confirm) |
| likely reachable | **YES** if untrusted mail/composer text is linkified without length limits |
| release blocker | **INVESTIGATE** (DoS / UI hang risk, not RCE by itself) |

## Moderate (noted, not expanded)

- `dompurify` — **direct** production dependency `^3.3.1` — multiple XSS advisories (moderate). Used for HTML sanitization of mail bodies → **likely reachable: YES**, **release blocker: INVESTIGATE** (upgrade separately after QA; do not `audit fix` now).
- One additional moderate counted in audit metadata (see full `npm audit` when ready).

## Release-blocker snapshot

| Item | Blocker? |
|---|---|
| vitest critical | NO (dev) |
| vite/postcss/picomatch/nanoid high | typically NO for packaged desktop; YES if exposing Vite to untrusted network |
| seroval critical | INVESTIGATE |
| linkify-it high | INVESTIGATE |
| dompurify moderate (direct) | INVESTIGATE |

## Next (when authorized — not now)

1. Confirm whether `jsdom`/`vitest`/`vite` appear in production Tauri bundle.
2. Trace `@tanstack/react-router` seroval usage for attacker-controlled JSON.
3. Plan targeted bumps (not blanket `npm audit fix`) after Mail QA day.
