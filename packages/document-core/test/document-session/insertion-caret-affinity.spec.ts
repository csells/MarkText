import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'

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
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

describe('DocumentSession insertion caret', () => {
  async function placesTheCaretAfterTypedText(): Promise<void> {
    const session = await createDocumentSession({
      source: createSourceSnapshot('ac'),
      parseConfiguration: TEST_CONFIGURATION,
      configuration: { authoringTextPolicy: 'nearest-owner-eol-v1' },
      initialView: 'markup',
      trackChanges: false,
      initialSelection: {
        anchor: { offset: 1, affinity: 'previous' },
        focus: { offset: 1, affinity: 'previous' }
      }
    })
    const firstTarget = session.snapshot().revision.selection
    if (firstTarget === null) {
      throw new Error('Expected an initial selection')
    }

    const first = await session.dispatch({
      kind: 'insert-text',
      target: firstTarget,
      text: 'b'
    }).completion
    if (first.kind !== 'committed') {
      throw new Error('Expected the first insertion to commit')
    }
    const secondTarget = first.transition.after.revision.selection
    expect(secondTarget).toMatchObject({
      anchor: { offset: 2, affinity: 'next' },
      focus: { offset: 2, affinity: 'next' }
    })
    if (secondTarget === null) {
      throw new Error('Expected the mapped selection')
    }

    expect(
      (
        await session.dispatch({
          kind: 'insert-text',
          target: secondTarget,
          text: 'd'
        }).completion
      ).kind
    ).toBe('committed')

    const flushed = await session.flush('materialize').completion
    if (flushed.kind !== 'flushed') {
      throw new Error('Expected an exact source lease')
    }
    let source = ''
    for await (const chunk of flushed.source.readChunks()) {
      source += chunk.text
    }
    expect(source).toBe('abdc')
  }

  it('uses command semantics instead of preserving previous affinity', placesTheCaretAfterTypedText)
})
