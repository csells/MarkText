import { describe, expect, it } from 'vitest'
import { createSourceTextProjection } from '@/components/editorWithTabs/sourceTextProjection'

describe('source text projection', () => {
  it('maps textarea-normalized offsets onto exact mixed-EOL canonical source', () => {
    const projection = createSourceTextProjection('a\r\nb\rc\nd')

    expect(projection.text).toBe('a\nb\nc\nd')
    expect([
      0, 1, 2, 3, 4, 5, 6, 7
    ].map(offset => projection.sourceOffsetAt(offset))).toEqual([
      0, 1, 3, 4, 5, 6, 7, 8
    ])
    expect(projection.textOffsetAt(3)).toBe(2)
    expect(projection.textOffsetAt(5)).toBe(4)
    expect(projection.textOffsetAt(8)).toBe(7)
  })
})
