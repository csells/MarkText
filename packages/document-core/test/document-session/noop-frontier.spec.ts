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

describe('DocumentSession no-op frontier', () => {
  async function classifiesEmptyInsertionWithoutChangingSource(): Promise<void> {
    const session = await createDocumentSession({
      source: createSourceSnapshot('ac'),
      parseConfiguration: TEST_CONFIGURATION,
      configuration: {
        authoringTextPolicy: 'nearest-owner-eol-v1'
      },
      initialView: 'markup',
      trackChanges: false,
      initialSelection: {
        anchor: { offset: 1, affinity: 'next' },
        focus: { offset: 1, affinity: 'next' }
      }
    })
    const target = session.snapshot().revision.selection
    if (target === null) {
      throw new Error('Expected an initial selection')
    }

    const result = await session.dispatch({
      kind: 'insert-text',
      target,
      text: ''
    }).completion
    expect(result).toMatchObject({
      kind: 'noop',
      reason: 'empty-insertion'
    })

    const flush = await session.flush('materialize').completion
    if (flush.kind !== 'flushed') {
      throw new Error('Expected a flushed revision')
    }
    expect(flush.watermark).toBe(1)
    let exactSource = ''
    for await (const chunk of flush.source.readChunks()) {
      exactSource += chunk.text
    }
    expect(exactSource).toBe('ac')
  }

  it(
    'settles empty insertion as a no-op at the causal frontier',
    classifiesEmptyInsertionWithoutChangingSource
  )
})
