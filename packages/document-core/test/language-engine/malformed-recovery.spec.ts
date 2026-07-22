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

describe('LanguageEngine.open malformed recovery', () => {
  it('keeps a non-top closer literal and promotes a complete descendant', () => {
    const sourceText = '{++a{--b++}c--}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.source.text).toBe(sourceText)
    expect(revision.criticMarkup.roots).toEqual([
      {
        kind: 'deletion',
        range: { start: 4, end: 15 },
        markers: {
          open: { start: 4, end: 7 },
          close: { start: 12, end: 15 }
        },
        arms: [
          {
            name: 'content',
            range: { start: 7, end: 12 },
            children: []
          }
        ]
      }
    ])
    expect(
      Array.from({ length: revision.diagnostics.count }, (_, ordinal) =>
        revision.diagnostics.at(ordinal)
      )
    ).toEqual([
      {
        code: 'CM_UNTERMINATED_OPENER',
        range: { start: 0, end: 3 },
        metadata: {}
      },
      {
        code: 'CM_NON_TOP_CLOSER',
        range: { start: 8, end: 11 },
        metadata: { found: 'Addition', top: 'Deletion' }
      }
    ])
  })

  it('keeps a separator-less Substitution literal and promotes its complete child', () => {
    const sourceText = '{~~a{++b++}~~}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toEqual([
      {
        kind: 'addition',
        range: { start: 4, end: 11 },
        markers: {
          open: { start: 4, end: 7 },
          close: { start: 8, end: 11 }
        },
        arms: [
          {
            name: 'content',
            range: { start: 7, end: 8 },
            children: []
          }
        ]
      }
    ])
    expect(revision.diagnostics.count).toBe(1)
    expect(revision.diagnostics.at(0)).toEqual({
      code: 'CM_SUBSTITUTION_SEPARATOR_MISSING',
      range: { start: 0, end: 14 },
      metadata: {}
    })
    expect(revision.projection('original').source).toBe('{~~a~~}')
    expect(revision.projection('revised').source).toBe('{~~ab~~}')
  })

  it('diagnoses each closer that has no compatible open frame without consuming source', () => {
    const sourceText = '++} --} ~~} ==} <<}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toEqual([])
    expect(
      Array.from({ length: revision.diagnostics.count }, (_, ordinal) =>
        revision.diagnostics.at(ordinal)
      )
    ).toEqual(
      [
        [0, 3],
        [4, 7],
        [8, 11],
        [12, 15],
        [16, 19]
      ].map(([start, end]) => ({
        code: 'CM_UNMATCHED_CLOSER',
        range: { start, end },
        metadata: {}
      }))
    )
    expect(revision.projection('original').source).toBe(sourceText)
    expect(revision.projection('revised').source).toBe(sourceText)
  })
})
