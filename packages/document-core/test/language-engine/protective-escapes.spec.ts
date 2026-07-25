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

describe('LanguageEngine.open protective escapes', () => {
  it('keeps an opener literal after an odd backslash run', () => {
    const sourceText = String.raw`\{++literal++}`
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toEqual([])
    for (const view of ['original', 'revised'] as const) {
      const projection = revision.projection(view)
      expect(projection.source).toBe(sourceText)
      expect(
        Array.from({ length: projection.source.length }, (_, offset) =>
          projection.provenance.originAt(offset)
        )
      ).toEqual(
        Array.from({ length: sourceText.length }, (_, sourceOffset) => ({
          kind: 'canonical',
          sourceOffset
        }))
      )
    }
  })

  it('splits a Substitution at the first active top-level separator', () => {
    const sourceText = String.raw`{~~a\~>b~>c~~}`
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toEqual([
      {
        kind: 'substitution',
        range: { start: 0, end: 14 },
        markers: {
          open: { start: 0, end: 3 },
          separator: { start: 8, end: 10 },
          close: { start: 11, end: 14 }
        },
        arms: [
          { name: 'old', range: { start: 3, end: 8 }, children: [] },
          { name: 'new', range: { start: 10, end: 11 }, children: [] }
        ]
      }
    ])
    expect(revision.projection('original').source).toBe(String.raw`a\~>b`)
    expect(revision.projection('revised').source).toBe('c')
  })

  it('does not hide an overlapping separator behind a protected opener', () => {
    const sourceText = String.raw`{~~a\{~~>b~~}`
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toEqual([
      {
        kind: 'substitution',
        range: { start: 0, end: 13 },
        markers: {
          open: { start: 0, end: 3 },
          separator: { start: 7, end: 9 },
          close: { start: 10, end: 13 }
        },
        arms: [
          { name: 'old', range: { start: 3, end: 7 }, children: [] },
          { name: 'new', range: { start: 9, end: 10 }, children: [] }
        ]
      }
    ])
    expect(revision.projection('original').source).toBe(String.raw`a\{~`)
    expect(revision.projection('revised').source).toBe('b')
  })

  it('ignores a separator authenticated inside an arm code span', () => {
    const sourceText = '{~~`a~>b`~>c~~}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toMatchObject([
      {
        kind: 'substitution',
        markers: { separator: { start: 9, end: 11 } },
        arms: [
          { name: 'old', range: { start: 3, end: 9 }, children: [] },
          { name: 'new', range: { start: 11, end: 12 }, children: [] }
        ]
      }
    ])
    expect(revision.projection('original').source).toBe('`a~>b`')
    expect(revision.projection('revised').source).toBe('c')
  })

  it('keeps an interrupted closer inside its payload until an exact closer', () => {
    const sourceText = String.raw`{++literal ++\} inside++}`
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toMatchObject([
      {
        kind: 'addition',
        range: { start: 0, end: 25 },
        markers: { open: { start: 0, end: 3 }, close: { start: 22, end: 25 } },
        arms: [{ range: { start: 3, end: 22 } }]
      }
    ])
    expect(revision.projection('revised').source).toBe(String.raw`literal ++\} inside`)
  })

  it('does not treat a backslash before a closer prefix as protection', () => {
    const sourceText = String.raw`{++close \++} inside++}`
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toMatchObject([
      {
        kind: 'addition',
        range: { start: 0, end: 13 },
        markers: { close: { start: 10, end: 13 } }
      }
    ])
    expect(revision.projection('original').source).toBe(' inside++}')
    expect(revision.projection('revised').source).toBe(String.raw`close \ inside++}`)
  })
})
