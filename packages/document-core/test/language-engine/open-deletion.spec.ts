import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'
import { rootsOf, runsOf } from '../helpers/collections.js'

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  liveHtmlSafetyProfile: 'live-html-safety-profile-1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

describe('LanguageEngine.open Deletion', () => {
  it('opens one Deletion with exact ranges, projections, and provenance', () => {
    const sourceText = 'a{--old--}b'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.source.text).toBe(sourceText)
    expect(rootsOf(revision.criticMarkup)).toEqual([
      {
        kind: 'deletion',
        range: { start: 1, end: 10 },
        markers: {
          open: { start: 1, end: 4 },
          close: { start: 7, end: 10 }
        },
        arms: [
          {
            name: 'content',
            range: { start: 4, end: 7 },
            children: []
          }
        ]
      }
    ])
    expect(revision.diagnostics.count).toBe(0)

    const original = revision.projection('original')
    expect(original.source).toBe('aoldb')
    expect(
      Array.from({ length: original.source.length }, (_, offset) =>
        original.provenance.originAt(offset)
      )
    ).toEqual([
      { kind: 'canonical', sourceOffset: 0 },
      { kind: 'canonical', sourceOffset: 4 },
      { kind: 'canonical', sourceOffset: 5 },
      { kind: 'canonical', sourceOffset: 6 },
      { kind: 'canonical', sourceOffset: 10 }
    ])

    const revised = revision.projection('revised')
    expect(revised.source).toBe('ab')
    expect(
      Array.from({ length: revised.source.length }, (_, offset) =>
        revised.provenance.originAt(offset)
      )
    ).toEqual([
      { kind: 'canonical', sourceOffset: 0 },
      { kind: 'canonical', sourceOffset: 10 }
    ])
  })
})
