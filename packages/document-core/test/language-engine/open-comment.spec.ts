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

describe('LanguageEngine.open Comment', () => {
  it('opens one lossless Comment subdocument and elides it from both main projections', () => {
    const sourceText = '{>>metadata<<}'
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
        kind: 'comment',
        range: { start: 0, end: 14 },
        markers: {
          open: { start: 0, end: 3 },
          close: { start: 11, end: 14 }
        },
        arms: [
          {
            name: 'comment',
            range: { start: 3, end: 11 },
            children: []
          }
        ]
      }
    ])
    expect(revision.diagnostics.count).toBe(0)

    for (const view of ['original', 'revised'] as const) {
      const projection = revision.projection(view)
      expect(projection.source).toBe('')
      expect(() => projection.provenance.originAt(0)).toThrow(RangeError)
    }
  })

  it('keeps nested CriticMarkup in the Comment arm while the outer carrier stays opaque', () => {
    const sourceText = '{>>A{++B++}C{>>D<<}E<<}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toHaveLength(1)
    const outer = revision.criticMarkup.rootAt(0)
    expect(outer).toMatchObject({
      kind: 'comment',
      range: { start: 0, end: 23 },
      arms: [{ name: 'comment', range: { start: 3, end: 20 } }]
    })
    expect(outer?.arms[0]?.children.map((node) => ({ kind: node.kind, range: node.range }))).toEqual([
      { kind: 'addition', range: { start: 4, end: 11 } },
      { kind: 'comment', range: { start: 12, end: 19 } }
    ])
    expect(revision.projection('original').source).toBe('')
    expect(revision.projection('revised').source).toBe('')
  })
})
