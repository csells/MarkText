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
