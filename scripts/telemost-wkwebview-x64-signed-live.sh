#!/usr/bin/env bash
# Intel x86_64 SIGNED live helper for Telemost child-WKWebView.
# Builds Office360.app, ad-hoc signs it with Entitlements.plist, then launches
# that same verified bundle so TCC can see com.office360.desktop + camera/mic.
#
# Subcommands: run | verify | status | logs
# Does not replace unsigned x64-live or ARM live helpers.
# Rejects any leftover CEF payload in the signed .app.
# Does not declare media PASS. Does not reset or mutate TCC.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RUST_TARGET="x86_64-apple-darwin"
# Keep artifacts out of Cursor's sandbox CARGO_TARGET_DIR so the signed
# bundle path is stable and is not the unsigned tauri-dev Mach-O.
export CARGO_TARGET_DIR="$ROOT/src-tauri/target"
PRIMARY_APP="$CARGO_TARGET_DIR/$RUST_TARGET/debug/bundle/macos/Office360.app"
FALLBACK_APP="$CARGO_TARGET_DIR/debug/bundle/macos/Office360.app"
APP="$PRIMARY_APP"
ENTITLEMENTS="$ROOT/src-tauri/Entitlements.plist"
SIGNING_IDENTITY="-"
LOG_DIR="$ROOT/artifacts"
LOG_FILE="$LOG_DIR/telemost-wkwebview-x64-signed-live.log"
MARKER='\[telemost-wk-poc\]'
BUNDLE_ID="com.office360.desktop"
EXPECTED_ARCH="x86_64"

usage() {
  cat <<EOF
Usage:
  bash scripts/telemost-wkwebview-x64-signed-live.sh           # bundle + ad-hoc sign + launch
  bash scripts/telemost-wkwebview-x64-signed-live.sh verify    # read-only codesign/entitlement check
  bash scripts/telemost-wkwebview-x64-signed-live.sh status    # read-only TCC + log + process snapshot
  bash scripts/telemost-wkwebview-x64-signed-live.sh logs      # print captured [telemost-wk-poc] lines
  npm run telemost:wk:x64-signed-live
  npm run telemost:wk:x64-signed-verify

Launches a signed Office360.app, not unsigned \`tauri dev\`.
Do not treat codesign success as camera/mic PASS.
EOF
}

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

require_x64_mac() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    fail "Darwin required. Got: $(uname -s)"
  fi
  if [[ "$(uname -m)" != "x86_64" ]]; then
    fail "Intel macOS (uname -m=x86_64) required. Got: $(uname -m)"
  fi
}

require_tools() {
  command -v npm >/dev/null || fail "npm is required."
  command -v cargo >/dev/null || fail "cargo is required."
  command -v codesign >/dev/null || fail "codesign is required."
  command -v plutil >/dev/null || fail "plutil is required."
  if [[ ! -d "$ROOT/node_modules" ]]; then
    fail "node_modules is missing. Run: npm install"
  fi
  if [[ ! -f "$ENTITLEMENTS" ]]; then
    fail "Missing entitlements: $ENTITLEMENTS"
  fi
}

resolve_app() {
  if [[ -d "$PRIMARY_APP" ]]; then
    APP="$PRIMARY_APP"
    return 0
  fi
  if [[ -d "$FALLBACK_APP" ]]; then
    APP="$FALLBACK_APP"
    return 0
  fi
  fail "Office360.app missing. Looked for:
  $PRIMARY_APP
  $FALLBACK_APP"
}

app_executable() {
  printf '%s\n' "$APP/Contents/MacOS/Office360"
}

plist_has_key() {
  local plist="$1"
  local key="$2"
  plutil -extract "$key" raw "$plist" >/dev/null 2>&1
}

entitlement_present() {
  local blob="$1"
  local key="$2"
  printf '%s' "$blob" | grep -q "$key"
}

yes_no() {
  if [[ "$1" == "YES" ]]; then
    printf 'YES\n'
  else
    printf 'NO\n'
  fi
}

macho_arch() {
  local exe="$1"
  if command -v lipo >/dev/null; then
    lipo -archs "$exe" 2>/dev/null || true
  else
    file -b "$exe"
  fi
}

assert_no_cef_payload() {
  local bundle="$1"
  local hits
  local exe="$bundle/Contents/MacOS/Office360"
  if [[ -d "$bundle/Contents/Resources/cef-runtime" ]]; then
    fail "cef-runtime is still inside $bundle"
  fi
  hits="$(find "$bundle" \( \
    -iname '*libcef*' \
    -o -iname '*cef-host*' \
    -o -iname '*Office360CEF*' \
    -o -iname 'Chromium Embedded Framework*' \
    \) 2>/dev/null || true)"
  if [[ -n "$hits" ]]; then
    echo "FAIL: CEF payload still present in $bundle:" >&2
    printf '%s\n' "$hits" >&2
    fail "signed macOS app must be CEF-free"
  fi
  if [[ -x "$exe" ]] && otool -L "$exe" 2>/dev/null | grep -qiE 'libcef|Chromium Embedded Framework'; then
    otool -L "$exe" >&2
    fail "Office360 executable still links CEF"
  fi
}

# Inside-out: deepest Mach-O first, then frameworks, then nested apps.
# Do not use --deep as a substitute for this order.
sign_nested_code() {
  local bundle="$1"
  local path

  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    echo "SIGN nested: $path"
    codesign --force --sign "$SIGNING_IDENTITY" --timestamp=none --options runtime "$path" \
      || echo "WARN: nested sign failed: $path"
  done < <(
    find "$bundle/Contents" -type f \( -name '*.dylib' -o -name '*.so' -o -name '*.bundle' \) 2>/dev/null \
      | awk '{ n=gsub(/\//,"/",$0); print n "\t" $0 }' \
      | sort -nr \
      | cut -f2-
  )

  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    echo "SIGN framework: $path"
    codesign --force --sign "$SIGNING_IDENTITY" --timestamp=none --options runtime "$path" \
      || echo "WARN: framework sign failed: $path"
  done < <(
    find "$bundle/Contents" -type d -name '*.framework' 2>/dev/null \
      | awk '{ n=gsub(/\//,"/",$0); print n "\t" $0 }' \
      | sort -nr \
      | cut -f2-
  )

  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    echo "SIGN nested app: $path"
    codesign --force --sign "$SIGNING_IDENTITY" --timestamp=none --options runtime "$path" \
      || echo "WARN: nested app sign failed: $path"
  done < <(
    find "$bundle/Contents" -type d -name '*.app' 2>/dev/null \
      | awk '{ n=gsub(/\//,"/",$0); print n "\t" $0 }' \
      | sort -nr \
      | cut -f2-
  )
}

sign_app() {
  local bundle="$1"
  echo "SIGN nested code inside $bundle"
  sign_nested_code "$bundle"
  echo "SIGN app with entitlements: $ENTITLEMENTS"
  codesign --force --sign "$SIGNING_IDENTITY" --timestamp=none --options runtime \
    --entitlements "$ENTITLEMENTS" \
    "$bundle"
}

print_tcc_rows() {
  local label="$1"
  local db="$HOME/Library/Application Support/com.apple.TCC/TCC.db"
  echo "TCC $label (read-only, client=$BUNDLE_ID):"
  if ! sqlite3 "$db" "SELECT service, client, auth_value FROM access WHERE client = '$BUNDLE_ID';" 2>/dev/null; then
    echo "  (user TCC.db not readable — SIP / Full Disk Access; not mutated)"
  fi
}

map_tcc_auth() {
  case "${1:-}" in
    0) echo "DENIED" ;;
    2) echo "GRANTED" ;;
    3) echo "LIMITED" ;;
    "") echo "NOT PRESENT" ;;
    *) echo "UNKNOWN($1)" ;;
  esac
}

tcc_service_status() {
  local service="$1"
  local db="$HOME/Library/Application Support/com.apple.TCC/TCC.db"
  local value
  value="$(sqlite3 "$db" "SELECT auth_value FROM access WHERE client = '$BUNDLE_ID' AND service = '$service' LIMIT 1;" 2>/dev/null || true)"
  map_tcc_auth "$value"
}

# Fail-fast preflight. Prints the overnight contract block. Exits 1 on any miss.
# Does not mutate TCC. Does not launch.
verify_signed_app() {
  local bundle="$1"
  local exe
  local info
  local ents=""
  local id="MISSING"
  local arch="MISSING"
  local signature="MISSING"
  local camera_ent="NO"
  local mic_ent="NO"
  local net_ent="NO"
  local camera_usage="NO"
  local mic_usage="NO"
  local codesign_verify="FAIL"
  local ready="NO"
  local failed=0

  exe="$(printf '%s/Contents/MacOS/Office360' "$bundle")"
  info="$bundle/Contents/Info.plist"

  if [[ ! -d "$bundle" ]]; then
    failed=1
  fi
  if [[ ! -x "$exe" ]]; then
    failed=1
    exe="MISSING"
  else
    arch="$(macho_arch "$exe")"
    if ! printf '%s' "$arch" | grep -qw "$EXPECTED_ARCH"; then
      failed=1
    fi
  fi
  if [[ ! -f "$info" ]]; then
    failed=1
  else
    id="$(plutil -extract CFBundleIdentifier raw "$info" 2>/dev/null || echo MISSING)"
    [[ "$id" == "$BUNDLE_ID" ]] || failed=1
    plist_has_key "$info" "NSCameraUsageDescription" && camera_usage="YES" || failed=1
    plist_has_key "$info" "NSMicrophoneUsageDescription" && mic_usage="YES" || failed=1
  fi

  if [[ -d "$bundle" ]]; then
    if codesign --verify --strict --verbose=4 "$bundle" >/tmp/office360-codesign-verify.err 2>&1; then
      codesign_verify="PASS"
    else
      failed=1
      cat /tmp/office360-codesign-verify.err >&2 || true
    fi
    signature="$(codesign -d -vvv "$bundle" 2>&1 | awk -F= '/^Signature=/ {print $2; exit}')"
    [[ -n "$signature" ]] || signature="$(codesign -d -vvv "$exe" 2>&1 | awk '/flags=/ {print; exit}')"
    ents="$(codesign -d --entitlements :- "$bundle" 2>/dev/null || true)"
    entitlement_present "$ents" "com.apple.security.device.camera" && camera_ent="YES" || failed=1
    entitlement_present "$ents" "com.apple.security.device.audio-input" && mic_ent="YES" || failed=1
    entitlement_present "$ents" "com.apple.security.network.client" && net_ent="YES" || failed=1
  fi

  if [[ -d "$bundle" ]]; then
    assert_no_cef_payload "$bundle"
  fi

  if [[ "$failed" -eq 0 ]]; then
    ready="YES"
  fi

  cat <<EOF
OFFICE360 SIGNED LIVE PREFLIGHT
ARCH: ${arch}
APP: ${bundle}
EXECUTABLE: ${exe}
BUNDLE ID: ${id}
SIGNATURE: ${signature:-unknown}
CAMERA ENTITLEMENT: ${camera_ent}
MIC ENTITLEMENT: ${mic_ent}
NETWORK ENTITLEMENT: ${net_ent}
CAMERA USAGE: ${camera_usage}
MIC USAGE: ${mic_usage}
CODESIGN VERIFY: ${codesign_verify}
READY FOR LIVE TCC: ${ready}
EOF

  if [[ "$failed" -ne 0 ]]; then
    fail "signed preflight rejected this bundle; not launching"
  fi
}

stop_unsigned_dev_host() {
  local pids
  pids="$(pgrep -f '/cargo-target/debug/office360|/src-tauri/target/debug/office360' || true)"
  if [[ -n "$pids" ]]; then
    echo "Stopping unsigned tauri-dev Office360 host(s): $pids"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
  fi
}

show_logs() {
  if [[ ! -f "$LOG_FILE" ]]; then
    echo "No captured log yet: $LOG_FILE" >&2
    echo "Run: npm run telemost:wk:x64-signed-live" >&2
    exit 1
  fi
  echo "=== $LOG_FILE ($MARKER) ==="
  grep -aE "$MARKER" "$LOG_FILE" || echo "(no [telemost-wk-poc] markers yet)"
}

show_status() {
  require_x64_mac
  if [[ -d "$PRIMARY_APP" ]]; then
    APP="$PRIMARY_APP"
  elif [[ -d "$FALLBACK_APP" ]]; then
    APP="$FALLBACK_APP"
  fi
  echo "STATUS APP: ${APP}"
  echo "STATUS EXECUTABLE: $(app_executable)"
  echo "STATUS LOG: $LOG_FILE"
  if pgrep -f "$APP/Contents/MacOS/Office360" >/dev/null 2>&1; then
    echo "STATUS PROCESS: RUNNING $(pgrep -f "$APP/Contents/MacOS/Office360" | tr '\n' ' ')"
  else
    echo "STATUS PROCESS: NOT RUNNING"
  fi
  echo "CAMERA TCC: $(tcc_service_status kTCCServiceCamera)"
  echo "MIC TCC: $(tcc_service_status kTCCServiceMicrophone)"
  print_tcc_rows STATUS
  echo "WK INIT: $( { grep -ac 'WK INIT' "$LOG_FILE" || true; } 2>/dev/null )"
  echo "VIEW ATTACHED: $( { grep -ac 'VIEW ATTACHED' "$LOG_FILE" || true; } 2>/dev/null )"
  echo "PREJOIN DETECTED (URL heuristic): $( { grep -ac 'PREJOIN DETECTED' "$LOG_FILE" || true; } 2>/dev/null )"
  echo "Do not treat URL-heuristic PREJOIN DETECTED as visual prejoin PASS."
}

build_bundle() {
  echo "BUILD: npx tauri build --debug --bundles app --target $RUST_TARGET --no-sign --ci"
  echo "CARGO_TARGET_DIR=$CARGO_TARGET_DIR"
  echo "Then ad-hoc sign with $ENTITLEMENTS (identity=$SIGNING_IDENTITY)"
  npx tauri build --debug --bundles app --target "$RUST_TARGET" --no-sign --ci
  resolve_app
}

cmd_verify() {
  require_x64_mac
  command -v codesign >/dev/null || fail "codesign is required."
  command -v plutil >/dev/null || fail "plutil is required."
  resolve_app
  APP="$(cd "$APP" && pwd)"
  verify_signed_app "$APP"
}

cmd_run() {
  require_x64_mac
  require_tools
  mkdir -p "$LOG_DIR"
  : >"$LOG_FILE"

  echo "Permissions expected during live test:"
  echo "  CAMERA: NSCameraUsageDescription + com.apple.security.device.camera"
  echo "  MIC:    NSMicrophoneUsageDescription + com.apple.security.device.audio-input"
  echo "  OTHER:  com.apple.security.network.client, WebKit JIT entitlements"
  echo "  NOT IN SCOPE: ScreenCaptureKit / promo-script edits"
  echo "macOS may prompt for Camera and Microphone. Do not click Deny."
  echo "Live path: CREATE → PREJOIN → JOIN → MEETING → LEAVE → CREATE in the same pane."
  echo
  print_tcc_rows BEFORE
  echo

  build_bundle
  APP="$(cd "$APP" && pwd)"
  local verified_exe
  verified_exe="$(app_executable)"
  sign_app "$APP"
  verify_signed_app "$APP"
  if [[ "$(app_executable)" != "$verified_exe" ]]; then
    fail "verified executable drifted before launch: $verified_exe vs $(app_executable)"
  fi
  stop_unsigned_dev_host

  echo
  echo "LAUNCH: $verified_exe"
  echo "LOG FILE: $LOG_FILE"
  echo "OPEN: Office360 → Яндекс Телемост → Подключиться → real /j/... URL"
  echo
  export RUST_LOG="${RUST_LOG:-info}"
  "$verified_exe" 2>&1 | tee "$LOG_FILE"
}

case "${1:-run}" in
  -h|--help|help) usage ;;
  logs|log) show_logs ;;
  status) show_status ;;
  verify) cmd_verify ;;
  run) cmd_run ;;
  *) usage >&2; exit 1 ;;
esac
