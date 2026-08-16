# Telemost CEF removal plan

Date: 2026-08-16
Companion: `docs/qa/CEF_DEPENDENCY_MATRIX.md`

macOS CEF removal: **DONE for runtime/package**.
Windows CEF: **kept platform-gated**.
ARM64 live hardware: deferred; arm64 compile/package remains required.

## Current runtime (source of truth)

```text
Office360
→ TelemostPage
→ meetingRenderer / meetingActions / yandex360/telemost
→ macOS JOIN/CREATE/PREJOIN/MEETING: native child WKWebView
   (open_telemost_macos_embedded) + promo script + Stage 3 isolation
→ macOS session: persistent per-account WKWebsiteDataStore
→ macOS OAuth: localhost:17248 + open_oauth_login_window
→ Windows JOIN/CREATE/OAuth-OOB: CEF
→ Business CREATE: official REST https://cloud-api.yandex.net/v1/telemost-api/conferences
→ Personal CREATE: WEB_ONLY → macOS in-pane WK ?browser-auto-create=1
```

CEF is not part of the macOS product path.

---

## Workstream F — personal-account CREATE (closed on macOS)

Personal / WEB_ONLY CREATE runs in the **same right pane** via:

`CREATE_WEB` → `open_telemost_macos_embedded` (`https://telemost.yandex.ru/?browser-auto-create=1`)

`/j/` capture emits `telemost-macos-created` once; frontend stays on the same embedded surface.

`open_telemost_macos_create` (separate WK window) remains compiled but is **off the product path**.

Legacy macOS CEF CREATE (`macosCefActive`, `pageMode="CREATE"`, Passport CEF) is deleted.

---

## Workstream G — CEF-free macOS runtime (this pass)

### Done

1. Frontend macOS Telemost: no `cefCreate` / `cefNavigate` / `cefResetAccountProfile`.
2. Calendar `EventDetailModal`: macOS routes Telemost join URLs to TelemostPage WK; Windows keeps CEF.
3. OAuth: macOS never keeps `verification_code` CEF screen-code; rewrites to loopback.
4. Account switch / removal: `reset_telemost_macos_profile` only.
5. Rust: `mod cef` and CEF commands are `#[cfg(windows)]`. No `preload_libcef_allocator`.
6. Packaging: `cef-runtime` is Windows-only (`tauri.windows.conf.json`). macOS bundle resources empty. DMG script fails if CEF payload is present. Deleted `build-cef-host-macos.sh` and `bootstrap-cef-macos.sh`.
7. Signing: nested CEF framework/helper signing removed from macOS. App + used native dylibs still signed with existing entitlements (camera / mic / network).

### Not in this pass

- Windows CEF JOIN/CREATE/OAuth
- Native Bridge
- ScreenCaptureKit
- Stage 3 isolation rewrite
- Promo script rewrite
- UUID / WKWebsiteDataStore algorithm

`cef-host/macos/` C++ source is deleted. Windows `cef-host/` remains.

### Windows later

If Windows moves off CEF, the obvious replacement is a WebView2 / official-web embed using the same `TELEMOST_CREATE_URL` + join-URL capture already used on macOS WK. Not started.

---

## Verification

- Vitest: TelemostPage, EventDetailModal, meetingRenderer, meetingActions, oauthFlow, macosProfileCleanup, signedLiveHelper, Stage 3
- `npx tsc --noEmit`
- `cargo test --lib` (includes SQLite-without-CEF-preload guards)
- `cargo check --target x86_64-apple-darwin`
- `cargo check --target aarch64-apple-darwin`
- Signed x86 live: `npm run telemost:wk:x64-signed-live` (filesystem + otool CEF scan in helper)
- Dual-arch release: `npm run package:macos:intel` and `npm run package:macos:arm` → `artifacts/Office360-macOS-Intel-x86_64.dmg` / `artifacts/Office360-macOS-Apple-Silicon-arm64.dmg` (gitignored). ARM live hardware deferred.

**CEF REMOVAL STATUS: macOS runtime CEF-free.** Windows CEF remains. macOS x86 live: PASS (Prompt 49). macOS ARM: STATIC/PACKAGE PASS; LIVE HARDWARE DEFERRED.
