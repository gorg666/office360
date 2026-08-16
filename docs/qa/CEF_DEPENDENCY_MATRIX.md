# CEF dependency matrix — Telemost / Office360

Date: 2026-08-16
Branch at audit: `macos/arm64`
Graphify: USED (`graphify query`; source wins)
macOS CEF runtime: **REMOVED**
Windows CEF runtime: **KEPT PLATFORM-GATED**

## Product question

> What still requires CEF?

**Windows only.** macOS Telemost JOIN / CREATE / PREJOIN / MEETING / session / calendar open / OAuth / profile reset / packaging / startup preload no longer use CEF.

## Classification key

`JOIN | CREATE | WINDOWS | MACOS | SHARED | DEAD | PACKAGING | TEST ONLY`

`SAFE TO REMOVE NOW?` = can delete without replacing Windows behavior.

---

## Remaining dependencies (Windows / source leftovers)

| FILE | SYMBOL | USED BY | CLASS | WHY STILL NEEDED | REPLACEMENT | SAFE TO REMOVE NOW? |
|---|---|---|---|---|---|---|
| `src/services/cef.ts` | `cefInitialize` / `cefCreate` / `cefNavigate` / bounds / visible / session / permission / shutdown | Windows `TelemostPage`, `meetingRenderer`, `meetingActions`, `oauthFlow` (screen-code), `EventDetailModal` (Windows) | WINDOWS | Frontend IPC façade for Windows CEF commands | Future Windows WebView2 / non-CEF embed | NO |
| `src-tauri/src/cef.rs` | `cef_*` commands, `Runtime` | `lib.rs` `#[cfg(windows)]` | WINDOWS | Native host for Windows `office360_cef_host.dll` | Same | NO |
| `src-tauri/src/lib.rs` | `office360_invoke_handler![cef::…]` | `#[cfg(windows)]` only | WINDOWS | Registers CEF IPC on Windows | Same | NO |
| `src/components/yandex/TelemostPage.tsx` | `useEmbeddedTelemost` (`desktopPlatform === "windows"`) | Windows Telemost UI | WINDOWS / JOIN / CREATE | In-pane CEF for Windows JOIN+CREATE+Passport | Windows WK/WebView2 or keep CEF | NO |
| `src/services/telemost/meetingRenderer.ts` | `openTelemostMeeting` Windows `cefNavigate` | JOIN | WINDOWS / JOIN | Windows meeting URL → CEF | Future Windows embed | NO |
| `src/services/telemost/meetingActions.ts` | `createTelemostMeetingWeb` Windows `cefNavigate(?browser-auto-create=1)` | CREATE | WINDOWS / CREATE | Official web auto-create inside CEF | Same URL in a Windows embed | NO |
| `src/components/calendar/EventDetailModal.tsx` | `openMeeting` → `cefNavigate` **Windows only** | calendar JOIN | WINDOWS / JOIN | Calendar meeting on Windows still CEF | Same as JOIN renderer | NO |
| `src/services/oauth/oauthFlow.ts` | `openAuthorization` + `usesCefScreenCode` | Yandex OOB/screen-code | WINDOWS | CEF hosts verification-code OAuth **only if** caller passes OOB URI **and** platform is Windows. macOS rewrites to `http://localhost:17248` + `open_oauth_login_window` | Existing loopback (already default for Yandex) | NO on Windows; **already gone on macOS** |
| `src-tauri/tauri.windows.conf.json` | `resources: ["cef-runtime/**/*"]` | Windows bundle | PACKAGING / WINDOWS | Ships CEF runtime into Windows installer | Delete with Windows CEF | NO |
| `scripts/build-cef-host.ps1` | Windows CEF host | Windows CEF build | PACKAGING / WINDOWS | Builds `office360_cef_host.dll` | Delete with Windows CEF | NO |
| `scripts/bootstrap-cef.ps1` / `verify-cef-payload.ps1` | CEF SDK fetch / payload check | Windows | PACKAGING / WINDOWS | Official CEF distro | Delete with Windows CEF | NO |
| `cef-host/` | Windows `office360_cef_host.cpp` / CMake | Windows CEF build | PACKAGING / WINDOWS | Native CEF host. `cef-host/macos/` **deleted**. | WK on macOS (done); WebView2 later on Windows | NO (Windows only) |
| `src-tauri/cef-runtime/` (gitignored) | Windows staged runtime | Windows packager | PACKAGING | Loaded by `cef.rs` on Windows | Stop bundling after last Windows CEF command | NO |
| env `OFFICE360_CEF_RUNTIME` | Windows `cef.rs` `runtime_dir` | WINDOWS | Override runtime path in Windows dev | Delete with Windows CEF | NO on Windows; unused on macOS |
| `src-tauri/Info.plist` | `NSScreenCaptureUsageDescription` | MACOS leftover string | MACOS | Historical CEF share copy; WK JOIN does not use ScreenCaptureKit | Keep string; do not add ScreenCaptureKit | Leave string |
| `src-tauri/tauri.conf.json` / `tauri.macos.conf.json` | `resources` | macOS bundle | PACKAGING / MACOS | Empty / no `cef-runtime` | N/A | Already removed |
| `scripts/package-macos-dmg.sh` | `assert_no_cef_payload` | macOS DMG | PACKAGING / MACOS | Fails if CEF leaks into `.app` | N/A | Already CEF-free |
| `scripts/build-cef-host-macos.sh` / `bootstrap-cef-macos.sh` | — | — | DEAD | Deleted | — | Deleted |

## macOS product path (CEF-free)

| Flow | Runtime | Command / adapter |
|---|---|---|
| JOIN | WKWebView | `openTelemostMeeting` → `open_telemost_macos_embedded` |
| CREATE (personal / WEB_ONLY) | WKWebView same pane | `createTelemostMeetingWeb("macos")` → `open_telemost_macos_embedded` + `?browser-auto-create=1` |
| CREATE (Business) | REST → WK JOIN | `createTelemostConference` then embedded JOIN |
| PREJOIN / MEETING | WKWebView | same child surface + Stage 3 isolation init script |
| SESSION | `WKWebsiteDataStore` | `profile_identifier` / UUIDv5 |
| Calendar Telemost open | WKWebView | `EventDetailModal` → `navigateToLabel("telemost")` + `office360_telemost_open_event_id` → TelemostPage WK |
| Account / session reset | WK profile | `reset_telemost_macos_profile` only (no `cefResetAccountProfile`) |
| OAuth | loopback + native login window | `YANDEX_DESKTOP_REDIRECT_URI` + `open_oauth_login_window` |
| Startup | SQLite plugin preload | **no** `preload_libcef_allocator` |

No normal macOS Telemost path calls `cefCreate` / `cefNavigate` / `cefResetAccountProfile`.

## CEF SAFE-REMOVE SET (macOS runtime)

Already removed from macOS compile / package / runtime:

- `preload_libcef_allocator`
- `#[cfg(windows)] mod cef` (absent on macOS)
- CEF Tauri commands on macOS
- `tauri.macos.conf.json` `cef-runtime`
- DMG CEF copy / nested CEF signing
- `scripts/build-cef-host-macos.sh`
- `scripts/bootstrap-cef-macos.sh`
- `cef-host/macos/` C++ host (deleted)
- macOS Telemost CREATE CEF (`macosCefActive` / `pageMode==="CREATE"`)
- Calendar CEF on macOS
- OAuth CEF on macOS

## CEF BLOCKED-REMOVE SET (Windows)

- Windows JOIN (`meetingRenderer.openTelemostMeeting` → `cefNavigate`)
- Windows CREATE (`meetingActions.createTelemostMeetingWeb` → CEF auto-create)
- Windows in-pane Telemost (`TelemostPage` `useEmbeddedTelemost`)
- Windows calendar JOIN `EventDetailModal.cefNavigate`
- Windows screen-code OAuth CEF (only if OOB URI is requested)
- `cef-host` Windows + `cef-runtime` Windows packaging

## JOIN on macOS

WKWebView only. CEF is not compiled, not registered, not bundled, not launched.
