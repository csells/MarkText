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

describe('LanguageEngine.open Highlight', () => {
  it('opens one Highlight with exact ranges and identical recursive projections', () => {
    const sourceText = '{==focus==}'
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
        kind: 'highlight',
        range: { start: 0, end: 11 },
        markers: {
          open: { start: 0, end: 3 },
          close: { start: 8, end: 11 }
        },
        arms: [
          {
            name: 'content',
            range: { start: 3, end: 8 },
            children: []
          }
        ]
      }
    ])
    expect(revision.diagnostics.count).toBe(0)

    for (const view of ['original', 'revised'] as const) {
      const projection = revision.projection(view)
      expect(projection.source).toBe('focus')
      expect(
        Array.from({ length: projection.source.length }, (_, offset) =>
          projection.provenance.originAt(offset)
        )
      ).toEqual([
        { kind: 'canonical', sourceOffset: 3 },
        { kind: 'canonical', sourceOffset: 4 },
        { kind: 'canonical', sourceOffset: 5 },
        { kind: 'canonical', sourceOffset: 6 },
        { kind: 'canonical', sourceOffset: 7 }
      ])
    }
  })
})
