import { describe, expect, it, vi } from 'vitest'
import type {
  DocumentCoreHistoryState,
  DocumentCoreLifecycleIntent,
  DocumentCoreSaveReceipt
} from '@shared/types/documentCore'
import {
  coordinateDocumentLifecycle,
  type DocumentLifecycleDocument
} from 'main_renderer/documentCore/documentLifecycleCoordinator'

const cleanHistory = Object.freeze({
  canUndo: false,
  canRedo: false,
  dirty: false,
  headIdentity: 'history:clean',
  savedIdentity: 'history:clean'
}) satisfies DocumentCoreHistoryState

const dirtyHistory = Object.freeze({
  canUndo: true,
  canRedo: false,
  dirty: true,
  headIdentity: 'history:dirty',
  savedIdentity: 'history:clean'
}) satisfies DocumentCoreHistoryState

function document(
  documentId: string,
  historyState: DocumentCoreHistoryState
): DocumentLifecycleDocument {
  return Object.freeze({
    documentId,
    filename: `${documentId}.md`,
    pathname: `/notes/${documentId}.md`,
    historyState
  })
}

function written(documentId: string): DocumentCoreSaveReceipt {
  return Object.freeze({
    schema: 'document-core-save-receipt-1',
    kind: 'written',
    documentId,
    pathname: `/notes/${documentId}.md`,
    revisionId: `revision:${documentId}`,
    historyState: cleanHistory
  })
}

function harness(
  documents: readonly DocumentLifecycleDocument[],
  confirmation: 'save' | 'discard' | 'cancel' = 'discard'
) {
  const events: string[] = []
  const inspectDocuments = vi.fn(async() => documents)
  const confirmUnsaved = vi.fn(async() => confirmation)
  const save = vi.fn(async(documentId: string) => {
    events.push(`save:${documentId}`)
    return written(documentId)
  })
  const close = vi.fn(async(documentId: string) => {
    events.push(`close:${documentId}`)
  })
  const publishClosed = vi.fn((documentIds: readonly string[]) => {
    events.push(`publish:${documentIds.join(',')}`)
  })
  const closeWindow = vi.fn(() => {
    events.push('close-window')
  })
  return {
    events,
    dependencies: {
      inspectDocuments,
      confirmUnsaved,
      save,
      close,
      publishClosed,
      closeWindow
    }
  }
}

async function run(
  intent: DocumentCoreLifecycleIntent,
  documents: readonly DocumentLifecycleDocument[],
  confirmation: 'save' | 'discard' | 'cancel' = 'discard'
) {
  const state = harness(documents, confirmation)
  const receipt = await coordinateDocumentLifecycle(
    intent,
    state.dependencies
  )
  return { ...state, receipt }
}

describe('main-owned document lifecycle coordinator', () => {
  it('derives save-all targets from every main-owned history state', async() => {
    const clean = document('clean', cleanHistory)
    const dirty = document('background-dirty', dirtyHistory)

    const { dependencies, receipt } = await run(
      { kind: 'save-all' },
      [clean, dirty]
    )

    expect(dependencies.save).toHaveBeenCalledExactlyOnceWith(
      'background-dirty'
    )
    expect(receipt).toEqual({
      schema: 'document-core-lifecycle-receipt-1',
      kind: 'completed',
      savedDocumentIds: ['background-dirty'],
      closedDocumentIds: []
    })
  })

  it('closes every main-owned document, including never-mounted tabs', async() => {
    const { dependencies, events, receipt } = await run(
      { kind: 'close-all' },
      [
        document('mounted', cleanHistory),
        document('never-mounted', cleanHistory)
      ]
    )

    expect(dependencies.close.mock.calls).toEqual([
      ['mounted'],
      ['never-mounted']
    ])
    expect(events).toEqual([
      'close:mounted',
      'close:never-mounted',
      'publish:mounted,never-mounted'
    ])
    expect(receipt.closedDocumentIds).toEqual([
      'mounted',
      'never-mounted'
    ])
  })

  it('decides close-saved from main history rather than renderer cache', async() => {
    const { dependencies } = await run(
      { kind: 'close-saved' },
      [
        document('actually-clean', cleanHistory),
        document('actually-dirty', dirtyHistory)
      ]
    )

    expect(dependencies.close).toHaveBeenCalledExactlyOnceWith(
      'actually-clean'
    )
    expect(dependencies.confirmUnsaved).not.toHaveBeenCalled()
  })

  it('uses main-owned filenames when confirming dirty close targets', async() => {
    const target = document('dirty', dirtyHistory)
    const { dependencies, events } = await run(
      { kind: 'close-document', documentId: target.documentId },
      [target],
      'save'
    )

    expect(dependencies.confirmUnsaved).toHaveBeenCalledWith([target])
    expect(events).toEqual([
      'save:dirty',
      'close:dirty',
      'publish:dirty'
    ])
  })

  it('does not close anything when the user cancels confirmation', async() => {
    const { dependencies, receipt } = await run(
      { kind: 'close-all' },
      [document('dirty', dirtyHistory)],
      'cancel'
    )

    expect(dependencies.save).not.toHaveBeenCalled()
    expect(dependencies.close).not.toHaveBeenCalled()
    expect(dependencies.publishClosed).not.toHaveBeenCalled()
    expect(receipt.kind).toBe('cancelled')
  })

  it('does not close anything when a requested save is cancelled', async() => {
    const state = harness(
      [document('untitled', dirtyHistory)],
      'save'
    )
    state.dependencies.save.mockResolvedValueOnce(Object.freeze({
      schema: 'document-core-save-receipt-1',
      kind: 'cancelled',
      documentId: 'untitled'
    }))

    const receipt = await coordinateDocumentLifecycle(
      { kind: 'close-all' },
      state.dependencies
    )

    expect(state.dependencies.close).not.toHaveBeenCalled()
    expect(state.dependencies.publishClosed).not.toHaveBeenCalled()
    expect(receipt.kind).toBe('cancelled')
  })

  it('closes all documents except the main-owned keep identity', async() => {
    const { dependencies } = await run(
      { kind: 'close-others', keepDocumentId: 'keep' },
      [
        document('before', cleanHistory),
        document('keep', cleanHistory),
        document('after', cleanHistory)
      ]
    )

    expect(dependencies.close.mock.calls).toEqual([
      ['before'],
      ['after']
    ])
  })

  it('rejects a document identity outside the authenticated owner set', async() => {
    const state = harness([document('owned', cleanHistory)])

    await expect(coordinateDocumentLifecycle(
      { kind: 'close-document', documentId: 'forged' },
      state.dependencies
    )).rejects.toThrow('forged')
    expect(state.dependencies.close).not.toHaveBeenCalled()
  })

  it('publishes only successfully closed identities before reporting failure', async() => {
    const state = harness([
      document('closed', cleanHistory),
      document('failed', cleanHistory)
    ])
    state.dependencies.close.mockImplementation(async(documentId: string) => {
      state.events.push(`close:${documentId}`)
      if (documentId === 'failed') throw new Error('worker stuck')
    })

    await expect(coordinateDocumentLifecycle(
      { kind: 'close-all' },
      state.dependencies
    )).rejects.toThrow('worker stuck')
    expect(state.dependencies.publishClosed).toHaveBeenCalledWith(['closed'])
    expect(state.events).toEqual([
      'close:closed',
      'close:failed',
      'publish:closed'
    ])
  })

  it('closes the native window only after every hosted document and UI receipt', async() => {
    const { events, dependencies } = await run(
      { kind: 'close-window' },
      [
        document('one', cleanHistory),
        document('two', cleanHistory)
      ]
    )

    expect(events).toEqual([
      'close:one',
      'close:two',
      'publish:one,two',
      'close-window'
    ])
    expect(dependencies.closeWindow).toHaveBeenCalledOnce()
  })
})
