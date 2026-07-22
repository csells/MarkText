import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
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

describe('DocumentSession persistence barrier', () => {
  async function leasesOnlyCommittedCanonicalSource(): Promise<void> {
    const session = await createDocumentSession({
      source: createSourceSnapshot('a{++new++}b'),
      parseConfiguration: TEST_CONFIGURATION,
      configuration: { authoringTextPolicy: 'nearest-owner-eol-v1' },
      initialView: 'markup',
      trackChanges: false,
      initialSelection: {
        anchor: { offset: 5, affinity: 'next' },
        focus: { offset: 5, affinity: 'next' }
      }
    })
    const target = session.snapshot().revision.selection
    if (target === null) {
      throw new Error('Expected an initial selection')
    }
    expect(
      (await session.dispatch({ kind: 'insert-text', target, text: '!' }).completion).kind
    ).toBe('committed')

    const prepared = await session.preparePersistence('save').completion
    if (prepared.kind !== 'flushed') {
      throw new Error('Expected a persistence source lease')
    }
    expect(prepared.watermark).toBe(1)
    expect(prepared.revision.id).toBe(session.snapshot().revision.id)
    let source = ''
    for await (const chunk of prepared.source.readChunks()) {
      source += chunk.text
    }
    expect(source).toBe('a{++new++}b!')
  }

  it('pins exact committed source at the caller frontier', leasesOnlyCommittedCanonicalSource)
})
