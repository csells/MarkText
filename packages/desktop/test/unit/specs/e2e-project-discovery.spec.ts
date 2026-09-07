// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const desktop = resolve(__dirname, '../../..')
const cli = createRequire(import.meta.url).resolve('@playwright/test/cli')
const scripts = JSON.parse(readFileSync(resolve(desktop, 'package.json'), 'utf8'))
  .scripts as Record<string, string>
const artifactSpecs = [
  'installed-core-review.spec.ts',
  'installed-core-clipboard.spec.ts',
  'installed-core-search.spec.ts',
  'installed-core-export-consumers.spec.ts',
  'installed-core-performance.spec.ts'
]

const discover = (script: string): string => {
  const [executable, ...args] = scripts[script].split(' ')
  expect(executable).toBe('playwright')
  const env = { ...process.env }
  delete env.MARKTEXT_PACKAGED_APP
  delete env.MARKTEXT_EXPECTED_COMMIT
  return execFileSync(process.execPath, [cli, ...args, '--list'], {
    cwd: desktop,
    env,
    encoding: 'utf8',
    timeout: 15_000
  })
}

describe('public E2E project discovery', () => {
  it('keeps every artifact-required consumer out of the ordinary unpacked command', () => {
    const output = discover('test:e2e')
    expect(output).toContain('[unpacked]')
    expect(output).toContain('criticmarkup-draft-recovery.spec.ts')
    for (const spec of artifactSpecs) expect(output).not.toContain(spec)
  })

  it('retains artifact-required consumers in the installed command', () => {
    const output = discover('test:e2e:installed')
    expect(output).toContain('[installed]')
    for (const spec of artifactSpecs) expect(output).toContain(spec)
    expect(output).not.toContain('criticmarkup-draft-recovery.spec.ts')
  })
})
