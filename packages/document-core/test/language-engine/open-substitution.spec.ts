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

describe('LanguageEngine.open Substitution', () => {
  it('opens one Substitution with exact arms, projections, and provenance', () => {
    const sourceText = '{~~old~>new~~}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toEqual([
      {
        kind: 'substitution',
        range: { start: 0, end: 14 },
        markers: {
          open: { start: 0, end: 3 },
          separator: { start: 6, end: 8 },
          close: { start: 11, end: 14 }
        },
        arms: [
          {
            name: 'old',
            range: { start: 3, end: 6 },
            children: []
          },
          {
            name: 'new',
            range: { start: 8, end: 11 },
            children: []
          }
        ]
      }
    ])
    expect(revision.diagnostics.count).toBe(0)

    const original = revision.projection('original')
    expect(original.source).toBe('old')
    expect(
      Array.from({ length: original.source.length }, (_, offset) =>
        original.provenance.originAt(offset)
      )
    ).toEqual([
      { kind: 'canonical', sourceOffset: 3 },
      { kind: 'canonical', sourceOffset: 4 },
      { kind: 'canonical', sourceOffset: 5 }
    ])

    const revised = revision.projection('revised')
    expect(revised.source).toBe('new')
    expect(
      Array.from({ length: revised.source.length }, (_, offset) =>
        revised.provenance.originAt(offset)
      )
    ).toEqual([
      { kind: 'canonical', sourceOffset: 8 },
      { kind: 'canonical', sourceOffset: 9 },
      { kind: 'canonical', sourceOffset: 10 }
    ])
  })
})
