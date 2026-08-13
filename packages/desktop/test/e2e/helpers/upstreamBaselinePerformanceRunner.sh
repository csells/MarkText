#!/usr/bin/env bash

run_upstream_baseline_playwright() {
  if [[ "$#" -lt 3 ]]; then
    echo "Upstream Playwright runner requires output, command, and config paths." >&2
    return 64
  fi
  local output="$1"
  local command="$2"
  local config="$3"
  shift 3

  local status=0
  "${command}" exec playwright test \
    --config "${config}" --workers=1 --reporter=line "$@" || status=$?
  if [[ "${status}" -ne 0 ]]; then
    return "${status}"
  fi
  if [[ ! -f "${output}" ]]; then
    echo "Upstream Playwright completed but did not write raw evidence: ${output}" >&2
    return 1
  fi
}
