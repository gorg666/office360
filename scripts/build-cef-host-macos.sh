#!/usr/bin/env bash
# Build the macOS CEF host/helpers and stage them into src-tauri/cef-runtime (gitignored).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
TARGET_ARCH="${1:-${O360_CEF_ARCH:-$(uname -m)}}"
case "$TARGET_ARCH" in
  x86_64) ;;
  arm64|aarch64) TARGET_ARCH="arm64" ;;
  *) echo "Unsupported macOS CEF architecture: ${TARGET_ARCH}" >&2; exit 1 ;;
esac
CEF_ROOT="$(O360_CEF_ARCH="$TARGET_ARCH" "$ROOT/scripts/bootstrap-cef-macos.sh")"
BUILD="$ROOT/cef-host/build-macos-$TARGET_ARCH"
STAGE="$ROOT/src-tauri/cef-runtime"
APP="$STAGE/Office360CEF.app"
FRAMEWORKS="$APP/Contents/Frameworks"

cmake -S "$ROOT/cef-host/macos" -B "$BUILD" -G "Unix Makefiles" \
  -DCMAKE_BUILD_TYPE=Release \
  -DO360_CEF_ARCH="$TARGET_ARCH" \
  -DCEF_ROOT="$CEF_ROOT" \
  -DUSE_SANDBOX=OFF
cmake --build "$BUILD" --config Release --parallel

rm -rf "$STAGE"
mkdir -p "$FRAMEWORKS" "$APP/Contents/MacOS" "$APP/Contents/Resources"

# Wrap the SDK framework the same way CEF's COPY_MAC_FRAMEWORK does.
FRAMEWORK_DIR="$FRAMEWORKS/Chromium Embedded Framework.framework"
mkdir -p "$FRAMEWORK_DIR/Versions"
cp -R "$CEF_ROOT/Release/Chromium Embedded Framework.framework" "$FRAMEWORK_DIR/Versions/A"
(
  cd "$FRAMEWORK_DIR"
  ln -sfn "Versions/A/Chromium Embedded Framework" "Chromium Embedded Framework"
  ln -sfn "Versions/A/Libraries" "Libraries"
  ln -sfn "Versions/A/Resources" "Resources"
  cd Versions
  ln -sfn "A" "Current"
)

HELPER_NAMES=(
  "Office360CEF Helper"
  "Office360CEF Helper (Alerts)"
  "Office360CEF Helper (GPU)"
  "Office360CEF Helper (Plugin)"
  "Office360CEF Helper (Renderer)"
)
for name in "${HELPER_NAMES[@]}"; do
  src="$BUILD/out/${name}.app"
  if [[ ! -d "$src" ]]; then
    echo "Missing helper bundle: $src" >&2
    exit 1
  fi
  cp -R "$src" "$FRAMEWORKS/${name}.app"
done

cp "$BUILD/out/liboffice360_cef_host.dylib" "$STAGE/liboffice360_cef_host.dylib"

MAIN_APP="$BUILD/out/Office360CEF.app"
if [[ ! -x "$MAIN_APP/Contents/MacOS/Office360CEF" ]]; then
  echo "Office360CEF main executable missing (Mach-O required, not a shell stub)" >&2
  exit 1
fi
if ! file "$MAIN_APP/Contents/MacOS/Office360CEF" | grep -q 'Mach-O'; then
  echo "Office360CEF main is not Mach-O" >&2
  exit 1
fi
cp "$MAIN_APP/Contents/MacOS/Office360CEF" "$APP/Contents/MacOS/Office360CEF"
chmod +x "$APP/Contents/MacOS/Office360CEF"
if [[ -f "$MAIN_APP/Contents/Info.plist" ]]; then
  cp "$MAIN_APP/Contents/Info.plist" "$APP/Contents/Info.plist"
else
  cp "$ROOT/cef-host/macos/app-Info.plist.in" "$APP/Contents/Info.plist"
fi

if [[ ! -f "$STAGE/liboffice360_cef_host.dylib" ]]; then
  echo "CEF host dylib missing" >&2
  exit 1
fi
if [[ ! -x "$FRAMEWORKS/Office360CEF Helper.app/Contents/MacOS/Office360CEF Helper" ]]; then
  echo "CEF helper missing" >&2
  exit 1
fi

# Ad-hoc sign is required for local helper spawn; not notarization.
if command -v codesign >/dev/null 2>&1; then
  codesign --force --sign - --timestamp=none "$STAGE/liboffice360_cef_host.dylib" >/dev/null
  codesign --force --sign - --timestamp=none --deep "$APP" >/dev/null
fi

printf '%s\n' "$STAGE"
