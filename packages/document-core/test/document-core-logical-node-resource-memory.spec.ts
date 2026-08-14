import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

describe('document-core logical-node resource policy', () => {
  const runChild = (mode: 'edge' | 'overshoot'): void => {
    const childPath = fileURLToPath(new URL(
      './helpers/logical-node-resource-child.ts',
      import.meta.url
    ))
    const result = spawnSync(process.execPath, [
      '--expose-gc',
      '--max-old-space-size=512',
      '--import',
      'tsx',
      childPath,
      mode
    ], {
      cwd: fileURLToPath(new URL('../../..', import.meta.url)),
      encoding: 'utf8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      timeout: 30_000
    })
    expect(result.error).toBeUndefined()
    expect(result.signal, result.stderr || result.stdout).toBeNull()
    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(JSON.parse(result.stdout.trim())).toMatchObject({ mode })
  }

  it('admits below and at the desktop limit and rejects the next node', () => {
    runChild('edge')
  }, 35_000)

  it('rejects a compact far overshoot and keeps the prior head recoverable', () => {
    runChild('overshoot')
  }, 35_000)
})
