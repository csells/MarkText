import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

// ADR-0010 and Profile 1 §9.1: an arm is a self-contained fragment, so the
// text a view generates to keep an arm's last paragraph apart from the block
// after it depends on that block alone. It may not depend on later text, nor
// on where the intrinsic pass split the document into regions.

const revisedOf = (source: string): string => {
  const core = createDocumentCore()
  return core.project(core.open(source), 'revised').markdown
}

describe('the parting after an arm', () => {
  const head = '{~~$$\nx + y\n$$~>$$\nx + yz\n$$~~}\n\n{--# --}Revised paragraph\n\n'

  it.each([
    'Plain words.\n',
    'Line one {++x++}\nline two {--y--}.\n',
    'Line one\nline two {--y--}.\n\nMore {++text++}\nand lines.\n'
  ])('reads the same before %j', (tail) => {
    expect(revisedOf(head + tail).slice(0, 30)).toBe(revisedOf(head + 'Plain words.\n').slice(0, 30))
  })
})
