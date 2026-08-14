#!/usr/bin/env bash
# Download and verify the pinned official CEF macOS SDK for the requested architecture.
# Does not commit binaries. Destination is gitignored (.deps/).
set -euo pipefail

TARGET_ARCH="${O360_CEF_ARCH:-x86_64}"
case "$TARGET_ARCH" in
  x86_64)
    DIST_ARCH="macosx64"
    EXPECTED_SHA1="07a57d6c6d8d1905b9e7931bbae476bec9883323"
    EXPECTED_SHA256="8820c8bdc3fbd96193363e70d64e516278e67174c27ddd7c1ca11b6dd5a29507"
    DEFAULT_DEST=".deps/cef-macos"
    ;;
  arm64|aarch64)
    TARGET_ARCH="arm64"
    DIST_ARCH="macosarm64"
    EXPECTED_SHA1="2308eb64da472479215f5e0c23d90b1a37b41421"
    EXPECTED_SHA256="61dd8323155a0b0531d2914f3f545dab101e52a6468fc97d4aed5d37fbbb9446"
    DEFAULT_DEST=".deps/cef-macos-arm64"
    ;;
  *)
    echo "Unsupported macOS CEF architecture: ${TARGET_ARCH}" >&2
    exit 1
    ;;
esac

VERSION="cef_binary_148.0.9+g0d9d52a+chromium-148.0.7778.180_${DIST_ARCH}"
ARCHIVE_NAME="${VERSION}.tar.bz2"
CDN_URL="https://cef-builds.spotifycdn.com/cef_binary_148.0.9%2Bg0d9d52a%2Bchromium-148.0.7778.180_${DIST_ARCH}.tar.bz2"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-${ROOT}/${DEFAULT_DEST}}"
SDK_PATH="${DEST}/sdk/${VERSION}"

if [[ -f "${SDK_PATH}/cmake/FindCEF.cmake" ]]; then
  printf '%s\n' "${SDK_PATH}"
  exit 0
fi

mkdir -p "${DEST}"
ARCHIVE_PATH="${DEST}/${ARCHIVE_NAME}"
if [[ ! -f "${ARCHIVE_PATH}" ]]; then
  curl -L --fail --retry 3 -o "${ARCHIVE_PATH}.partial" "${CDN_URL}"
  mv "${ARCHIVE_PATH}.partial" "${ARCHIVE_PATH}"
fi

actual_sha1="$(shasum -a 1 "${ARCHIVE_PATH}" | awk '{print $1}')"
actual_sha256="$(shasum -a 256 "${ARCHIVE_PATH}" | awk '{print $1}')"
if [[ "${actual_sha1}" != "${EXPECTED_SHA1}" ]]; then
  echo "CEF archive SHA-1 mismatch: ${actual_sha1}" >&2
  exit 1
fi
if [[ "${actual_sha256}" != "${EXPECTED_SHA256}" ]]; then
  echo "CEF archive SHA-256 mismatch: ${actual_sha256}" >&2
  exit 1
fi

mkdir -p "${DEST}/sdk"
tar -xjf "${ARCHIVE_PATH}" -C "${DEST}/sdk"
if [[ ! -f "${SDK_PATH}/cmake/FindCEF.cmake" ]]; then
  echo "CEF SDK extraction failed" >&2
  exit 1
fi

printf '%s\n' "${SDK_PATH}"
