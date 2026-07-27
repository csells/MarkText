import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'

const CONFIGURATION: ParseConfiguration = {
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

describe('Profile 1 projection materialization', () => {
  it('materializes fixed-point views without synthetic or retargeted syntax', () => {
    const source = '{{--z--}++x++}\n\np{--\n\n--}[r]: /{++y++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(source),
      CONFIGURATION
    )
    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') return

    for (const view of ['original', 'revised'] as const) {
      const projected = revision.projection(view)
      const reopened = createLanguageEngine().open(
        createSourceSnapshot(projected.source),
        CONFIGURATION
      )
      expect(reopened.kind).toBe('complete')
      if (reopened.kind !== 'complete') continue
      expect(reopened.criticMarkup.rootCount, view).toBe(0)
      expect(reopened.projection(view).source, view).toBe(projected.source)

      for (let offset = 0; offset < projected.source.length; offset += 1) {
        const origin = projected.provenance.originAt(offset)
        if (origin.kind === 'canonical') {
          expect(source[origin.sourceOffset], `${view}:${offset}`)
            .toBe(projected.source[offset])
        } else {
          expect(projected.source[offset], `${view}:${offset}`).toBe('\\')
        }
      }
    }
  })
})
