import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

interface MemoryResult {
  readonly regions: number
  readonly retainedBytesPerRegion: number
  readonly maximumRetainedBytesPerRegion: number
  readonly projectionScopes: readonly string[]
  readonly mode:
    | 'incremental'
    | 'intrinsic-fallback'
    | 'historical'
    | 'intrinsic-fallback-historical'
    | 'historical-annotations'
  readonly intrinsicSourceUnits: number
  readonly currentStrongStores: number
  readonly peakStrongStores: number
}

describe('document-core full-product retention', () => {
  const measure = (
    mode: MemoryResult['mode'],
    maximumRetainedBytesPerRegion: number = 20_000,
    regions: number = 1_000
  ): MemoryResult => {
    const childPath = fileURLToPath(new URL(
      './helpers/full-product-memory-child.ts',
      import.meta.url
    ))
    const result = spawnSync(process.execPath, [
      '--expose-gc',
      '--max-old-space-size=512',
      '--import',
      'tsx',
      childPath,
      String(regions),
      String(maximumRetainedBytesPerRegion),
      mode
    ], {
      cwd: fileURLToPath(new URL('../../..', import.meta.url)),
      encoding: 'utf8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' }
    })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr || result.stdout).toBe(0)
    return JSON.parse(result.stdout.trim()) as MemoryResult
  }

  it.each(['incremental', 'intrinsic-fallback'] as const)(
    'does not retain both full graphs after %s parsing',
    mode => {
      const measurement = measure(mode)
      expect(measurement.regions).toBe(1_000)
      expect(measurement.mode).toBe(mode)
      expect(measurement.projectionScopes).toEqual([])
      expect(measurement.currentStrongStores).toBe(1)
      expect(measurement.peakStrongStores).toBe(1)
      expect(measurement.retainedBytesPerRegion)
        .toBeLessThanOrEqual(measurement.maximumRetainedBytesPerRegion)
      if (mode === 'incremental') {
        expect(measurement.intrinsicSourceUnits).toBeLessThan(3_100)
      } else {
        expect(measurement.intrinsicSourceUnits).toBeGreaterThan(3_000)
      }
    }
  )

  it('demotes the current graph before historical projection rehydrates', () => {
    const measurement = measure('historical', 20_000)
    expect(measurement.currentStrongStores).toBe(0)
    expect(measurement.peakStrongStores).toBe(1)
    expect(measurement.retainedBytesPerRegion)
      .toBeLessThanOrEqual(measurement.maximumRetainedBytesPerRegion)
  })

  it('materializes a scaled unread historical annotation forest ephemerally', () => {
    const measurement = measure('historical-annotations', 30_000)
    expect(measurement.currentStrongStores).toBe(0)
    expect(measurement.peakStrongStores).toBe(1)
    expect(measurement.retainedBytesPerRegion)
      .toBeLessThanOrEqual(measurement.maximumRetainedBytesPerRegion)
  })

  it('stays below 512 MB through forced fallback and historical projection', () => {
    const measurement = measure(
      'intrinsic-fallback-historical',
      20_000,
      18_000
    )
    expect(measurement.currentStrongStores).toBe(0)
    expect(measurement.peakStrongStores).toBe(1)
    expect(measurement.intrinsicSourceUnits).toBeGreaterThan(54_000)
  }, 15_000)
})
