import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const runnerLibrary = resolve(
  import.meta.dirname,
  '../../e2e/helpers/upstreamBaselinePerformanceRunner.sh'
)
const producerScript = resolve(
  import.meta.dirname,
  '../../e2e/run-upstream-baseline-performance.sh'
)
const coreProducerScript = resolve(
  import.meta.dirname,
  '../../e2e/run-installed-core-performance.sh'
)
const displaySleepPolicyLibrary = resolve(
  import.meta.dirname,
  '../../e2e/helpers/performanceDisplaySleepPolicy.sh'
)

const invokeDefaultPath = (
  command: string,
  output: string,
  environment: NodeJS.ProcessEnv
) => spawnSync('/bin/bash', [
  '-c',
  [
    'set -euo pipefail',
    'source "$1"',
    'run_upstream_baseline_playwright "$2" "$3" fake-config.ts'
  ].join('\n'),
  'upstream-runner-test',
  runnerLibrary,
  output,
  command
], {
  encoding: 'utf8',
  env: environment
})

describe('upstream baseline performance shell runner', () => {
  it('holds display sleep prevention for both authenticated launchers', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'marktext-display-sleep-policy-'))
    try {
      const fake = resolve(root, 'caffeinate')
      const argv = resolve(root, 'argv')
      writeFileSync(fake, [
        '#!/bin/bash',
        'printf "%s\\n" "$@" > "$FAKE_CAFFEINATE_ARGV"',
        'exec /bin/sleep 60'
      ].join('\n'))
      chmodSync(fake, 0o755)
      const result = spawnSync('/bin/bash', ['-c', [
        'set -euo pipefail',
        'source "$1"',
        'export MARKTEXT_CAFFEINATE_BIN="$2"',
        'export FAKE_CAFFEINATE_ARGV="$3"',
        'start_performance_display_sleep_prevention',
        'pid="$PERFORMANCE_CAFFEINATE_PID"',
        'kill -0 "$pid"',
        'for _ in {1..100}; do [[ -e "$3" ]] && break; sleep 0.01; done',
        'printf "%s\\n" "$MARKTEXT_PERFORMANCE_DISPLAY_SLEEP_POLICY"',
        'stop_performance_display_sleep_prevention',
        'if kill -0 "$pid" 2>/dev/null; then exit 41; fi'
      ].join('\n'), 'display-sleep-policy-test', displaySleepPolicyLibrary,
      fake, argv], { encoding: 'utf8' })

      expect(result.status).toBe(0)
      expect(result.stdout.trim()).toBe(
        'runner-owned-caffeinate-display-sleep-prevention-v1'
      )
      expect(readFileSync(argv, 'utf8').trim().split('\n')).toEqual(['-d'])

      for (const launcher of [producerScript, coreProducerScript]) {
        const source = readFileSync(launcher, 'utf8')
        expect(source).toContain('performanceDisplaySleepPolicy.sh')
        expect(source).toContain('start_performance_display_sleep_prevention')
        expect(source).toContain('stop_performance_display_sleep_prevention')
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('authenticates the observation schedule immediately after the lifecycle helper', () => {
    const source = readFileSync(producerScript, 'utf8')
    expect(source).toContain(
      '"$' + '{SAMPLE_LIFECYCLE_FILE}" "$' +
      '{OBSERVATION_SCHEDULE_FILE}" \\\n      "$' +
      '{CHROMIUM_POLICY_FILE}"'
    )
  })

  it('propagates a zero-argument Playwright launch failure without claiming output', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'marktext-upstream-runner-'))
    try {
      const fake = resolve(root, 'pnpm')
      const argv = resolve(root, 'argv')
      const output = resolve(root, 'smoke.json')
      writeFileSync(fake, [
        '#!/bin/bash',
        'printf "%s\\n" "$@" > "$FAKE_ARGV"',
        'exit 23'
      ].join('\n'))
      chmodSync(fake, 0o755)

      const result = invokeDefaultPath(fake, output, {
        ...process.env,
        FAKE_ARGV: argv
      })

      expect(result.status).toBe(23)
      expect(readFileSync(argv, 'utf8').trim().split('\n')).toEqual([
        'exec',
        'playwright',
        'test',
        '--config',
        'fake-config.ts',
        '--workers=1',
        '--reporter=line'
      ])
      expect(result.stdout).not.toContain('output written')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a successful command that did not create the promised output', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'marktext-upstream-runner-'))
    try {
      const output = resolve(root, 'missing.json')
      const result = invokeDefaultPath('/usr/bin/true', output, process.env)

      expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(/did not write raw evidence/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
