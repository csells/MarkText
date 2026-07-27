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
  markdownOptions: {
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: true
  },
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

describe('LanguageEngine.open standard forms', () => {
  it('opens adjacent instances of all five forms in one source-owned forest', () => {
    const sourceText = 'A {++new++} {--old--} {~~old~>new~~} {==focus==}{>>note<<}.\n'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(
      rootsOf(revision.criticMarkup).map((node) => ({ kind: node.kind, range: node.range }))
    ).toEqual([
      { kind: 'addition', range: { start: 2, end: 11 } },
      { kind: 'deletion', range: { start: 12, end: 21 } },
      { kind: 'substitution', range: { start: 22, end: 36 } },
      { kind: 'highlight', range: { start: 37, end: 48 } },
      { kind: 'comment', range: { start: 48, end: 58 } }
    ])

    const original = revision.projection('original')
    expect(original.source).toBe('A  old old focus.\n')
    expect(
      Array.from({ length: original.source.length }, (_, offset) =>
        original.provenance.originAt(offset)
      )
    ).toEqual(
      [0, 1, 11, 15, 16, 17, 21, 25, 26, 27, 36, 40, 41, 42, 43, 44, 58, 59].map(
        (sourceOffset) => ({ kind: 'canonical', sourceOffset })
      )
    )

    const revised = revision.projection('revised')
    expect(revised.source).toBe('A new  new focus.\n')
    expect(
      Array.from({ length: revised.source.length }, (_, offset) =>
        revised.provenance.originAt(offset)
      )
    ).toEqual(
      [0, 1, 5, 6, 7, 11, 21, 30, 31, 32, 36, 40, 41, 42, 43, 44, 58, 59].map(
        (sourceOffset) => ({ kind: 'canonical', sourceOffset })
      )
    )
  })
})
