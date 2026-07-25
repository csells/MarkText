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

describe('LanguageEngine.open', () => {
  it('opens one Addition with exact source, projections, and provenance', () => {
    const sourceText = '{++new++}'
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
        kind: 'addition',
        range: { start: 0, end: 9 },
        markers: {
          open: { start: 0, end: 3 },
          close: { start: 6, end: 9 }
        },
        arms: [
          {
            name: 'content',
            range: { start: 3, end: 6 },
            children: []
          }
        ]
      }
    ])

    const original = revision.projection('original')
    expect(original.source).toBe('')

    const revised = revision.projection('revised')
    expect(revised.source).toBe('new')
    expect(
      Array.from({ length: revised.source.length }, (_, offset) =>
        revised.provenance.originAt(offset)
      )
    ).toEqual([
      { kind: 'canonical', sourceOffset: 3 },
      { kind: 'canonical', sourceOffset: 4 },
      { kind: 'canonical', sourceOffset: 5 }
    ])
  })
})
