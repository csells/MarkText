import { describe, expect, it } from 'vitest'
import {
  buildSourceCandidateDraft,
  protectSourceCandidateDraft
} from '../../src/internal/session/sourceCandidate.js'

describe('source candidate composition', () => {
  it('bounds physical pieces by edit count at the maximum admitted source size', () => {
    const sourceLength = 32_000_000
    const insertion = sourceLength / 2
    const source = 'a'.repeat(sourceLength)

    const draft = buildSourceCandidateDraft(source, [
      { start: insertion, end: insertion, insert: 'b' }
    ])

    expect(draft.text.length).toBe(sourceLength + 1)
    expect(draft.text.slice(insertion - 1, insertion + 2)).toBe('aba')
    expect(draft.joins).toEqual([insertion, insertion + 1])
    expect(draft.accounting).toEqual({
      sourceUnits: sourceLength,
      editCount: 1,
      physicalPieceCount: 3
    })
  })

  it('composes sparse protection insertions into exact source edits', () => {
    const source = 'abCD'
    const draft = buildSourceCandidateDraft(source, [
      { start: 2, end: 2, insert: 'x' }
    ])

    expect(protectSourceCandidateDraft(source, draft, [1, 4], false)).toEqual({
      text: 'a\\bxC\\D',
      edits: [
        { start: 1, end: 1, insert: '\\' },
        { start: 2, end: 2, insert: 'x' },
        { start: 3, end: 3, insert: '\\' }
      ],
      accounting: {
        sourceUnits: 4,
        editCount: 1,
        protectionCount: 2,
        physicalPieceCount: 7
      }
    })
  })

  it('composes introduced leading BOM protection without dense origin maps', () => {
    const source = '{--prefix--}\uFEFF---\na: value\n---'
    const draft = buildSourceCandidateDraft(source, [
      { start: 0, end: 12, insert: '' }
    ])

    expect(protectSourceCandidateDraft(source, draft, [], true)).toEqual({
      text: '&#xFEFF;---\na: value\n---',
      edits: [{ start: 0, end: 13, insert: '&#xFEFF;' }],
      accounting: {
        sourceUnits: source.length,
        editCount: 1,
        protectionCount: 1,
        physicalPieceCount: 2
      }
    })
  })
})
