import type {
  DocumentCoreHistoryState,
  DocumentCoreLifecycleIntent,
  DocumentCoreLifecycleReceipt,
  DocumentCoreSaveReceipt
} from '../../shared/types/documentCore'

export interface DocumentLifecycleDocument {
  readonly documentId: string
  readonly filename: string
  readonly pathname: string | null
  readonly historyState: DocumentCoreHistoryState
}

export type DocumentLifecycleConfirmation = 'save' | 'discard' | 'cancel'

export interface DocumentLifecycleDependencies {
  readonly inspectDocuments: () => Promise<
    readonly DocumentLifecycleDocument[]
  >
  readonly confirmUnsaved: (
    documents: readonly DocumentLifecycleDocument[]
  ) => Promise<DocumentLifecycleConfirmation>
  readonly save: (documentId: string) => Promise<DocumentCoreSaveReceipt>
  readonly close: (documentId: string) => Promise<void>
  /**
   * Publish only identities whose main-owned FileHost close completed.
   * Renderer state is a projection of this receipt, never the authority.
   */
  readonly publishClosed: (documentIds: readonly string[]) => void
  readonly closeWindow: () => void
}

function targetDocuments(
  intent: DocumentCoreLifecycleIntent,
  documents: readonly DocumentLifecycleDocument[]
): readonly DocumentLifecycleDocument[] {
  if (intent.kind === 'save-all' || intent.kind === 'close-all' ||
      intent.kind === 'close-window') {
    return documents
  }
  if (intent.kind === 'close-saved') {
    return documents.filter(({ historyState }) => !historyState.dirty)
  }
  if (intent.kind === 'close-document') {
    const target = documents.find(
      ({ documentId }) => documentId === intent.documentId
    )
    if (target === undefined) {
      throw new Error(
        `Document ${intent.documentId} is not owned by this renderer`
      )
    }
    return [target]
  }
  const keep = documents.find(
    ({ documentId }) => documentId === intent.keepDocumentId
  )
  if (keep === undefined) {
    throw new Error(
      `Document ${intent.keepDocumentId} is not owned by this renderer`
    )
  }
  return documents.filter(
    ({ documentId }) => documentId !== intent.keepDocumentId
  )
}

function receipt(
  kind: DocumentCoreLifecycleReceipt['kind'],
  savedDocumentIds: readonly string[],
  closedDocumentIds: readonly string[]
): DocumentCoreLifecycleReceipt {
  return Object.freeze({
    schema: 'document-core-lifecycle-receipt-1',
    kind,
    savedDocumentIds: Object.freeze([...savedDocumentIds]),
    closedDocumentIds: Object.freeze([...closedDocumentIds])
  })
}

async function saveDocuments(
  documents: readonly DocumentLifecycleDocument[],
  save: DocumentLifecycleDependencies['save']
): Promise<Readonly<{
  completed: boolean
  savedDocumentIds: readonly string[]
}>> {
  const savedDocumentIds: string[] = []
  // Save sequentially so two untitled documents cannot race native dialogs.
  for (const { documentId } of documents) {
    const result = await save(documentId)
    if (result.kind !== 'written') {
      return Object.freeze({
        completed: false,
        savedDocumentIds: Object.freeze(savedDocumentIds)
      })
    }
    savedDocumentIds.push(documentId)
  }
  return Object.freeze({
    completed: true,
    savedDocumentIds: Object.freeze(savedDocumentIds)
  })
}

/**
 * Resolve one semantic lifecycle intent entirely from main-owned documents.
 *
 * The caller authenticates the owner once in its dependency closures. No
 * renderer-provided dirty list, filename, path, or source participates.
 */
export async function coordinateDocumentLifecycle(
  intent: DocumentCoreLifecycleIntent,
  dependencies: DocumentLifecycleDependencies
): Promise<DocumentCoreLifecycleReceipt> {
  const documents = await dependencies.inspectDocuments()
  const targets = targetDocuments(intent, documents)
  const dirtyTargets = targets.filter(({ historyState }) => historyState.dirty)

  if (intent.kind === 'save-all') {
    const saved = await saveDocuments(dirtyTargets, dependencies.save)
    return receipt(
      saved.completed ? 'completed' : 'cancelled',
      saved.savedDocumentIds,
      []
    )
  }

  let savedDocumentIds: readonly string[] = []
  if (dirtyTargets.length > 0) {
    const confirmation = await dependencies.confirmUnsaved(dirtyTargets)
    if (confirmation === 'cancel') {
      return receipt('cancelled', [], [])
    }
    if (confirmation === 'save') {
      const saved = await saveDocuments(dirtyTargets, dependencies.save)
      savedDocumentIds = saved.savedDocumentIds
      if (!saved.completed) {
        return receipt('cancelled', savedDocumentIds, [])
      }
    }
  }

  const closedDocumentIds: string[] = []
  try {
    for (const { documentId } of targets) {
      await dependencies.close(documentId)
      closedDocumentIds.push(documentId)
    }
  } catch (error) {
    if (closedDocumentIds.length > 0) {
      dependencies.publishClosed(Object.freeze([...closedDocumentIds]))
    }
    throw error
  }

  if (closedDocumentIds.length > 0) {
    dependencies.publishClosed(Object.freeze([...closedDocumentIds]))
  }
  if (intent.kind === 'close-window') {
    dependencies.closeWindow()
  }
  return receipt('completed', savedDocumentIds, closedDocumentIds)
}
