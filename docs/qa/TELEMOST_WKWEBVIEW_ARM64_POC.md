# Telemost WKWebView Apple Silicon POC — ARM TEST PACK

## Status

ARM LIVE TEST READY: YES
WKWebView LIVE: NOT TESTED
Do not declare WKWebView PASS from compile, unit tests, or first-page load.

## Scope

Official `telemost.yandex.ru` join flow in a persistent child WKWebView of the
Office360 main window.

Out of scope: CEF deletion, create-meeting UX, screen sharing, ScreenCaptureKit,
DOM isolation, custom WebRTC, AccountSessionBroker.

## Commands

```bash
# 1. Install prerequisites (once)
npm install
rustup target add aarch64-apple-darwin

# 2–4. Build + run + capture logs (Apple Silicon only)
npm run telemost:wk:arm-live

# 5. After/during the session, inspect POC markers
bash scripts/telemost-wkwebview-arm-live.sh logs
```

Intel x86_64 uses a separate helper. Do not weaken the ARM helper.

```bash
npm run telemost:wk:x64-live
bash scripts/telemost-wkwebview-x64-live.sh logs
```

Equivalent without the helper:

```bash
npm run tauri dev
# then: grep -E '\[telemost-wk-poc\]' artifacts/telemost-wkwebview-arm-live.log
```

The helper refuses to start unless `uname -m` is `arm64`.

## Permissions

| Gate | Status |
|---|---|
| CAMERA | `NSCameraUsageDescription` in `src-tauri/Info.plist`; `com.apple.security.device.camera` in `src-tauri/Entitlements.plist` |
| MIC | `NSMicrophoneUsageDescription` in `src-tauri/Info.plist`; `com.apple.security.device.audio-input` in `src-tauri/Entitlements.plist` |
| NETWORK | `com.apple.security.network.client` |
| WEBKIT | existing JIT entitlements; child WKWebView via Tauri `add_child` |
| SCREEN RECORDING | not added for this POC (`NSScreenCaptureUsageDescription` already exists for the CEF path; unused by WKWebView POC) |

macOS TCC prompts for Camera and Microphone are expected on first `getUserMedia`.

## Exact test

1. Launch Office360
2. Open Telemost
3. Open real `/j/...` meeting
4. Login through Passport if requested
5. Confirm prejoin
6. Confirm local camera preview
7. Confirm microphone activity
8. Join from another account/device
9. Confirm remote video
10. Confirm remote audio
11. Resize/scroll
12. Leave
13. Reopen Telemost
14. Confirm login/session still active
15. Repeat open/close five times
16. Confirm no Safari
17. Confirm no separate window
18. Confirm no orphan views/crash

Record each item as PASS, FAIL, or NOT TESTED.

## Expected log markers

```text
WK INIT
VIEW ATTACHED
NAV START
NAV COMMIT
NAV FINISH
URL=...
TITLE ...
LOGIN PAGE DETECTED
TELEMOST PAGE DETECTED
PREJOIN DETECTED
MEETING PAGE DETECTED
VIEW DETACHED
RESIZE
```

`MEETING PAGE DETECTED` is title-based. Prejoin and in-meeting share `/j/`, so
remote video/audio remain a visual gate.

## Known limitations

- Tauri child-webview API does not expose WebKit navigation-failure or
  WebContent-process crash callbacks. Absence of `NAV FAIL` / crash records is
  not evidence those gates passed. Do not add a native WebKit bridge for this POC.
- `NAV FAIL blocked` only means the allow-list rejected a URL or popup.
- Safari must not open automatically. Explicit **Открыть в браузере** after an
  error is still allowed.
- CREATE still uses the existing CEF right-pane path. Do not use CREATE for this
  acceptance gate.

## CEF baseline

UNCHANGED for CREATE / Windows. Meeting join on macOS uses child WKWebView only
(`open_telemost_macos_embedded`). Standalone `open_telemost_macos_spike` is not
called by the meeting renderer.
