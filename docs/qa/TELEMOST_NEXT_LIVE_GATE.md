# Telemost next live gate (Intel x86 signed)

Date: 2026-08-15
This is the **morning one-click** procedure. It is not the ARM POC (`TELEMOST_WKWEBVIEW_ARM64_POC.md`).

Do **not** treat codesign, preflight, or `PREJOIN DETECTED` URL logs as camera/mic/join PASS.

## Command

```bash
cd /Users/gorg.korotkov/Developer/office360
npm run telemost:wk:x64-signed-live
```

Expected: build debug `.app` if needed, nested ad-hoc sign, **fail-fast preflight**, launch:

```text
src-tauri/target/x86_64-apple-darwin/debug/bundle/macos/Office360.app/Contents/MacOS/Office360
```

Not `tauri dev`. Not unsigned `/var/folders/.../cargo-target/debug/office360`.

### Preflight must print

```text
OFFICE360 SIGNED LIVE PREFLIGHT
ARCH: x86_64
APP: .../Office360.app
EXECUTABLE: .../Office360.app/Contents/MacOS/Office360
BUNDLE ID: com.office360.desktop
SIGNATURE: ...
CAMERA ENTITLEMENT: YES
MIC ENTITLEMENT: YES
NETWORK ENTITLEMENT: YES
CAMERA USAGE: YES
MIC USAGE: YES
CODESIGN VERIFY: PASS
READY FOR LIVE TCC: YES
```

If `READY FOR LIVE TCC: NO` or the helper exits 1: **stop**. Do not click Allow on a different binary.

Read-only checks (no TCC mutation):

```bash
npm run telemost:wk:x64-signed-verify   # no launch
npm run telemost:wk:x64-signed-status   # TCC rows + process + log counters
npm run telemost:wk:x64-signed-logs     # [telemost-wk-poc] lines
```

## Morning procedure

1. `npm run telemost:wk:x64-signed-live`
2. Confirm preflight block all YES/PASS and launched path equals verified `EXECUTABLE`.
3. Office360 main window opens (signed `.app`).
4. Яндекс Телемост → **Подключиться** (Join), not Create.
5. Paste a real meeting URL: `https://telemost.yandex.ru/j/<id>`
6. If macOS shows **Camera** for Office360: **Allow**.
7. If macOS shows **Microphone** for Office360: **Allow**.
8. Confirm **visual prejoin** (local camera preview + mic control), not marketing home, not native-app promo, not rating modal.
9. Click official **Join / Подключиться** in the Telemost page.
10. Join the same `/j/<id>` from a phone (second participant).
11. Confirm **remote video** and **remote audio**.
12. Leave, reopen the same meeting from Office360.
13. Confirm session still authenticated (no unexpected Passport wall).
14. Reopen meeting **5×** (no Safari, no extra window, no orphan WK view).
15. Collect evidence:

```bash
npm run telemost:wk:x64-signed-status
npm run telemost:wk:x64-signed-logs
```

## Evidence expected

| Check | Evidence |
|---|---|
| Signed process | `status` PROCESS running under `.../Office360.app/Contents/MacOS/Office360` |
| Bundle | `CFBundleIdentifier=com.office360.desktop` |
| WK actually opened | log `WK INIT` + `VIEW ATTACHED` + `NAV START/COMMIT/FINISH` on `/j/...` |
| Promo | promo gone; **do not** require isolation script |
| Prejoin | **visual** camera/mic controls on `/j/`; log `PREJOIN DETECTED` is URL-only heuristic |
| TCC Camera | `status` CAMERA TCC: GRANTED (`kTCCServiceCamera` auth_value=2) |
| TCC Mic | `status` MIC TCC: GRANTED |
| Join | in-meeting UI after official Join click |
| Remote A/V | second device visible/audible |
| No Safari / Telemost.app | no `telemost://` handoff; helper intercepts scheme |
| Session | reopen without full re-login |
| Stability | 5× reopen, no `VIEW DETACHED` crash loop |

## USER_INTERACTION_REQUIRED

Overnight automation cannot complete:

- macOS Camera Allow
- macOS Microphone Allow
- Telemost Join click
- second participant
- visual remote A/V
- Apple Silicon ARM live (`npm run telemost:wk:arm-live`)
- Yandex login if Passport appears

Do not reset TCC. Do not edit TCC.db. Do not click Allow programmatically.

## Read-only TCC (optional extra)

```bash
sqlite3 "$HOME/Library/Application Support/com.apple.TCC/TCC.db" \
  "SELECT service, client, auth_value FROM access WHERE client = 'com.office360.desktop';"
```

If unreadable (SIP / Full Disk Access): use `npm run telemost:wk:x64-signed-status` and System Settings → Privacy → Camera / Microphone → Office360.

`auth_value`: `2` = granted, `0` = denied, empty = never asked.

## Known non-PASS traps

- Unsigned `npm run telemost:wk:x64-live` / `tauri dev` does **not** carry entitlements.
- CEF preload fail (`have 'arm64', need 'x86_64'`) is irrelevant to WK JOIN.
- `PREJOIN DETECTED` after `/j/` navigation is **not** visual prejoin.
- Promo-only script is **FROZEN**; do not “fix” home/rating by expanding isolation.

## After the gate

Personal CREATE is already on the product path: same-pane `open_telemost_macos_embedded` + official CTA (`TELEMOST_CEF_REMOVAL_PLAN.md`). Do not revive `open_telemost_macos_create` as the default.
If `/j/` still lands on marketing/home inside the **signed** app: capture logs + screenshot before any script change.
