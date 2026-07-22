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

describe('LanguageEngine.open BOF text codec', () => {
  it('retains one leading U+FEFF as virtual grammar trivia with shifted CM ranges', () => {
    const sourceText = '\uFEFF{++x++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      {
        kind: 'addition',
        range: { start: 1, end: 8 },
        markers: {
          open: { start: 1, end: 4 },
          close: { start: 5, end: 8 }
        },
        arms: [{ range: { start: 4, end: 5 } }]
      }
    ])
    expect(revision.projection('original').source).toBe('\uFEFF')
    expect(revision.projection('revised').source).toBe('\uFEFFx')
    expect(revision.projection('revised').provenance.originAt(0)).toEqual({
      kind: 'canonical',
      sourceOffset: 0
    })
    expect(revision.projection('revised').provenance.originAt(1)).toEqual({
      kind: 'canonical',
      sourceOffset: 4
    })
  })

  it('encodes an ordinary nonleading U+FEFF moved to projected BOF', () => {
    const sourceText = '{--prefix--}\uFEFF---\na: value\n---'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.source.text).toBe(sourceText)
    expect(revision.projection('original').source).toBe('prefix\uFEFF---\na: value\n---')

    const revised = revision.projection('revised')
    expect(revised.source).toBe('&#xFEFF;---\na: value\n---')
    for (let offset = 0; offset < 8; offset += 1) {
      expect(revised.provenance.originAt(offset)).toEqual({
        kind: 'generated',
        sourcePosition: 12,
        affinity: 'next'
      })
    }
    expect(revised.provenance.originAt(8)).toEqual({
      kind: 'canonical',
      sourceOffset: 13
    })
  })
})
