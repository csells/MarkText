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
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

describe('DocumentSession intent admission', () => {
  async function snapshotsCallerOwnedInput(): Promise<void> {
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
    const callerIntent = {
      kind: 'insert-text' as const,
      target: {
        session: target.session,
        revision: target.revision,
        view: 'markup' as const,
        anchor: { offset: 1, affinity: 'next' as const },
        focus: { offset: 1, affinity: 'next' as const }
      },
      text: 'b'
    }

    const ticket = session.dispatch(callerIntent)
    callerIntent.text = 'X'
    callerIntent.target.anchor.offset = 0
    callerIntent.target.focus.offset = 0

    expect((await ticket.completion).kind).toBe('committed')
    const flush = await session.flush('materialize').completion
    if (flush.kind !== 'flushed') {
      throw new Error('Expected a flushed revision')
    }
    let exactSource = ''
    for await (const chunk of flush.source.readChunks()) {
      exactSource += chunk.text
    }
    expect(exactSource).toBe('abc')
  }

  it('copies exact intent bytes and coordinates synchronously', snapshotsCallerOwnedInput)
})
