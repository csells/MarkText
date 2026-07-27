#!/usr/bin/env bash
# Plan 0009 packaged acceptance for the document-core application.
#
# Builds the exact host-architecture macOS distributable from the checked-out
# commit, mounts it read-only at an isolated temporary mountpoint, and runs the
# packaged smoke spec against that mounted app binary with the hidden
# background test policy.
#
# Usage:
#   packages/desktop/test/e2e/run-packaged-smoke.sh [extra playwright args]
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "run-packaged-smoke.sh drives the macOS DMG and is macOS-only." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
PNPM=(npx -y pnpm@10.33.4)

case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *)
    echo "Unsupported macOS architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

VERSION="$(node -p "require('${REPO_ROOT}/packages/desktop/package.json').version")"
EXPECTED_COMMIT="$(cd "${REPO_ROOT}" && git rev-parse --verify HEAD)"
DMG="${REPO_ROOT}/dist/marktext-mac-${ARCH}-${VERSION}.dmg"
rm -f "${DMG}"
(cd "${REPO_ROOT}" && "${PNPM[@]}" run "build:mac:${ARCH}")
if [[ ! -f "${DMG}" ]]; then
  echo "Exact DMG build output is missing: ${DMG}" >&2
  exit 1
fi

MOUNTPOINT="$(mktemp -d "${TMPDIR:-/tmp}/marktext-packaged-smoke-XXXXXX")"
cleanup() {
  hdiutil detach "${MOUNTPOINT}" -quiet || true
  rmdir "${MOUNTPOINT}" 2>/dev/null || true
}
trap cleanup EXIT

hdiutil attach "${DMG}" -nobrowse -readonly -mountpoint "${MOUNTPOINT}" >/dev/null

APP_BINARY="${MOUNTPOINT}/marktext.app/Contents/MacOS/marktext"
if [[ ! -x "${APP_BINARY}" ]]; then
  echo "marktext binary missing inside the mounted DMG: ${APP_BINARY}" >&2
  exit 1
fi

cd "${REPO_ROOT}/packages/desktop"
MARKTEXT_PACKAGED_APP="${APP_BINARY}" \
  MARKTEXT_EXPECTED_COMMIT="${EXPECTED_COMMIT}" \
  MARKTEXT_TEST_BACKGROUND=1 \
  "${PNPM[@]}" exec playwright test --config test/e2e/playwright.config.ts \
  --project=installed packaged-smoke.spec.ts "$@"
