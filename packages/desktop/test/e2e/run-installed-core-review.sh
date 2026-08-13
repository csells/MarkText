#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "run-installed-core-review.sh drives a macOS DMG and is macOS-only." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
PNPM=(corepack pnpm)
TOOL_SHIM_DIR="$(mktemp -d "${TMPDIR:-/tmp}/marktext-installed-tools-XXXXXX")"

# electron-builder discovers the package manager from the workspace and then
# spawns `pnpm` directly. Homebrew's Node distribution installs Corepack but
# does not install a pnpm shim until it is explicitly enabled. Ask Corepack to
# generate the real pnpm launcher in a temporary directory so release evidence
# stays self-contained and never mutates the user's global Corepack state.
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
    echo "Installed release evidence requires a clean checkout." >&2
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

MOUNTPOINT="$(mktemp -d "${TMPDIR:-/tmp}/marktext-installed-core-XXXXXX")"
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

cd "${REPO_ROOT}/packages/desktop"
MARKTEXT_PACKAGED_APP="${APP_BINARY}" \
MARKTEXT_EXPECTED_COMMIT="${EXPECTED_COMMIT}" \
PATH="/opt/homebrew/opt/node@22/bin:${PATH}" \
  "${PNPM[@]}" exec playwright test --config test/e2e/playwright.config.ts \
  --project=installed --workers=1 --reporter=line "$@"
