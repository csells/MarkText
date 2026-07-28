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

describe('DocumentSession rejection frontier', () => {
  async function settlesExpectedRejectionBeforeFlush(): Promise<void> {
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

    const undo = session.dispatch({ kind: 'undo' })
    const flush = session.flush('materialize')
    expect(await undo.completion).toMatchObject({
      kind: 'rejected',
      reason: 'nothing-to-undo'
    })

    const flushed = await flush.completion
    if (flushed.kind !== 'flushed') {
      throw new Error('Expected a flushed revision')
    }
    expect(flushed.watermark).toBe(1)
    let exactSource = ''
    for await (const chunk of flushed.source.readChunks()) {
      exactSource += chunk.text
    }
    expect(exactSource).toBe('ac')
  }

  it(
    'includes a terminal expected rejection in the causal watermark',
    settlesExpectedRejectionBeforeFlush
  )
})
