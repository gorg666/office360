# Current State

> Living snapshot for AI sessions. Update when context grows large. Do not invent facts.

## Last updated

2026-08-17 — Prompt 53: unified Yandex WK login (OAuth window uses Telemost `WKWebsiteDataStore`) + Dock badge Regular activation policy. Baseline was `3157864`. Live Intel proof still required after rebuild.

## Prompt 51 (Dock badge + Efim auth audit)

- Live FAIL on Prompt 50: `WebviewWindow.set_badge_count` did not update Dock. Tao uses `MainThreadMarker::new_unchecked()`; AppKit NSDockTile must run on the main thread. Fix: `macos_dock_badge.rs` → `run_on_main_thread` → `NSApplication.dockTile.setBadgeLabel` + `display()`.
- Unread source: UI uses `threads.is_read`; badge SQL previously required unread **messages** only. `getUnreadInboxCount` now counts INBOX threads where `t.is_read = 0` OR any message unread.
- Efim unique vs 8be0948: only `origin/efim-11-08-auth` (`9548cc5`, `aa39e9a`). Rejected: older oauthFlow (drops macOS loopback hardening), different public client id, TelemostPage/CEF host churn. Current grants already include mail/calendar/telemost-api/yamb.
- 17248 loopback kept. WK Passport remains separate from Office360 tokens.

## Prompt 50 (macOS consolidation / dual-arch)

- Working tree Telemost (Prompts 36–49) is the protected product baseline. Git recovery: `origin/main`, `office360-mail-workflow`, `chore/office360-plugin-installed-refresh` are ancestors of `macos/arm64` HEAD `a639e58` — no unique missing commits to cherry-pick. `fix/macos-reopen-icon-badge` is already an ancestor (dock Reopen + icon scale).
- Dock unread badge: historical API is inbox unread → `Window.setBadgeCount`. Restored by rust `set_dock_badge_count` on label `main` (child WK no longer the badge target) + Telemost webview labels in capabilities.
- `cef-host/macos/` removed. Windows `cef-host/` kept. Local `cef-host/build-macos*` dirs are gitignored residue, not packaged.
- Intel: `artifacts/Office360-macOS-Intel-x86_64.dmg` (13M, SHA256 `fe77adaae395b13b290f185ca43fb32853858116feb41f0f61677957a3aec99a`), app x86_64 ~34M, CEF absent, codesign valid.
- ARM: `artifacts/Office360-macOS-Apple-Silicon-arm64.dmg` (12M, SHA256 `015aa5dd4a652135b8b34c947d8deb9bf7a399b9a985b01d362ad532fd92bc9f`), app arm64 ~33M, one Mach-O, CEF absent, codesign static valid. Live hardware: deferred.
- macOS x86 Telemost live (Prompt 49 signed helper): CREATE → PREJOIN → MEETING → Leave → native IDLE → CREATE again. Rating modal not observed that run.
- Architecture: Office360 → Tauri → WKWebView/WebKit → official Yandex Telemost. CEF absent on macOS. Windows CEF remains platform-gated.

## Prompt 49 (post-call rating → Office360 IDLE)

- After Leave, official rating modal is kept. HOME «Подключиться» no longer blocks `telemost-macos-left`.
- Rating dialog (`role=dialog` + «Оцените качество связи»): wait until dismissed, then emit left once, hide/close WK, TelemostPage EMPTY.
- Leave CTA includes «Выйти из встречи». PREJOIN `/j/`+video does not emit. After Leave, 2s grace for rating before HOME-idle.
- Stage 3 / official create click / SSO allow-list / UUID not touched.

## Prompt 48 (Passport → CREATE continuation)

- Live PID 93902 after successful Passport login: `NAV FAIL blocked URL=https://sso.passport.yandex.ru/prepare?...finish=https://telemost.yandex.ru/browser-auto-create...` and `about:srcdoc`. UI stuck on Yandex ID loading. No return to Telemost, no `/j/`.
- Allow-list now includes `sso.passport.yandex.ru` / `.com` and `about:srcdoc`. `ya.ru` and `telemost://` stay blocked.
- After auth challenge, return to Telemost HOME/`/browser-auto-create` emits `telemost-macos-auth-resumed`, restores create mask, restarts 12s fallback. Click-once is per HOME epoch (host+path+search), so post-auth CTA may fire once more.
- Stage 3 / UUID / WKWebsiteDataStore mapping not touched.

## Prompt 47 (hidden WK official CTA)

- Live Prompt 46 + first Prompt 47 hide-only run: auto-CTA timed out at 12s. `getBoundingClientRect` was necessary to drop; `webview.hide()` was a second blocker.
- CREATE_PENDING: WK stays shown at real pane bounds (`RESIZE` 498×593). Native child mask `telemost-create-mask` covers it with «Создаём встречу». `/j/`, Passport, and the 12s fallback remove the mask.
- Matcher: exact «Создать видеовстречу» / «Create video meeting»; unique only; no layout-rect requirement; click only when `document.readyState === "complete"`; rust re-evals/kicks on NAV FINISH; click-once + title beacon `__O360_TELEMOST_CREATE__:`.
- Signed x86 live PID 93902: `CREATE MASK ON` → `clicked once` at NAV FINISH → `passport.yandex.ru/auth` → `AUTH REQUIRED` / mask off. Not a 12s HOME timeout. PREJOIN blocked by legitimate auth after profile reset.
- Stage 3 / UUID / WKWebsiteDataStore not touched.

## Prompt 45 (portal-free Telemost UX)

- Idle right pane: native Office360 copy («Создайте новую встречу или подключитесь по ссылке.»). No WK mount. Toolbar remains the only Create/Join/Schedule controls.
- Personal CREATE: hidden WK loads `TELEMOST_CREATE_URL`, official CTA click-once (`telemost_official_create_click.js`), reveal at `/j/` PREJOIN. 12s fallback reveals minimal official create surface.
- Auth: Passport/title → `telemost-macos-auth-required` → WK visible. Persistent per-account `WKWebsiteDataStore` unchanged.
- Leave: `telemost_leave_to_idle.js` arms on meeting Leave/`/j/` video, then title `__O360_TELEMOST_LEFT__` → `telemost-macos-left` → `returnToIdle()`.
- Stage 3 JOIN isolation file not edited. Windows CEF path not edited.

## Prompt 44 (macOS CEF-free)

- macOS Telemost JOIN/CREATE/PREJOIN/MEETING: `open_telemost_macos_embedded` (same right pane). No `cefCreate` / `cefNavigate`.
- Calendar Telemost open on macOS: `EventDetailModal` → Telemost page + `office360_telemost_open_event_id` → WK. Windows still `cefNavigate`.
- OAuth on macOS: loopback `http://localhost:17248` + `open_oauth_login_window`. Screen-code CEF is Windows-only if OOB URI is requested.
- Session reset: `reset_telemost_macos_profile` only. No `cefResetAccountProfile` on macOS.
- Rust: `mod cef` Windows-only. `preload_libcef_allocator` removed. SQLite still `sqlite:office360.db` plugin preload.
- Packaging: shared + macOS Tauri resources do not include `cef-runtime`. Windows still does. Deleted `build-cef-host-macos.sh` / `bootstrap-cef-macos.sh`.
- Frozen: Stage 3 isolation, promo script, UUID/session algorithm, no Native Bridge, no ScreenCaptureKit.
- ARM64 live hardware: deferred. arm64 compile/package must remain.

## Prompt 41 / 42 (Stage 3 post-meeting CREATE)

- After Leave, HOME must unhide Create CTA (`watchLeave` / `becomeDormant` in `telemost_stage3_surface_isolation.js`).
- JOIN TRANSITION path unchanged. Promo ON. Stage 3 ON for embedded JOIN.
- Prior signed x86 live (PID 51564 and earlier) still contained `cef-runtime` (~907M). Prompt 44 rebuild must prove a CEF-free `.app`.

## Prompt 36 (embedded CREATE)

- Product path: `TelemostPage` `CREATE_WEB` → `open_telemost_macos_embedded` with `https://telemost.yandex.ru/?browser-auto-create=1`.
- Same `accountId` → `profile_identifier` → `WKWebsiteDataStore`.
- `/j/` from CREATE mode emits `telemost-macos-created` once; frontend skips a second embedded open for that join URL.
- Windows CEF create unchanged. Business API create unchanged.

## Screen share

- macOS product Telemost is WKWebView. Do not add ScreenCaptureKit in this pass.
- `cef-host/macos` source is deleted. `NSScreenCaptureUsageDescription` remains in Info.plist; do not strip entitlements.

## Checks

- Prompt 50: `tsc --noEmit` PASS; Vitest 2117 passed (1 ContactsPage flake, retry PASS); `cargo test --lib` 27; cargo check x86_64 + aarch64 PASS; `git diff --check` PASS; `graphify update .`; Tauri release Intel + ARM PASS.
- COMMIT / PUSH: dual-arch branches `macos/x86_64` and `macos/arm64` (same source commit). Do not merge to `main` in this pass.
