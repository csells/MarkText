import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration,
  type RevisionId
} from '@marktext/document-core'
import { RevisionKernel } from '../../src/internal/session/revisionKernel.js'

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  liveHtmlSafetyProfile: 'live-html-safety-profile-1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

describe('RevisionKernel transition proof', () => {
  function preparesAnInvertibleInsertionProof(): void {
    const engine = createLanguageEngine()
    const baseRevision = engine.open(createSourceSnapshot('a{++new++}c'), TEST_CONFIGURATION)
    if (baseRevision.kind !== 'complete') {
      throw new Error('Expected a complete base revision')
    }

    const base = 'revision-base' as RevisionId
    const next = 'revision-next' as RevisionId
    const prepared = new RevisionKernel(engine).revise(
      baseRevision,
      { start: 1, end: 1, insert: 'b' },
      { base, next }
    )
    const proof = prepared.transition
    const baseNode = baseRevision.criticMarkup.roots[0]
    const nextNode = prepared.revision.criticMarkup.roots[0]
    if (baseNode === undefined || nextNode === undefined) {
      throw new Error('Expected the Addition to survive in both revisions')
    }

    expect(proof).toMatchObject({
      base,
      next,
      edits: [{ start: 1, end: 1, insert: 'b' }],
      inverseEdits: [{ start: 1, end: 2, insert: '' }]
    })
    expect(Object.isFrozen(proof)).toBe(true)
    expect(Object.isFrozen(proof.edits)).toBe(true)
    expect(Object.isFrozen(proof.inverseEdits)).toBe(true)

    expect(proof.canonicalMap.mapPosition('forward', { offset: 1, affinity: 'previous' })).toEqual({
      offset: 1,
      affinity: 'previous'
    })
    expect(proof.canonicalMap.mapPosition('forward', { offset: 1, affinity: 'next' })).toEqual({
      offset: 2,
      affinity: 'next'
    })
    expect(
      proof.canonicalMap.mapRange('forward', {
        start: { offset: 1, affinity: 'next' },
        end: { offset: 10, affinity: 'previous' }
      })
    ).toEqual({
      kind: 'unchanged',
      range: {
        start: { offset: 2, affinity: 'next' },
        end: { offset: 11, affinity: 'previous' }
      }
    })
    expect(proof.nodeSurvival.map('forward', baseNode)).toBe(nextNode)
    expect(proof.nodeSurvival.map('forward', { ...baseNode })).toBeNull()

    const inverse = proof.invert()
    expect(inverse).toMatchObject({
      base: next,
      next: base,
      edits: proof.inverseEdits,
      inverseEdits: proof.edits
    })
    expect(inverse.canonicalMap.mapPosition('forward', { offset: 2, affinity: 'next' })).toEqual({
      offset: 1,
      affinity: 'next'
    })
    expect(inverse.nodeSurvival.map('forward', nextNode)).toBe(baseNode)

    const identity = proof.compose(inverse)
    expect(identity).toMatchObject({
      base,
      next: base,
      edits: [],
      inverseEdits: []
    })
    expect(identity.canonicalMap.mapPosition('forward', { offset: 5, affinity: 'next' })).toEqual({
      offset: 5,
      affinity: 'next'
    })
    expect(identity.nodeSurvival.map('forward', baseNode)).toBe(baseNode)
  }

  it(
    'prepares an immutable, invertible proof for one source insertion',
    preparesAnInvertibleInsertionProof
  )

  function preservesThePlannedOffsetInRepeatedText(): void {
    const engine = createLanguageEngine()
    const baseRevision = engine.open(createSourceSnapshot('aa'), TEST_CONFIGURATION)
    if (baseRevision.kind !== 'complete') {
      throw new Error('Expected a complete base revision')
    }

    const prepared = new RevisionKernel(engine).revise(
      baseRevision,
      { start: 1, end: 1, insert: 'a' },
      {
        base: 'revision-repeated-base' as RevisionId,
        next: 'revision-repeated-next' as RevisionId
      }
    )

    expect(prepared.transition.edits).toEqual([{ start: 1, end: 1, insert: 'a' }])
    expect(prepared.transition.inverseEdits).toEqual([{ start: 1, end: 2, insert: '' }])
    expect(
      prepared.transition.canonicalMap.mapPosition('forward', {
        offset: 1,
        affinity: 'next'
      })
    ).toEqual({ offset: 2, affinity: 'next' })
  }

  it(
    'does not relocate an edit when surrounding text is identical',
    preservesThePlannedOffsetInRepeatedText
  )

  function rejectsEqualTextFromAnotherRevisionInstance(): void {
    const engine = createLanguageEngine()
    const baseRevision = engine.open(createSourceSnapshot('a{++x++}'), TEST_CONFIGURATION)
    if (baseRevision.kind !== 'complete') {
      throw new Error('Expected a complete base revision')
    }
    const middleId = 'revision-shared-middle' as RevisionId
    const first = new RevisionKernel(engine).revise(
      baseRevision,
      { start: 0, end: 0, insert: '!' },
      { base: 'revision-first' as RevisionId, next: middleId }
    )

    const unrelatedMiddle = engine.open(
      createSourceSnapshot(first.revision.source.text),
      TEST_CONFIGURATION
    )
    if (unrelatedMiddle.kind !== 'complete') {
      throw new Error('Expected a complete unrelated middle revision')
    }
    const second = new RevisionKernel(engine).revise(
      unrelatedMiddle,
      {
        start: unrelatedMiddle.source.text.length,
        end: unrelatedMiddle.source.text.length,
        insert: '?'
      },
      { base: middleId, next: 'revision-last' as RevisionId }
    )

    expect(() => first.transition.compose(second.transition)).toThrow(
      'Revision transitions are not adjacent'
    )
  }

  it(
    'requires the exact shared revision instance when composing',
    rejectsEqualTextFromAnotherRevisionInstance
  )

  function composesRepeatedTextFromEditProvenance(): void {
    const engine = createLanguageEngine()
    const baseRevision = engine.open(createSourceSnapshot('aa'), TEST_CONFIGURATION)
    if (baseRevision.kind !== 'complete') {
      throw new Error('Expected a complete base revision')
    }
    const middleId = 'revision-compose-middle' as RevisionId
    const first = new RevisionKernel(engine).revise(
      baseRevision,
      { start: 1, end: 1, insert: 'a' },
      { base: 'revision-compose-base' as RevisionId, next: middleId }
    )
    const second = new RevisionKernel(engine).revise(
      first.revision,
      { start: 2, end: 2, insert: 'a' },
      { base: middleId, next: 'revision-compose-next' as RevisionId }
    )

    const composed = first.transition.compose(second.transition)
    expect(composed.edits).toEqual([{ start: 1, end: 1, insert: 'aa' }])
    expect(composed.inverseEdits).toEqual([{ start: 1, end: 3, insert: '' }])
    expect(
      composed.canonicalMap.mapPosition('forward', {
        offset: 1,
        affinity: 'next'
      })
    ).toEqual({ offset: 3, affinity: 'next' })
  }

  it(
    'composes repeated text from edit provenance rather than endpoint diffing',
    composesRepeatedTextFromEditProvenance
  )

  function mapsAReplacedRangeWithoutReversingIt(): void {
    const engine = createLanguageEngine()
    const baseRevision = engine.open(createSourceSnapshot('abc'), TEST_CONFIGURATION)
    if (baseRevision.kind !== 'complete') {
      throw new Error('Expected a complete base revision')
    }
    const prepared = new RevisionKernel(engine).revise(
      baseRevision,
      { start: 1, end: 2, insert: 'XY' },
      {
        base: 'revision-range-base' as RevisionId,
        next: 'revision-range-next' as RevisionId
      }
    )

    expect(
      prepared.transition.canonicalMap.mapRange('forward', {
        start: { offset: 1, affinity: 'next' },
        end: { offset: 2, affinity: 'previous' }
      })
    ).toEqual({
      kind: 'changed',
      range: {
        start: { offset: 1, affinity: 'next' },
        end: { offset: 3, affinity: 'previous' }
      }
    })
  }

  it('maps replacement ranges to an ordered next range', mapsAReplacedRangeWithoutReversingIt)

  function reportsAnInsertionThatSplitsAStableRange(): void {
    const engine = createLanguageEngine()
    const baseRevision = engine.open(createSourceSnapshot('abcd'), TEST_CONFIGURATION)
    if (baseRevision.kind !== 'complete') {
      throw new Error('Expected a complete base revision')
    }
    const prepared = new RevisionKernel(engine).revise(
      baseRevision,
      { start: 2, end: 2, insert: 'X' },
      {
        base: 'revision-split-base' as RevisionId,
        next: 'revision-split-next' as RevisionId
      }
    )

    expect(
      prepared.transition.canonicalMap.mapRange('forward', {
        start: { offset: 1, affinity: 'next' },
        end: { offset: 3, affinity: 'previous' }
      })
    ).toEqual({
      kind: 'split',
      ranges: [
        {
          start: { offset: 1, affinity: 'next' },
          end: { offset: 2, affinity: 'previous' }
        },
        {
          start: { offset: 3, affinity: 'next' },
          end: { offset: 4, affinity: 'previous' }
        }
      ]
    })
  }

  it(
    'reports stable source on both sides of an insertion as split',
    reportsAnInsertionThatSplitsAStableRange
  )

  function rejectsSurvivalAfterCarrierPromotion(): void {
    const engine = createLanguageEngine()
    const baseRevision = engine.open(createSourceSnapshot('{++{++x++}++}'), TEST_CONFIGURATION)
    if (baseRevision.kind !== 'complete') {
      throw new Error('Expected a complete base revision')
    }
    const outer = baseRevision.criticMarkup.roots[0]
    const inner = outer?.arms[0]?.children[0]
    if (outer === undefined || inner === undefined) {
      throw new Error('Expected nested Addition nodes')
    }

    const prepared = new RevisionKernel(engine).revise(
      baseRevision,
      { start: 0, end: 3, insert: '' },
      {
        base: 'revision-carrier-base' as RevisionId,
        next: 'revision-carrier-next' as RevisionId
      }
    )

    expect(prepared.transition.nodeSurvival.map('forward', outer)).toBeNull()
    expect(prepared.transition.nodeSurvival.map('forward', inner)).toBeNull()
  }

  it(
    'does not claim a node survived when its carrier path changed',
    rejectsSurvivalAfterCarrierPromotion
  )
})
