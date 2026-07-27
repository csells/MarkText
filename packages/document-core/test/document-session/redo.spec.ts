import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createMemoryDocumentSessionJournalStorage,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'
import { requireCompleteSnapshot } from '../helpers/completeSnapshot.js'

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

describe('DocumentSession redo', () => {
  it('publishes a stable recovered identity for each undo position', async() => {
    const session = await createDocumentSession({
      source: createSourceSnapshot('A'),
      parseConfiguration: TEST_CONFIGURATION,
      configuration: { authoringTextPolicy: 'nearest-owner-eol-v1' },
      initialView: 'markup',
      trackChanges: false,
      initialSelection: {
        anchor: { offset: 1, affinity: 'next' },
        focus: { offset: 1, affinity: 'next' }
      }
    })
    const historyState = (
      session as unknown as {
        historyState: () => {
          canUndo: boolean
          canRedo: boolean
          headIdentity: string
        }
      }
    ).historyState
    const initial = historyState()
    expect(initial).toMatchObject({ canUndo: false, canRedo: false })

    const target = session.snapshot().revision.selection
    if (target === null) throw new Error('Expected an initial selection')
    await session.dispatch({
      kind: 'insert-text',
      target,
      text: 'B'
    }).completion
    const edited = historyState()
    expect(edited).toMatchObject({ canUndo: true, canRedo: false })
    expect(edited.headIdentity).not.toBe(initial.headIdentity)

    await session.dispatch({ kind: 'undo' }).completion
    expect(historyState()).toMatchObject({
      canUndo: false,
      canRedo: true,
      headIdentity: initial.headIdentity
    })

    const divergentTarget = session.snapshot().revision.selection
    if (divergentTarget === null) throw new Error('Expected a divergent target')
    await session.dispatch({
      kind: 'insert-text',
      target: divergentTarget,
      text: 'C'
    }).completion
    const divergent = historyState()
    expect(divergent).toMatchObject({ canUndo: true, canRedo: false })
    expect(divergent.headIdentity).not.toBe(edited.headIdentity)
  })

  it('recovers the same undo position and head identity from the journal', async() => {
    const storage = createMemoryDocumentSessionJournalStorage()
    const options = {
      source: createSourceSnapshot('A'),
      parseConfiguration: TEST_CONFIGURATION,
      configuration: {
        authoringTextPolicy: 'nearest-owner-eol-v1' as const
      },
      initialView: 'markup' as const,
      trackChanges: false,
      initialSelection: {
        anchor: { offset: 1, affinity: 'next' as const },
        focus: { offset: 1, affinity: 'next' as const }
      },
      durability: {
        key: 'history-state-recovery',
        storage
      }
    }
    const first = await createDocumentSession(options)
    const target = first.snapshot().revision.selection
    if (target === null) throw new Error('Expected an initial selection')
    await first.dispatch({
      kind: 'insert-text',
      target,
      text: 'B'
    }).completion
    const saved = first.historyState()
    await (
      first as unknown as {
        markPersisted: (headIdentity: string) => Promise<unknown>
      }
    ).markPersisted(saved.headIdentity)
    const nextTarget = first.snapshot().revision.selection
    if (nextTarget === null) throw new Error('Expected another selection')
    await first.dispatch({
      kind: 'insert-text',
      target: nextTarget,
      text: 'C'
    }).completion
    const beforeLoss = first.historyState()

    const recovered = await createDocumentSession(options)
    expect(recovered.historyState()).toEqual(beforeLoss)
    expect(recovered.historyState()).toMatchObject({
      canUndo: true,
      canRedo: false,
      dirty: true,
      savedIdentity: saved.headIdentity
    })
    await recovered.dispatch({ kind: 'undo' }).completion
    expect(recovered.historyState()).toMatchObject({
      canUndo: true,
      canRedo: true,
      dirty: false,
      headIdentity: saved.headIdentity,
      savedIdentity: saved.headIdentity
    })
  })

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
    expect(requireCompleteSnapshot(undo.transition.after).livePlan.modelLength).toBe(5)

    const redo = await session.dispatch({ kind: 'redo' }).completion
    if (redo.kind !== 'committed') {
      throw new Error('Expected redo to commit')
    }
    expect(redo.transition).toMatchObject({ cause: 'redo', history: 'none' })
    const afterRedo = requireCompleteSnapshot(redo.transition.after)
    expect(afterRedo.livePlan.modelLength).toBe(6)
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
