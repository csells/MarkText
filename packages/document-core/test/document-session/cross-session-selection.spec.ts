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

async function openSession(source: string) {
  return createDocumentSession({
    source: createSourceSnapshot(source),
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
}

describe('DocumentSession selection authentication', () => {
  async function rejectsAnotherSessionsSelection(): Promise<void> {
    const first = await openSession('ac')
    const second = await openSession('xy')
    const foreignTarget = first.snapshot().revision.selection
    if (foreignTarget === null) {
      throw new Error('Expected an initial selection')
    }
    const originalRevision = second.snapshot().revision

    const result = await second.dispatch({
      kind: 'insert-text',
      target: foreignTarget,
      text: 'Z'
    }).completion

    expect(result.kind).toBe('rejected')
    const flush = await second.flush('materialize').completion
    if (flush.kind !== 'blocked') {
      throw new Error('Expected retained foreign input to block a source lease')
    }
    expect(second.snapshot().revision).toEqual(originalRevision)
    expect(flush).toMatchObject({
      watermark: 1,
      reason: 'pending-input',
      retainedDrafts: [{ text: 'Z', target: foreignTarget }]
    })
  }

  it('rejects a model selection issued by another session', rejectsAnotherSessionsSelection)
})
