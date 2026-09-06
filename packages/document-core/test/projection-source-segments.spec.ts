import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/documentCore.js'

describe('portable projection source segments', () => {
  it('retains exact canonical runs across omitted annotations without claiming gaps', () => {
    const core = createDocumentCore()
    const revision = core.open('a{--old--}{++b++}c')
    const projection = core.project(revision, 'revised')
    expect(projection.markdown).toBe('abc')
    expect(projection.coordinates.sourceSegments).toEqual([
      { projected: { start: 0, end: 1 }, source: { start: 0, end: 1 } },
      { projected: { start: 1, end: 2 }, source: { start: 13, end: 14 } },
      { projected: { start: 2, end: 3 }, source: { start: 17, end: 18 } }
    ])
    expect(structuredClone(projection.coordinates.sourceSegments)).toEqual(projection.coordinates.sourceSegments)
  })
})
