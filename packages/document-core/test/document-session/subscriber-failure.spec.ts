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

describe('DocumentSession subscribers', () => {
  async function containsAsynchronousSubscriberFailure(): Promise<void> {
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

    const failure = Promise.reject(new Error('subscriber failed'))
    const originalCatch = failure.catch.bind(failure)
    let rejectionWasObserved = false
    failure.catch = (handler) => {
      rejectionWasObserved = true
      return originalCatch(handler)
    }
    session.subscribe(() => failure)

    const result = await session.dispatch({
      kind: 'insert-text',
      target,
      text: 'b'
    }).completion
    if (!rejectionWasObserved) {
      await originalCatch(() => undefined)
    }

    expect(result.kind).toBe('committed')
    expect(rejectionWasObserved).toBe(true)
  }

  it(
    'observes rejected subscriber promises without changing commit',
    containsAsynchronousSubscriberFailure
  )
})
