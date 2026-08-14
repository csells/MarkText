#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "run-installed-core-performance.sh drives a macOS DMG and is macOS-only." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
NODE_BIN_DIR="${MARKTEXT_NODE_BIN_DIR:-/opt/homebrew/opt/node@22/bin}"
if [[ -d "${NODE_BIN_DIR}" ]]; then
  export PATH="${NODE_BIN_DIR}:${PATH}"
fi
TOOL_SHIM_DIR="$(mktemp -d "${TMPDIR:-/tmp}/marktext-performance-tools-XXXXXX")"

corepack enable --install-directory "${TOOL_SHIM_DIR}" pnpm
export PATH="${TOOL_SHIM_DIR}:${PATH}"
PNPM=(pnpm)

cleanup_tools() {
  rm -f "${TOOL_SHIM_DIR}/pnpm" "${TOOL_SHIM_DIR}/pnpx"
  rmdir "${TOOL_SHIM_DIR}" 2>/dev/null || true
}
trap cleanup_tools EXIT

if ! git -C "${REPO_ROOT}" diff --quiet ||
   ! git -C "${REPO_ROOT}" diff --cached --quiet ||
   [[ -n "$(git -C "${REPO_ROOT}" ls-files --others --exclude-standard)" ]]; then
  echo "Installed performance evidence requires a clean checkout." >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *)
    echo "Unsupported macOS architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

VERSION="$(node -p \
  "require('${REPO_ROOT}/packages/desktop/package.json').version")"
PACKAGE_MANAGER="$(node -p "require('${REPO_ROOT}/package.json').packageManager")"
NODE_VERSION="$(node --version)"
PLAYWRIGHT_VERSION="$(
  cd "${REPO_ROOT}/packages/desktop"
  node -p "require('@playwright/test/package.json').version"
)"
EXPECTED_COMMIT="$(git -C "${REPO_ROOT}" rev-parse --verify HEAD)"
DMG="${REPO_ROOT}/dist/marktext-mac-${ARCH}-${VERSION}.dmg"
RUN_ID="${MARKTEXT_PERFORMANCE_RUN_ID:-core-candidate-${EXPECTED_COMMIT:0:12}}"
OUTPUT="${MARKTEXT_PERFORMANCE_OUTPUT:-${REPO_ROOT}/specs/baselines/runs/performance/${RUN_ID}.json}"
MODE="${MARKTEXT_CORE_PERFORMANCE_MODE:-smoke}"
case "${MODE}" in
  smoke)
    EVIDENCE_CLASS="smoke-non-ratifying"
    WARMUP_SAMPLES="${MARKTEXT_CORE_SMOKE_WARMUP:-1}"
    MEASURED_SAMPLES="${MARKTEXT_CORE_SMOKE_MEASURED:-2}"
    RUN_ID="${MARKTEXT_PERFORMANCE_RUN_ID:-core-smoke-${EXPECTED_COMMIT:0:12}-$(date -u +%Y%m%dT%H%M%SZ)}"
    OUTPUT="${MARKTEXT_PERFORMANCE_OUTPUT:-${TMPDIR:-/tmp}/${RUN_ID}.json}"
    ;;
  ratification)
    if [[ "${MARKTEXT_CORE_RATIFICATION:-0}" != "1" ]]; then
      echo "Ratification is an hour-scale 20/200 run." >&2
      echo "Set MARKTEXT_CORE_RATIFICATION=1 and MARKTEXT_CORE_PERFORMANCE_MODE=ratification." >&2
      exit 1
    fi
    EVIDENCE_CLASS="ratification"
    WARMUP_SAMPLES="20"
    MEASURED_SAMPLES="200"
    ;;
  *)
    echo "Unknown Core performance mode: ${MODE}" >&2
    exit 1
    ;;
esac
OUTPUT="$(node -e 'console.log(require("node:path").resolve(process.argv[1]))' "${OUTPUT}")"

if ! [[ "${WARMUP_SAMPLES}" =~ ^[1-9][0-9]*$ ]] ||
   ! [[ "${MEASURED_SAMPLES}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Core sample counts must be positive integers." >&2
  exit 1
fi

case "${OUTPUT}" in
  "${REPO_ROOT}/specs/baselines/runs/performance/"*)
    if [[ "${EVIDENCE_CLASS}" != "ratification" ]]; then
      echo "Smoke output cannot enter the ratification evidence directory." >&2
      exit 1
    fi
    ;;
esac

if [[ -e "${OUTPUT}" ]]; then
  echo "Refusing to replace existing performance evidence: ${OUTPUT}" >&2
  exit 1
fi

rm -f "${DMG}"
(
  cd "${REPO_ROOT}"
  "${PNPM[@]}" --filter marktext "build:mac:${ARCH}"
)
if [[ ! -f "${DMG}" ]]; then
  echo "Exact DMG build output is missing: ${DMG}" >&2
  exit 1
fi
if ! git -C "${REPO_ROOT}" diff --quiet ||
   ! git -C "${REPO_ROOT}" diff --cached --quiet ||
   [[ -n "$(git -C "${REPO_ROOT}" ls-files --others --exclude-standard)" ]]; then
  echo "The Core performance build mutated tracked or unignored source files." >&2
  exit 1
fi

PACKAGE_SHA256="$(shasum -a 256 "${DMG}" | awk '{print $1}')"
LOCKFILE_SHA256="$(shasum -a 256 "${REPO_ROOT}/pnpm-lock.yaml" | awk '{print $1}')"

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
EXECUTABLE_SHA256="$(shasum -a 256 "${APP_BINARY}" | awk '{print $1}')"

PRODUCER_SHA256="$(
  {
    for producer_part in \
      "${SCRIPT_DIR}/installed-core-performance.spec.ts" \
      "${SCRIPT_DIR}/helpers/coreAuthorityPerformanceRawRun.ts" \
      "${SCRIPT_DIR}/helpers/coreAuthorityPerformanceReport.ts" \
      "${SCRIPT_DIR}/helpers/performanceSampleLifecycle.ts" \
      "${SCRIPT_DIR}/installedArtifactProvenance.ts" \
      "${SCRIPT_DIR}/playwright.installed-core-performance.config.ts" \
      "${SCRIPT_DIR}/helpers/performanceChromiumLaunchPolicy.ts" \
      "${SCRIPT_DIR}/helpers/performancePresentationCheckpoint.ts"; do
      shasum -a 256 "${producer_part}" | awk '{print $1}'
    done
  } | shasum -a 256 | awk '{print $1}'
)"
PROBE_SHA256="$(
  {
    for probe_part in \
      "${SCRIPT_DIR}/helpers/browserInputEventTrace.ts" \
      "${SCRIPT_DIR}/helpers/inputLatencyTrace.ts"; do
      shasum -a 256 "${probe_part}" | awk '{print $1}'
    done
  } | shasum -a 256 | awk '{print $1}'
)"
LAUNCHER_SHA256="$(shasum -a 256 "${BASH_SOURCE[0]}" | awk '{print $1}')"

TOTAL_SAMPLES="$((5 * (WARMUP_SAMPLES + MEASURED_SAMPLES)))"
echo "[0/${TOTAL_SAMPLES}] packaged Core performance run ${RUN_ID}"
echo "Writing raw evidence to ${OUTPUT}"
cd "${REPO_ROOT}/packages/desktop"
MARKTEXT_PACKAGED_APP="${APP_BINARY}" \
MARKTEXT_EXPECTED_COMMIT="${EXPECTED_COMMIT}" \
MARKTEXT_PERFORMANCE_RUN_ID="${RUN_ID}" \
MARKTEXT_PERFORMANCE_OUTPUT="${OUTPUT}" \
MARKTEXT_CORE_EVIDENCE_CLASS="${EVIDENCE_CLASS}" \
MARKTEXT_CORE_WARMUP_SAMPLES="${WARMUP_SAMPLES}" \
MARKTEXT_CORE_MEASURED_SAMPLES="${MEASURED_SAMPLES}" \
MARKTEXT_CORE_CHECKOUT_HEAD="${EXPECTED_COMMIT}" \
MARKTEXT_CORE_CHECKOUT_CLEAN="true" \
MARKTEXT_CORE_HARNESS_COMMIT="${EXPECTED_COMMIT}" \
MARKTEXT_CORE_PACKAGE_SHA256="${PACKAGE_SHA256}" \
MARKTEXT_CORE_EXECUTABLE_SHA256="${EXECUTABLE_SHA256}" \
MARKTEXT_CORE_PACKAGE_VERSION="${VERSION}" \
MARKTEXT_CORE_PACKAGE_MANAGER="${PACKAGE_MANAGER}" \
MARKTEXT_CORE_NODE_VERSION="${NODE_VERSION}" \
MARKTEXT_CORE_PLAYWRIGHT_VERSION="${PLAYWRIGHT_VERSION}" \
MARKTEXT_CORE_LOCKFILE_SHA256="${LOCKFILE_SHA256}" \
MARKTEXT_CORE_PRODUCER_SHA256="${PRODUCER_SHA256}" \
MARKTEXT_CORE_PROBE_SHA256="${PROBE_SHA256}" \
MARKTEXT_CORE_LAUNCHER_SHA256="${LAUNCHER_SHA256}" \
  "${PNPM[@]}" exec playwright test \
  --config test/e2e/playwright.installed-core-performance.config.ts \
  --workers=1 --reporter=line "$@"
