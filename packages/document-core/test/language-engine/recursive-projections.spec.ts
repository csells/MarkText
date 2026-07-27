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

describe('LanguageEngine.open recursive projections', () => {
  it('assigns mixed children to their carrier arm and recursively applies every form', () => {
    const sourceText = '{==A{++B++}C{--D--}E{~~F~>G~~}H{>>I<<}J==}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toHaveLength(1)
    const outer = revision.criticMarkup.rootAt(0)
    expect(outer).toMatchObject({
      kind: 'highlight',
      range: { start: 0, end: 42 },
      markers: {
        open: { start: 0, end: 3 },
        close: { start: 39, end: 42 }
      },
      arms: [{ name: 'content', range: { start: 3, end: 39 } }]
    })
    expect(outer?.arms[0]?.children.map((node) => ({ kind: node.kind, range: node.range }))).toEqual([
      { kind: 'addition', range: { start: 4, end: 11 } },
      { kind: 'deletion', range: { start: 12, end: 19 } },
      { kind: 'substitution', range: { start: 20, end: 30 } },
      { kind: 'comment', range: { start: 31, end: 38 } }
    ])

    const original = revision.projection('original')
    expect(original.source).toBe('ACDEFHJ')
    expect(
      Array.from({ length: original.source.length }, (_, offset) =>
        original.provenance.originAt(offset)
      )
    ).toEqual(
      [3, 11, 15, 19, 23, 30, 38].map((sourceOffset) => ({
        kind: 'canonical',
        sourceOffset
      }))
    )

    const revised = revision.projection('revised')
    expect(revised.source).toBe('ABCEGHJ')
    expect(
      Array.from({ length: revised.source.length }, (_, offset) =>
        revised.provenance.originAt(offset)
      )
    ).toEqual(
      [3, 7, 11, 19, 26, 30, 38].map((sourceOffset) => ({
        kind: 'canonical',
        sourceOffset
      }))
    )
  })
})
