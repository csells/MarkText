#!/usr/bin/env bash

PERFORMANCE_DISPLAY_SLEEP_POLICY="runner-owned-caffeinate-display-sleep-prevention-v1"
PERFORMANCE_CAFFEINATE_PID=""

start_performance_display_sleep_prevention() {
  if [[ -n "${PERFORMANCE_CAFFEINATE_PID}" ]]; then
    echo "Performance display-sleep prevention is already active." >&2
    return 1
  fi
  local caffeinate_bin="${MARKTEXT_CAFFEINATE_BIN:-/usr/bin/caffeinate}"
  if [[ ! -x "${caffeinate_bin}" ]]; then
    echo "The macOS caffeinate executable is unavailable: ${caffeinate_bin}" >&2
    return 1
  fi
  "${caffeinate_bin}" -d &
  PERFORMANCE_CAFFEINATE_PID="$!"
  if ! kill -0 "${PERFORMANCE_CAFFEINATE_PID}" 2>/dev/null; then
    wait "${PERFORMANCE_CAFFEINATE_PID}" 2>/dev/null || true
    PERFORMANCE_CAFFEINATE_PID=""
    echo "Performance display-sleep prevention did not remain active." >&2
    return 1
  fi
  export MARKTEXT_PERFORMANCE_DISPLAY_SLEEP_POLICY="${PERFORMANCE_DISPLAY_SLEEP_POLICY}"
}

stop_performance_display_sleep_prevention() {
  local pid="${PERFORMANCE_CAFFEINATE_PID}"
  if [[ -z "${pid}" ]]; then
    return 0
  fi
  if kill -0 "${pid}" 2>/dev/null; then
    kill "${pid}" 2>/dev/null || true
  fi
  wait "${pid}" 2>/dev/null || true
  PERFORMANCE_CAFFEINATE_PID=""
}
