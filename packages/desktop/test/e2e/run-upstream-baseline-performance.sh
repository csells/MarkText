#!/usr/bin/env bash
set -euo pipefail

PINNED_BASELINE="43bd8b77795fb27b1a9512737c000f7362031ea0"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "The upstream baseline performance runner is macOS-only." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
RUNNER_LIBRARY="${SCRIPT_DIR}/helpers/upstreamBaselinePerformanceRunner.sh"
source "${RUNNER_LIBRARY}"
HARNESS_COMMIT="$(git -C "${REPO_ROOT}" rev-parse --verify HEAD)"
if ! git -C "${REPO_ROOT}" diff --quiet ||
   ! git -C "${REPO_ROOT}" diff --cached --quiet ||
   [[ -n "$(git -C "${REPO_ROOT}" ls-files --others --exclude-standard)" ]]; then
  echo "Upstream performance evidence requires a clean harness checkout." >&2
  exit 1
fi
NODE_BIN_DIR="${MARKTEXT_NODE_BIN_DIR:-/opt/homebrew/opt/node@22/bin}"
if [[ -d "${NODE_BIN_DIR}" ]]; then
  export PATH="${NODE_BIN_DIR}:${PATH}"
fi

MODE="${MARKTEXT_UPSTREAM_MODE:-smoke}"
PLAYWRIGHT_ARGS=()
for argument in "$@"; do
  case "${argument}" in
    --smoke) MODE="smoke" ;;
    --ratification) MODE="ratification" ;;
    *) PLAYWRIGHT_ARGS+=("${argument}") ;;
  esac
done

case "${MODE}" in
  smoke)
    EVIDENCE_CLASS="smoke-non-ratifying"
    WARMUP_SAMPLES="${MARKTEXT_UPSTREAM_SMOKE_WARMUP:-1}"
    MEASURED_SAMPLES="${MARKTEXT_UPSTREAM_SMOKE_MEASURED:-2}"
    RUN_ID="${MARKTEXT_UPSTREAM_RUN_ID:-upstream-smoke-${PINNED_BASELINE:0:12}-$(date -u +%Y%m%dT%H%M%SZ)}"
    OUTPUT="${MARKTEXT_UPSTREAM_OUTPUT:-${TMPDIR:-/tmp}/${RUN_ID}.json}"
    ;;
  ratification)
    if [[ "${MARKTEXT_UPSTREAM_RATIFICATION:-0}" != "1" ]]; then
      echo "Ratification is an hour-scale 20/200 run." >&2
      echo "Set MARKTEXT_UPSTREAM_RATIFICATION=1 and pass --ratification explicitly." >&2
      exit 1
    fi
    EVIDENCE_CLASS="ratification"
    WARMUP_SAMPLES="20"
    MEASURED_SAMPLES="200"
    RUN_ID="${MARKTEXT_UPSTREAM_RUN_ID:-upstream-baseline-${PINNED_BASELINE:0:12}}"
    OUTPUT="${MARKTEXT_UPSTREAM_OUTPUT:-${REPO_ROOT}/specs/baselines/runs/performance/${RUN_ID}.json}"
    ;;
  *)
    echo "Unknown upstream performance mode: ${MODE}" >&2
    exit 1
    ;;
esac

if ! [[ "${WARMUP_SAMPLES}" =~ ^[1-9][0-9]*$ ]] ||
   ! [[ "${MEASURED_SAMPLES}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Smoke sample counts must be positive integers." >&2
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

case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *)
    echo "Unsupported macOS architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

git -C "${REPO_ROOT}" rev-parse --verify "${PINNED_BASELINE}^{commit}" >/dev/null

RUN_TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/marktext-upstream-build-XXXXXX")"
UPSTREAM_WORKTREE="${RUN_TEMP_ROOT}/worktree"
TOOL_SHIM_DIR="${RUN_TEMP_ROOT}/tools"
MOUNTPOINT="${RUN_TEMP_ROOT}/mounted-dmg"
mkdir -p "${TOOL_SHIM_DIR}" "${MOUNTPOINT}"
MOUNTED=0
WORKTREE_ADDED=0

cleanup() {
  if [[ "${MOUNTED}" == "1" ]]; then
    hdiutil detach "${MOUNTPOINT}" -quiet || true
  fi
  if [[ "${WORKTREE_ADDED}" == "1" ]]; then
    git -C "${REPO_ROOT}" worktree remove --force "${UPSTREAM_WORKTREE}" || true
  fi
  rm -f "${TOOL_SHIM_DIR}/pnpm" "${TOOL_SHIM_DIR}/pnpx"
  rmdir "${MOUNTPOINT}" "${TOOL_SHIM_DIR}" "${RUN_TEMP_ROOT}" 2>/dev/null || true
}
trap cleanup EXIT

echo "[1/6] creating detached upstream worktree at ${PINNED_BASELINE}"
git -C "${REPO_ROOT}" worktree add --detach "${UPSTREAM_WORKTREE}" "${PINNED_BASELINE}"
WORKTREE_ADDED=1
WORKTREE_HEAD="$(git -C "${UPSTREAM_WORKTREE}" rev-parse --verify HEAD)"
if [[ "${WORKTREE_HEAD}" != "${PINNED_BASELINE}" ]]; then
  echo "Detached worktree resolved the wrong commit: ${WORKTREE_HEAD}" >&2
  exit 1
fi

echo "[2/6] installing the pinned lockfile in the detached worktree"
corepack enable --install-directory "${TOOL_SHIM_DIR}" pnpm
export PATH="${TOOL_SHIM_DIR}:${PATH}"
PNPM=(pnpm)
(
  cd "${UPSTREAM_WORKTREE}"
  "${PNPM[@]}" install --frozen-lockfile
)

PACKAGE_VERSION="$(node -p \
  "require('${UPSTREAM_WORKTREE}/packages/desktop/package.json').version")"
PACKAGE_MANAGER="$(node -p \
  "require('${UPSTREAM_WORKTREE}/package.json').packageManager")"
NODE_VERSION="$(node --version)"
LOCKFILE_SHA256="$(shasum -a 256 "${UPSTREAM_WORKTREE}/pnpm-lock.yaml" | awk '{print $1}')"

echo "[3/6] building the exact upstream production package for ${ARCH}"
(
  cd "${UPSTREAM_WORKTREE}"
  "${PNPM[@]}" --filter marktext "build:mac:${ARCH}"
)
DMG="${UPSTREAM_WORKTREE}/dist/marktext-mac-${ARCH}-${PACKAGE_VERSION}.dmg"
if [[ ! -f "${DMG}" ]]; then
  echo "Exact upstream DMG is missing: ${DMG}" >&2
  exit 1
fi
if ! git -C "${UPSTREAM_WORKTREE}" diff --quiet ||
   ! git -C "${UPSTREAM_WORKTREE}" diff --cached --quiet ||
   [[ -n "$(git -C "${UPSTREAM_WORKTREE}" ls-files --others --exclude-standard)" ]]; then
  echo "The upstream build mutated tracked or unignored source files." >&2
  exit 1
fi

echo "[4/6] hashing and mounting the exact upstream package"
PACKAGE_SHA256="$(shasum -a 256 "${DMG}" | awk '{print $1}')"
hdiutil attach "${DMG}" -nobrowse -readonly -mountpoint "${MOUNTPOINT}" >/dev/null
MOUNTED=1
APP_BINARY="${MOUNTPOINT}/marktext.app/Contents/MacOS/marktext"
if [[ ! -x "${APP_BINARY}" ]]; then
  echo "Upstream executable is missing inside the DMG: ${APP_BINARY}" >&2
  exit 1
fi
EXECUTABLE_SHA256="$(shasum -a 256 "${APP_BINARY}" | awk '{print $1}')"

PRODUCER_FILE="${SCRIPT_DIR}/upstream-baseline-performance.spec.ts"
RAW_RUN_FILE="${SCRIPT_DIR}/helpers/upstreamBaselinePerformanceRawRun.ts"
ENVIRONMENT_FILE="${SCRIPT_DIR}/helpers/upstreamBaselineEnvironment.ts"
CONFIG_FILE="${SCRIPT_DIR}/playwright.upstream-baseline-performance.config.ts"
PROBE_FILE="${SCRIPT_DIR}/helpers/upstreamBaselineInputProbe.ts"
HIDDEN_POLICY_FILE="${SCRIPT_DIR}/helpers/upstreamBaselineHiddenPolicy.ts"
LIFECYCLE_CLEANUP_FILE="${SCRIPT_DIR}/helpers/upstreamBaselineLifecycleCleanup.ts"
SAMPLE_LIFECYCLE_FILE="${SCRIPT_DIR}/helpers/performanceSampleLifecycle.ts"
CHROMIUM_POLICY_FILE="${SCRIPT_DIR}/helpers/performanceChromiumLaunchPolicy.ts"
PRESENTATION_CHECKPOINT_FILE="${SCRIPT_DIR}/helpers/performancePresentationCheckpoint.ts"
PRODUCER_SHA256="$(
  {
    for producer_part in \
      "${PRODUCER_FILE}" "${RAW_RUN_FILE}" "${ENVIRONMENT_FILE}" \
      "${CONFIG_FILE}" "${HIDDEN_POLICY_FILE}" "${LIFECYCLE_CLEANUP_FILE}" \
      "${SAMPLE_LIFECYCLE_FILE}" "${CHROMIUM_POLICY_FILE}" \
      "${PRESENTATION_CHECKPOINT_FILE}"; do
      shasum -a 256 "${producer_part}" | awk '{print $1}'
    done
  } | shasum -a 256 | awk '{print $1}'
)"
PROBE_SHA256="$(shasum -a 256 "${PROBE_FILE}" | awk '{print $1}')"
LAUNCHER_SHA256="$({
  shasum -a 256 "${BASH_SOURCE[0]}" | awk '{print $1}'
  shasum -a 256 "${RUNNER_LIBRARY}" | awk '{print $1}'
} | shasum -a 256 | awk '{print $1}')"
PLAYWRIGHT_VERSION="$(
  cd "${REPO_ROOT}/packages/desktop"
  node -p "require('@playwright/test/package.json').version"
)"

echo "[5/6] verified hidden/unfocused external instrumentation"
echo "mode=${EVIDENCE_CLASS} samples=${WARMUP_SAMPLES}/${MEASURED_SAMPLES}"
echo "output=${OUTPUT}"
TOTAL_SAMPLES="$((5 * (WARMUP_SAMPLES + MEASURED_SAMPLES)))"
echo "[0/${TOTAL_SAMPLES}] starting five-document upstream browser-boundary run"

cd "${REPO_ROOT}/packages/desktop"
export MARKTEXT_UPSTREAM_PACKAGED_APP="${MOUNTPOINT}/marktext.app"
export MARKTEXT_UPSTREAM_OUTPUT="${OUTPUT}"
export MARKTEXT_UPSTREAM_RUN_ID="${RUN_ID}"
export MARKTEXT_UPSTREAM_EVIDENCE_CLASS="${EVIDENCE_CLASS}"
export MARKTEXT_UPSTREAM_WARMUP_SAMPLES="${WARMUP_SAMPLES}"
export MARKTEXT_UPSTREAM_MEASURED_SAMPLES="${MEASURED_SAMPLES}"
export MARKTEXT_UPSTREAM_BUILD_COMMIT="${WORKTREE_HEAD}"
export MARKTEXT_UPSTREAM_WORKTREE_HEAD="${WORKTREE_HEAD}"
export MARKTEXT_UPSTREAM_WORKTREE_CLEAN="true"
export MARKTEXT_UPSTREAM_HARNESS_COMMIT="${HARNESS_COMMIT}"
export MARKTEXT_UPSTREAM_PACKAGE_SHA256="${PACKAGE_SHA256}"
export MARKTEXT_UPSTREAM_EXECUTABLE_SHA256="${EXECUTABLE_SHA256}"
export MARKTEXT_UPSTREAM_PACKAGE_VERSION="${PACKAGE_VERSION}"
export MARKTEXT_UPSTREAM_PACKAGE_MANAGER="${PACKAGE_MANAGER}"
export MARKTEXT_UPSTREAM_NODE_VERSION="${NODE_VERSION}"
export MARKTEXT_UPSTREAM_PLAYWRIGHT_VERSION="${PLAYWRIGHT_VERSION}"
export MARKTEXT_UPSTREAM_LOCKFILE_SHA256="${LOCKFILE_SHA256}"
export MARKTEXT_UPSTREAM_PRODUCER_SHA256="${PRODUCER_SHA256}"
export MARKTEXT_UPSTREAM_PROBE_SHA256="${PROBE_SHA256}"
export MARKTEXT_UPSTREAM_LAUNCHER_SHA256="${LAUNCHER_SHA256}"

PLAYWRIGHT_CONFIG="test/e2e/playwright.upstream-baseline-performance.config.ts"
if [[ "${#PLAYWRIGHT_ARGS[@]}" -eq 0 ]]; then
  run_upstream_baseline_playwright \
    "${OUTPUT}" "${PNPM[0]}" "${PLAYWRIGHT_CONFIG}"
else
  run_upstream_baseline_playwright \
    "${OUTPUT}" "${PNPM[0]}" "${PLAYWRIGHT_CONFIG}" "${PLAYWRIGHT_ARGS[@]}"
fi

echo "[6/6] upstream performance output written without replacement: ${OUTPUT}"
