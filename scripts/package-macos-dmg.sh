#!/usr/bin/env bash
# Build a CEF-free macOS Office360.app, sign it, then create a DMG.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# Keep release artifacts in the repo target dir, not Cursor's sandbox cache.
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/src-tauri/target}"
INPUT_ARCH="${1:-}"
OUTPUT_PATH="${2:-}"

case "$INPUT_ARCH" in
  arm64|aarch64)
    RUST_TARGET="aarch64-apple-darwin"
    ARTIFACT_ARCH="arm64"
    INSTALLER_NAME="Office360-macOS-Apple-Silicon-arm64.dmg"
    ;;
  x86_64)
    RUST_TARGET="x86_64-apple-darwin"
    ARTIFACT_ARCH="x86_64"
    INSTALLER_NAME="Office360-macOS-Intel-x86_64.dmg"
    ;;
  *)
    echo "Usage: $0 <arm64|x86_64> [output.dmg]" >&2
    exit 1
    ;;
esac

if [[ -z "$OUTPUT_PATH" ]]; then
  OUTPUT_PATH="$ROOT/artifacts/$INSTALLER_NAME"
elif [[ "$OUTPUT_PATH" != /* ]]; then
  OUTPUT_PATH="$ROOT/$OUTPUT_PATH"
fi

SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:--}"
APP="$CARGO_TARGET_DIR/$RUST_TARGET/release/bundle/macos/Office360.app"
ENTITLEMENTS="$ROOT/src-tauri/Entitlements.plist"
DMG_ROOT="$(mktemp -d /private/tmp/office360-dmg-root.XXXXXX)"
trap 'rm -rf "$DMG_ROOT"' EXIT

assert_no_cef_payload() {
  local bundle="$1"
  local hits
  if [[ -d "$bundle/Contents/Resources/cef-runtime" ]]; then
    echo "FAIL: cef-runtime is still inside $bundle" >&2
    exit 1
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
    exit 1
  fi
  local exe="$bundle/Contents/MacOS/Office360"
  if [[ -x "$exe" ]] && otool -L "$exe" 2>/dev/null | grep -qiE 'libcef|Chromium Embedded Framework'; then
    echo "FAIL: Office360 executable still links CEF" >&2
    otool -L "$exe" >&2
    exit 1
  fi
}

sign_nested_code() {
  local bundle="$1"
  local path
  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    codesign --force --sign "$SIGNING_IDENTITY" --timestamp=none --options runtime "$path" \
      || echo "WARN: nested sign failed: $path"
  done < <(
    find "$bundle/Contents" -type f \( -name '*.dylib' -o -name '*.so' -o -name '*.bundle' \) 2>/dev/null \
      | awk '{ n=gsub(/\//,"/",$0); print n "\t" $0 }' \
      | sort -nr \
      | cut -f2-
  )
}

if [[ "${SKIP_TAURI_BUILD:-}" != "1" ]]; then
  (
    cd "$ROOT"
    npm run tauri -- build --bundles app --target "$RUST_TARGET"
  )
fi

if [[ ! -d "$APP" ]]; then
  echo "Tauri app bundle missing: $APP" >&2
  exit 1
fi

assert_no_cef_payload "$APP"

sign_nested_code "$APP"
codesign --force --sign "$SIGNING_IDENTITY" --options runtime --timestamp=none \
  --entitlements "$ENTITLEMENTS" "$APP"
codesign --verify --strict --verbose=4 "$APP"
assert_no_cef_payload "$APP"

mkdir -p "$(dirname "$OUTPUT_PATH")"
ditto "$APP" "$DMG_ROOT/Office360.app"
ln -s /Applications "$DMG_ROOT/Applications"
hdiutil create \
  -volname Office360 \
  -srcfolder "$DMG_ROOT" \
  -format UDZO \
  -ov \
  "$OUTPUT_PATH"

printf '%s\n' "$OUTPUT_PATH"
