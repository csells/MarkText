#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "run-installed-core-performance.sh drives a macOS DMG and is macOS-only." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
PNPM=(corepack pnpm)
TOOL_SHIM_DIR="$(mktemp -d "${TMPDIR:-/tmp}/marktext-performance-tools-XXXXXX")"

corepack enable --install-directory "${TOOL_SHIM_DIR}" pnpm
export PATH="${TOOL_SHIM_DIR}:${PATH}"

cleanup_tools() {
  rm -f "${TOOL_SHIM_DIR}/pnpm" "${TOOL_SHIM_DIR}/pnpx"
  rmdir "${TOOL_SHIM_DIR}" 2>/dev/null || true
}
trap cleanup_tools EXIT

if [[ "${MARKTEXT_ALLOW_DIRTY_PACKAGE:-0}" != "1" ]]; then
  if ! git -C "${REPO_ROOT}" diff --quiet ||
     ! git -C "${REPO_ROOT}" diff --cached --quiet ||
     [[ -n "$(git -C "${REPO_ROOT}" ls-files --others --exclude-standard)" ]]; then
    echo "Installed performance evidence requires a clean checkout." >&2
    echo "Set MARKTEXT_ALLOW_DIRTY_PACKAGE=1 only for non-release development runs." >&2
    exit 1
  fi
fi

case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *)
    echo "Unsupported macOS architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

VERSION="$(PATH="/opt/homebrew/opt/node@22/bin:${PATH}" node -p \
  "require('${REPO_ROOT}/packages/desktop/package.json').version")"
EXPECTED_COMMIT="$(git -C "${REPO_ROOT}" rev-parse --verify HEAD)"
DMG="${REPO_ROOT}/dist/marktext-mac-${ARCH}-${VERSION}.dmg"
RUN_ID="${MARKTEXT_PERFORMANCE_RUN_ID:-core-candidate-${EXPECTED_COMMIT:0:12}}"
OUTPUT="${MARKTEXT_PERFORMANCE_OUTPUT:-${REPO_ROOT}/specs/baselines/runs/performance/${RUN_ID}.json}"

if [[ -e "${OUTPUT}" ]]; then
  echo "Refusing to replace existing performance evidence: ${OUTPUT}" >&2
  exit 1
fi

rm -f "${DMG}"
(
  cd "${REPO_ROOT}"
  PATH="/opt/homebrew/opt/node@22/bin:${PATH}" \
    "${PNPM[@]}" --filter marktext "build:mac:${ARCH}"
)
if [[ ! -f "${DMG}" ]]; then
  echo "Exact DMG build output is missing: ${DMG}" >&2
  exit 1
fi

MOUNTPOINT="$(mktemp -d "${TMPDIR:-/tmp}/marktext-core-performance-XXXXXX")"
cleanup() {
  hdiutil detach "${MOUNTPOINT}" -quiet || true
  rmdir "${MOUNTPOINT}" 2>/dev/null || true
  cleanup_tools
}
trap cleanup EXIT

hdiutil attach "${DMG}" -nobrowse -readonly -mountpoint "${MOUNTPOINT}" >/dev/null
APP_BINARY="${MOUNTPOINT}/marktext.app/Contents/MacOS/marktext"
if [[ ! -x "${APP_BINARY}" ]]; then
  echo "MarkText binary is missing inside the mounted DMG: ${APP_BINARY}" >&2
  exit 1
fi

echo "[0/1100] packaged Core performance run ${RUN_ID}"
echo "Writing raw evidence to ${OUTPUT}"
cd "${REPO_ROOT}/packages/desktop"
MARKTEXT_PACKAGED_APP="${APP_BINARY}" \
MARKTEXT_EXPECTED_COMMIT="${EXPECTED_COMMIT}" \
MARKTEXT_PERFORMANCE_RUN_ID="${RUN_ID}" \
MARKTEXT_PERFORMANCE_OUTPUT="${OUTPUT}" \
PATH="/opt/homebrew/opt/node@22/bin:${PATH}" \
  "${PNPM[@]}" exec playwright test \
  --config test/e2e/playwright.installed-core-performance.config.ts \
  --workers=1 --reporter=line "$@"
