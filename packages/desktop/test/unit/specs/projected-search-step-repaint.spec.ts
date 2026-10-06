import { describe, expect, it } from 'vitest'

import {
  createProjectedSearchPresentation,
  type ProjectedSearchPresentationBlock
} from '@/documentConsumers/projectedSearchPresentation'
import type { ProjectedSearchResult } from '@/documentConsumers/documentProjectionConsumers'

// Upstream #5580 (findRerender.spec.ts): stepping to the next or previous
// match only moves the active match, so it repaints the blocks holding the
// old and the new active match, not every block with a match.

type Highlight = Readonly<{ start: number, end: number, active: boolean }>

const recordingBlocks = (count: number) => {
  const updates: Array<{ block: number, highlights: readonly Highlight[] }> = []
  const blocks = Array.from({ length: count }, (_, index): ProjectedSearchPresentationBlock => ({
    update: (_cursor, highlights = []) => { updates.push({ block: index, highlights }) },
    focusHandler: () => {},
    blurHandler: () => {}
  }))
  return { blocks, updates }
}

/** One match per occurrence: `perBlock[i]` matches, each one character wide, in block `i`. */
const result = (perBlock: readonly number[], index = 0): ProjectedSearchResult => Object.freeze({
  index,
  value: 'needle',
  matches: Object.freeze(perBlock.flatMap((count, block) => Array.from({ length: count }, (_, at) => Object.freeze({
    path: [block],
    start: at * 2,
    end: at * 2 + 1,
    match: 'n',
    subMatches: [],
    presentation: { path: [block, 'text'], start: at * 2, end: at * 2 + 1 }
  }))))
})

describe('stepping through projected search matches', () => {
  it('repaints just the old and the new active block when moving between blocks', () => {
    const { blocks, updates } = recordingBlocks(20)
    const presentation = createProjectedSearchPresentation({ blockAtPath: (path) => blocks[path[0] as number] })
    presentation.present(result(Array.from({ length: 20 }, () => 1)))
    updates.length = 0

    expect(presentation.navigate('next').index).toBe(1)
    expect(updates).toEqual([
      { block: 0, highlights: [{ start: 0, end: 1, active: false }] },
      { block: 1, highlights: [{ start: 0, end: 1, active: true }] }
    ])
    expect(presentation.selection()).toEqual({
      anchor: { path: [1, 'text'], offset: 0 },
      focus: { path: [1, 'text'], offset: 1 }
    })
  })

  it('repaints one block when both matches are in the same block', () => {
    const { blocks, updates } = recordingBlocks(2)
    const presentation = createProjectedSearchPresentation({ blockAtPath: (path) => blocks[path[0] as number] })
    presentation.present(result([3, 1]))
    updates.length = 0

    presentation.navigate('next')
    expect(updates).toEqual([{
      block: 0,
      highlights: [
        { start: 0, end: 1, active: false },
        { start: 2, end: 3, active: true },
        { start: 4, end: 5, active: false }
      ]
    }])
  })

  it('keeps highlights right when wrapping from the last match to the first', () => {
    const { blocks, updates } = recordingBlocks(20)
    const presentation = createProjectedSearchPresentation({ blockAtPath: (path) => blocks[path[0] as number] })
    presentation.present(result(Array.from({ length: 20 }, () => 1)))
    expect(presentation.navigate('previous').index).toBe(19)
    updates.length = 0

    expect(presentation.navigate('next').index).toBe(0)
    expect(updates).toEqual([
      { block: 0, highlights: [{ start: 0, end: 1, active: true }] },
      { block: 19, highlights: [{ start: 0, end: 1, active: false }] }
    ])
  })

  it('presents the result whole when a stepped block was rendered again', () => {
    const { blocks, updates } = recordingBlocks(4)
    const current = [...blocks]
    const presentation = createProjectedSearchPresentation({ blockAtPath: (path) => current[path[0] as number] })
    presentation.present(result([1, 1, 1, 1]))
    const rerendered = blocks[1]
    if (rerendered === undefined) throw new Error('Expected block 1')
    current[1] = { ...rerendered }
    updates.length = 0

    presentation.navigate('next')
    // Every painted block is cleared, then every block with a match repainted.
    expect(updates.filter(update => update.highlights.length === 0).map(update => update.block)).toEqual([0, 1, 2, 3])
    expect(updates.filter(update => update.highlights.length > 0).map(update => update.block)).toEqual([0, 1, 2, 3])
  })
})
