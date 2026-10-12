import { describe, expect, it } from 'vitest'
import { literalHolding } from '../src/internal/profile1/regionalInventory.js'
import { lcg } from './support/inputDriver.js'

// The literal block holding a run is found by a search over the blocks'
// ordered ranges; it must be the one a scan of every block finds.

describe('the literal block holding a run', () => {
  it.each(Array.from({ length: 40 }, (_, index) => index + 1))('matches a scan, seed %i', seed => {
    const random = lcg(seed * 7919)
    const literals: { start: number, end: number }[] = []
    let at = 0
    const count = Math.floor(random() * 30)
    for (let index = 0; index < count; index += 1) {
      const start = at + Math.floor(random() * 6)
      // Empty texts and blocks that touch are both possible.
      const end = start + Math.floor(random() * 8)
      literals.push({ start, end })
      at = end + (random() < 0.3 ? 0 : 1 + Math.floor(random() * 4))
    }
    // Out-of-order lists are searched as a scan would.
    if (seed % 5 === 0 && literals.length > 1) literals.reverse()
    for (let start = 0; start <= at + 2; start += 1) {
      for (let end = start; end <= Math.min(at + 3, start + 9); end += 1) {
        expect(literalHolding(literals, start, end), `${JSON.stringify(literals)} [${start}, ${end})`)
          .toBe(literals.find(content => content.start <= start && end <= content.end))
      }
    }
  })
})
