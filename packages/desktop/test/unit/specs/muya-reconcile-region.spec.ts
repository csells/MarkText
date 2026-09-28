import { describe, expect, it } from 'vitest'
import { composeMuyaReconcileRegion } from '@/documentAuthority/muyaReconcileRegion'

/** Applies a region to a document of distinct roots, as a view change replaces them. */
const replace = (roots: readonly string[], region: { start: number, previousEnd: number, nextEnd: number }, tag: string) => [
  ...roots.slice(0, region.start),
  ...Array.from({ length: region.nextEnd - region.start }, (_, index) => `${tag}${index}`),
  ...roots.slice(region.previousEnd)
]

describe('Composing the roots views replaced before Muya reconciles', () => {
  const lcg = (seed: number) => (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }

  it.each(Array.from({ length: 50 }, (_, index) => index + 1))(
    'keeps every root outside the composed region unchanged (seed %i)',
    (seed) => {
      const random = lcg(seed)
      const presented = Array.from({ length: 12 }, (_, index) => `p${index}`)
      let current = presented
      let region: { start: number, previousEnd: number, nextEnd: number } | undefined
      for (let step = 0; step < 4; step += 1) {
        const start = Math.floor(random() * (current.length + 1))
        const previousEnd = start + Math.floor(random() * Math.min(3, current.length - start + 1))
        const nextEnd = start + Math.floor(random() * 4)
        const change = { start, previousEnd, nextEnd }
        current = replace(current, change, `s${step}r`)
        region = composeMuyaReconcileRegion(region, change)
        // Roots before the region and after it are the presented ones, unmoved.
        expect(current.slice(0, region.start)).toEqual(presented.slice(0, region.start))
        expect(current.length - region.nextEnd).toBe(presented.length - region.previousEnd)
        expect(current.slice(region.nextEnd)).toEqual(presented.slice(region.previousEnd))
      }
    }
  )
})
