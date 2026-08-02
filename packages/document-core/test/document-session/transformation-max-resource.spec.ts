import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const runner = fileURLToPath(
  new URL('../fixtures/maximum-transformation-runner.ts', import.meta.url)
)

describe('TransformationKernel maximum-resource behavior', () => {
  it('commits a small transform at 32 million units inside a bounded heap', () => {
    const child = spawnSync(process.execPath, [
      '--max-old-space-size=512',
      '--import=tsx',
      runner
    ], {
      encoding: 'utf8',
      maxBuffer: 4 * 1_024 * 1_024,
      // Hosted runners execute the same bounded work about four times
      // slower than the owner hardware this guard was sized on.
      timeout: process.env.CI === 'true' ? 240_000 : 60_000
    })

    expect(child.error, child.stderr).toBeUndefined()
    expect(child.signal, child.stderr).toBeNull()
    expect(child.status, child.stderr).toBe(0)
    const proof = JSON.parse(child.stdout.trim()) as {
      readonly kind: string
      readonly sourceLength: number
      readonly editCount: number
      readonly maxRssKiB: number
    }
    expect(proof).toMatchObject({
      kind: 'committed',
      sourceLength: 31_999_994,
      editCount: 1
    })
    expect(proof.maxRssKiB).toBeLessThan(768 * 1_024)
    // The wrapper must outlast the child budget it wraps: the spawn above
    // already grants hosted runners 240s for the same bounded work, and a
    // green windows-2025 leg measured 57.5s against the old flat 70s —
    // the wrapper was timing the VM, not the heap bound it asserts.
  }, process.env.CI === 'true' ? 250_000 : 70_000)
})
