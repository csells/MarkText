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

describe('DocumentSession redo', () => {
  async function reappliesTheForwardTransaction(): Promise<void> {
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
    const undo = await session.dispatch({ kind: 'undo' }).completion
    if (undo.kind !== 'committed') {
      throw new Error('Expected undo to commit')
    }
    expect(undo.transition).toMatchObject({ cause: 'undo', history: 'none' })
    expect(undo.transition.after.livePlan.modelLength).toBe(5)

    const redo = await session.dispatch({ kind: 'redo' }).completion
    if (redo.kind !== 'committed') {
      throw new Error('Expected redo to commit')
    }
    expect(redo.transition).toMatchObject({ cause: 'redo', history: 'none' })
    expect(redo.transition.after.livePlan.modelLength).toBe(6)
    expect(redo.transition.after.revision.selection).toMatchObject({
      anchor: { offset: 6, affinity: 'next' },
      focus: { offset: 6, affinity: 'next' }
    })

    const flushed = await session.flush('materialize').completion
    if (flushed.kind !== 'flushed') {
      throw new Error('Expected an exact source lease')
    }
    let source = ''
    for await (const chunk of flushed.source.readChunks()) {
      source += chunk.text
    }
    expect(source).toBe('a{++new++}b!')
  }

  it('reapplies the recorded source transaction after undo', reappliesTheForwardTransaction)
})
