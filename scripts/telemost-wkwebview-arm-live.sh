#!/usr/bin/env bash
# Apple Silicon live helper for the Telemost child-WKWebView POC.
# Does not declare PASS. Visual remote A/V confirmation is required.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOG_DIR="$ROOT/artifacts"
LOG_FILE="$LOG_DIR/telemost-wkwebview-arm-live.log"
MARKER='\[telemost-wk-poc\]'

usage() {
  cat <<EOF
Usage:
  bash scripts/telemost-wkwebview-arm-live.sh           # install check + tauri dev + log capture
  bash scripts/telemost-wkwebview-arm-live.sh logs       # print captured [telemost-wk-poc] lines
  npm run telemost:wk:arm-live

Prerequisites (run on Apple Silicon):
  npm install
  rustup target add aarch64-apple-darwin

Live gate: LOGIN → SESSION RESTORED → PREJOIN → JOIN → REMOTE VIDEO → REMOTE AUDIO
Do not treat compile success as WKWebView PASS.
EOF
}

require_arm_mac() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "This live helper must run on macOS." >&2
    exit 1
  fi
  if [[ "$(uname -m)" != "arm64" ]]; then
    echo "This live helper must run on Apple Silicon (uname -m=arm64). Got: $(uname -m)" >&2
    exit 1
  fi
}

require_tools() {
  command -v npm >/dev/null || { echo "npm is required. Install Node.js first." >&2; exit 1; }
  command -v cargo >/dev/null || { echo "cargo is required. Install Rust first." >&2; exit 1; }
  if [[ ! -d "$ROOT/node_modules" ]]; then
    echo "node_modules is missing. Run: npm install" >&2
    exit 1
  fi
}

print_permissions() {
  cat <<EOF
Permissions expected during live test:
  CAMERA: NSCameraUsageDescription + com.apple.security.device.camera
  MIC:    NSMicrophoneUsageDescription + com.apple.security.device.audio-input
  OTHER:  com.apple.security.network.client, WebKit JIT entitlements
  NOT IN SCOPE: screen recording / ScreenCaptureKit

macOS may prompt for Camera and Microphone on first getUserMedia.
EOF
}

show_logs() {
  if [[ ! -f "$LOG_FILE" ]]; then
    echo "No captured log yet: $LOG_FILE" >&2
    echo "Run: npm run telemost:wk:arm-live" >&2
    exit 1
  fi
  echo "=== $LOG_FILE ([telemost-wk-poc]) ==="
  grep -E "$MARKER" "$LOG_FILE" || echo "(no [telemost-wk-poc] markers yet)"
}

run_live() {
  require_arm_mac
  require_tools
  mkdir -p "$LOG_DIR"
  : >"$LOG_FILE"
  print_permissions
  echo
  echo "BUILD/RUN: npm run tauri dev"
  echo "LOG FILE:  $LOG_FILE"
  echo "LOG TAIL:  bash scripts/telemost-wkwebview-arm-live.sh logs"
  echo "OPEN:      Office360 → Яндекс Телемост → Подключиться → real /j/... URL"
  echo
  export RUST_LOG="${RUST_LOG:-info}"
  npm run tauri dev 2>&1 | tee "$LOG_FILE"
}

case "${1:-run}" in
  -h|--help|help) usage ;;
  logs|log) show_logs ;;
  run) run_live ;;
  *) usage >&2; exit 1 ;;
esac
