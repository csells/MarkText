import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  liveHtmlSafetyProfile: 'live-html-safety-profile-1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

// The public revision's collection convention is count/at accessors
// (DiagnosticIndex, SourceOwnershipIndex); these specs bring the two
// remaining raw-array surfaces — CriticMarkupForest and MarkupProjection —
// onto the same seam so a balanced or lazy structure can replace the
// backing arrays without an interface break (design obligation 1).
describe('public collection accessors', () => {
  const open = (source: string) => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot(source),
      TEST_CONFIGURATION
    )
    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete revision')
    }
    return revision
  }

  it('exposes CriticMarkup roots through rootCount/rootAt', () => {
    const revision = open('a {++add++} b {--del--} c\n')
    const forest = revision.criticMarkup
    expect(forest.rootCount).toBe(2)
    expect(forest.rootAt(0).kind).toBe('addition')
    expect(forest.rootAt(1).kind).toBe('deletion')
    expect(() => forest.rootAt(2)).toThrow(RangeError)
    expect(() => forest.rootAt(-1)).toThrow(RangeError)
    expect(() => forest.rootAt(0.5)).toThrow(RangeError)
  })

  it('exposes markup projection runs through runCount/runAt', () => {
    const revision = open('plain {==hi==} text\n')
    const projection = revision.markup
    expect(projection.runCount).toBeGreaterThan(0)
    const first = projection.runAt(0)
    expect(typeof first.text).toBe('string')
    expect(() => projection.runAt(projection.runCount)).toThrow(RangeError)
    expect(() => projection.runAt(-1)).toThrow(RangeError)
  })
})
