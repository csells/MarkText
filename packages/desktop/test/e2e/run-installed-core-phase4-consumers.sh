#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "run-installed-core-phase4-consumers.sh drives a macOS DMG and is macOS-only." >&2
  exit 1
fi
if [[ "$#" -ne 0 ]]; then
  echo "The installed Core Phase 4 evidence denominator accepts no optional test arguments." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
RUN_RECORD_PATH="${MARKTEXT_PHASE4_RUN_RECORD:-}"
if [[ -z "${RUN_RECORD_PATH}" ]]; then
  echo "MARKTEXT_PHASE4_RUN_RECORD must name the create-only evidence JSON." >&2
  exit 1
fi
if [[ "${RUN_RECORD_PATH}" != /* ]]; then
  RUN_RECORD_PATH="${REPO_ROOT}/${RUN_RECORD_PATH}"
fi
RUN_RECORD_PARENT="$(cd "$(dirname "${RUN_RECORD_PATH}")" && pwd -P)"
RUN_RECORD_PATH="${RUN_RECORD_PARENT}/$(basename "${RUN_RECORD_PATH}")"
case "${RUN_RECORD_PATH}" in
  "${REPO_ROOT}"/*.json) ;;
  *)
    echo "Installed Core Phase 4 evidence must be a JSON file inside the repository." >&2
    exit 1
    ;;
esac

RUN_RECORD_STEM="${RUN_RECORD_PATH%.json}"
PLAYWRIGHT_EVIDENCE_PATH="${RUN_RECORD_STEM}.playwright.json"
RUNNER_LOG_EVIDENCE_PATH="${RUN_RECORD_STEM}.log"
for target in \
  "${RUN_RECORD_PATH}" \
  "${PLAYWRIGHT_EVIDENCE_PATH}" \
  "${RUNNER_LOG_EVIDENCE_PATH}"
do
  if [[ -e "${target}" || -L "${target}" ]]; then
    echo "Installed Core Phase 4 evidence target already exists: ${target}" >&2
    exit 1
  fi
done

if ! git -C "${REPO_ROOT}" diff --quiet ||
   ! git -C "${REPO_ROOT}" diff --cached --quiet ||
   [[ -n "$(git -C "${REPO_ROOT}" ls-files --others --exclude-standard)" ]]
then
  echo "Installed Core Phase 4 evidence requires one exact clean checkout." >&2
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

NODE_PATH_PREFIX="/opt/homebrew/opt/node@22/bin"
PNPM=(corepack pnpm)
TOOL_SHIM_DIR="$(mktemp -d "${TMPDIR:-/tmp}/marktext-phase4-tools-XXXXXX")"
RUN_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/marktext-phase4-run-XXXXXX")"
MOUNTPOINT="${RUN_ROOT}/mount"
REPORT_DIR="${RUN_ROOT}/report"
RAW_REPORT_PATH="${REPORT_DIR}/playwright-report.json"
RAW_LOG_PATH="${RUN_ROOT}/runner.log"
mkdir "${MOUNTPOINT}" "${REPORT_DIR}"

MOUNTED=0
ADMITTED=0
PUBLISHED_REPORT=0
PUBLISHED_LOG=0
DMG=""
APP_BINARY=""

phase4_owned_pids() {
  if [[ -z "${APP_BINARY}" ]]; then return 0; fi
  ps -axo pid=,command= | awk \
    -v prefix="${MOUNTPOINT}/marktext.app/" \
    'index($2, prefix) == 1 { print $1 }'
}

terminate_phase4_processes() {
  local pids
  pids="$(phase4_owned_pids)"
  if [[ -z "${pids}" ]]; then return 0; fi
  while IFS= read -r pid; do
    if [[ -n "${pid}" ]]; then kill -TERM "${pid}" 2>/dev/null || true; fi
  done <<< "${pids}"
  local attempts_remaining=50
  while [[ "${attempts_remaining}" -gt 0 ]]; do
    if [[ -z "$(phase4_owned_pids)" ]]; then return 0; fi
    sleep 0.1
    attempts_remaining=$((attempts_remaining - 1))
  done
  pids="$(phase4_owned_pids)"
  while IFS= read -r pid; do
    if [[ -n "${pid}" ]]; then kill -KILL "${pid}" 2>/dev/null || true; fi
  done <<< "${pids}"
  attempts_remaining=50
  while [[ "${attempts_remaining}" -gt 0 ]]; do
    if [[ -z "$(phase4_owned_pids)" ]]; then return 0; fi
    sleep 0.1
    attempts_remaining=$((attempts_remaining - 1))
  done
  return 1
}

cleanup_failure() {
  local status=$?
  trap - EXIT
  terminate_phase4_processes || true
  if [[ "${MOUNTED}" -eq 1 ]]; then
    hdiutil detach "${MOUNTPOINT}" -quiet ||
      hdiutil detach "${MOUNTPOINT}" -force -quiet || true
  fi
  if [[ "${ADMITTED}" -eq 0 ]]; then
    if [[ "${PUBLISHED_REPORT}" -eq 1 ]]; then rm -f "${PLAYWRIGHT_EVIDENCE_PATH}"; fi
    if [[ "${PUBLISHED_LOG}" -eq 1 ]]; then rm -f "${RUNNER_LOG_EVIDENCE_PATH}"; fi
    rm -f "${RUN_RECORD_PATH}"
  fi
  if [[ -n "${DMG}" ]]; then rm -f "${DMG}"; fi
  rm -f "${RAW_REPORT_PATH}" "${RAW_LOG_PATH}"
  rmdir "${REPORT_DIR}" 2>/dev/null || true
  rmdir "${MOUNTPOINT}" 2>/dev/null || true
  rmdir "${RUN_ROOT}" 2>/dev/null || true
  rm -f "${TOOL_SHIM_DIR}/pnpm" "${TOOL_SHIM_DIR}/pnpx"
  rmdir "${TOOL_SHIM_DIR}" 2>/dev/null || true
  exit "${status}"
}
trap cleanup_failure EXIT

PATH="${NODE_PATH_PREFIX}:${PATH}" corepack enable \
  --install-directory "${TOOL_SHIM_DIR}" pnpm
export PATH="${TOOL_SHIM_DIR}:${NODE_PATH_PREFIX}:${PATH}"

EXPECTED_COMMIT="$(git -C "${REPO_ROOT}" rev-parse --verify HEAD)"
VERSION="$(node -p "require('${REPO_ROOT}/packages/desktop/package.json').version")"
DMG="${REPO_ROOT}/dist/marktext-mac-${ARCH}-${VERSION}.dmg"
rm -f "${DMG}"

{
  echo "phase4 buildCommit=${EXPECTED_COMMIT}"
  echo "phase4 denominator=33 retries=0 workers=1"
  (
    cd "${REPO_ROOT}"
    "${PNPM[@]}" --filter marktext "build:mac:${ARCH}"
  )
} 2>&1 | tee "${RAW_LOG_PATH}"

if [[ ! -f "${DMG}" ]]; then
  echo "Exact Phase 4 DMG build output is missing: ${DMG}" >&2
  exit 1
fi
PACKAGE_SHA256="$(shasum -a 256 "${DMG}" | awk '{ print $1 }')"

hdiutil attach "${DMG}" -nobrowse -readonly -mountpoint "${MOUNTPOINT}" >/dev/null
MOUNTED=1
APP_BINARY="${MOUNTPOINT}/marktext.app/Contents/MacOS/marktext"
if [[ ! -x "${APP_BINARY}" ]]; then
  echo "MarkText binary is missing inside the mounted Phase 4 DMG: ${APP_BINARY}" >&2
  exit 1
fi
EXECUTABLE_SHA256="$(shasum -a 256 "${APP_BINARY}" | awk '{ print $1 }')"

(
  cd "${REPO_ROOT}/packages/desktop"
  PLAYWRIGHT_JSON_OUTPUT_FILE="${RAW_REPORT_PATH}" \
  MARKTEXT_PACKAGED_APP="${APP_BINARY}" \
  MARKTEXT_EXPECTED_COMMIT="${EXPECTED_COMMIT}" \
    "${PNPM[@]}" exec playwright test \
    --config test/e2e/playwright.installed-core-phase4-consumers.config.ts \
    --project=installed-core-phase4-consumers \
    --workers=1 \
    --retries=0 \
    --reporter=line,json
) 2>&1 | tee -a "${RAW_LOG_PATH}"

if [[ ! -s "${RAW_REPORT_PATH}" ]]; then
  echo "Installed Core Phase 4 Playwright report is absent." >&2
  exit 1
fi
APPLICATION_PROCESS_COUNT="$(phase4_owned_pids | awk 'NF { count += 1 } END { print count + 0 }')"
if [[ "${APPLICATION_PROCESS_COUNT}" -ne 0 ]]; then
  echo "Installed Core Phase 4 tests leaked ${APPLICATION_PROCESS_COUNT} application process(es)." >&2
  exit 1
fi

hdiutil detach "${MOUNTPOINT}" -quiet
MOUNTED=0
rmdir "${MOUNTPOINT}"
rm -f "${DMG}"
if [[ -e "${DMG}" ]]; then
  echo "Installed Core Phase 4 package cleanup failed: ${DMG}" >&2
  exit 1
fi

echo "phase4 cleanup applicationProcessCount=0 mountDetached=true packageRemoved=true" \
  >> "${RAW_LOG_PATH}"

PATH="${NODE_PATH_PREFIX}:${PATH}" \
  "${REPO_ROOT}/node_modules/.bin/tsx" \
  "${REPO_ROOT}/scripts/installedCorePhase4Evidence.ts" \
  --publish-artifact "${RAW_REPORT_PATH}" "${PLAYWRIGHT_EVIDENCE_PATH}"
PUBLISHED_REPORT=1
PATH="${NODE_PATH_PREFIX}:${PATH}" \
  "${REPO_ROOT}/node_modules/.bin/tsx" \
  "${REPO_ROOT}/scripts/installedCorePhase4Evidence.ts" \
  --publish-artifact "${RAW_LOG_PATH}" "${RUNNER_LOG_EVIDENCE_PATH}"
PUBLISHED_LOG=1

rm -f "${RAW_REPORT_PATH}" "${RAW_LOG_PATH}"
rmdir "${REPORT_DIR}"
rmdir "${RUN_ROOT}"
rm -f "${TOOL_SHIM_DIR}/pnpm" "${TOOL_SHIM_DIR}/pnpx"
rmdir "${TOOL_SHIM_DIR}"

if [[ -d "${RUN_ROOT}" || -d "${TOOL_SHIM_DIR}" ]]; then
  echo "Installed Core Phase 4 temporary-path cleanup failed." >&2
  exit 1
fi

RECORDED_AT="$(node -p 'new Date().toISOString()')"
export MARKTEXT_PHASE4_BUILD_COMMIT="${EXPECTED_COMMIT}"
export MARKTEXT_PHASE4_HARNESS_COMMIT="${EXPECTED_COMMIT}"
export MARKTEXT_PHASE4_RECORDED_AT="${RECORDED_AT}"
MARKTEXT_PHASE4_PACKAGE_NAME="$(basename "${DMG}")"
export MARKTEXT_PHASE4_PACKAGE_NAME
export MARKTEXT_PHASE4_PACKAGE_SHA256="${PACKAGE_SHA256}"
export MARKTEXT_PHASE4_EXECUTABLE_PATH="marktext.app/Contents/MacOS/marktext"
export MARKTEXT_PHASE4_EXECUTABLE_SHA256="${EXECUTABLE_SHA256}"
export MARKTEXT_PHASE4_PLATFORM="darwin"
export MARKTEXT_PHASE4_ARCH="${ARCH}"
MARKTEXT_PHASE4_PLATFORM_RELEASE="$(uname -r)"
export MARKTEXT_PHASE4_PLATFORM_RELEASE
export MARKTEXT_PHASE4_CLEANUP_RESULT="pass"
export MARKTEXT_PHASE4_APPLICATION_PROCESS_COUNT="0"
export MARKTEXT_PHASE4_MOUNT_DETACHED="true"
export MARKTEXT_PHASE4_PACKAGE_REMOVED="true"
export MARKTEXT_PHASE4_TEMPORARY_PATHS_REMOVED="true"
export MARKTEXT_PHASE4_PLAYWRIGHT_REPORT_PATH="${PLAYWRIGHT_EVIDENCE_PATH#"${REPO_ROOT}/"}"
export MARKTEXT_PHASE4_RUNNER_LOG_PATH="${RUNNER_LOG_EVIDENCE_PATH#"${REPO_ROOT}/"}"

PATH="${NODE_PATH_PREFIX}:${PATH}" \
  "${REPO_ROOT}/node_modules/.bin/tsx" \
  "${REPO_ROOT}/scripts/installedCorePhase4Evidence.ts" \
  --write "${RUN_RECORD_PATH}"

ADMITTED=1
trap - EXIT
echo "Installed Core Phase 4 evidence admitted: ${RUN_RECORD_PATH}"
