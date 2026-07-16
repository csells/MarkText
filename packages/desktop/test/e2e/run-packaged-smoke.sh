#!/usr/bin/env bash
# Reproducible driver for packaged-smoke.spec.ts (plan 0006 Wave 7).
#
# Builds the macOS arm64 distributable (or reuses MARKTEXT_DMG if set),
# mounts it read-only at an isolated temporary mountpoint, and runs the
# packaged smoke spec against the mounted app binary with the hidden
# background test policy. Without this runner the spec self-skips, so this
# script is the checked-in path from a clean tree to the packaged-artifact
# proof.
#
# Usage:
#   packages/desktop/test/e2e/run-packaged-smoke.sh [extra playwright args]
#   MARKTEXT_DMG=/path/to/marktext.dmg packages/desktop/test/e2e/run-packaged-smoke.sh
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "run-packaged-smoke.sh drives the macOS DMG and is macOS-only." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
PNPM=(npx -y pnpm@10.33.4)

DMG="${MARKTEXT_DMG:-}"
if [[ -z "${DMG}" ]]; then
  (cd "${REPO_ROOT}" && "${PNPM[@]}" run build:mac:arm64)
  DMG="$(ls -t "${REPO_ROOT}"/dist/*.dmg 2>/dev/null | head -1 || true)"
fi
if [[ -z "${DMG}" || ! -f "${DMG}" ]]; then
  echo "No DMG found; build failed or MARKTEXT_DMG points nowhere." >&2
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
MARKTEXT_PACKAGED_APP="${APP_BINARY}" MARKTEXT_TEST_BACKGROUND=1 \
  "${PNPM[@]}" exec playwright test --config test/e2e/playwright.config.ts \
  packaged-smoke.spec.ts "$@"
