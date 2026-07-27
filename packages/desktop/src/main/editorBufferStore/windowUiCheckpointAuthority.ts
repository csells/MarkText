import {
  decodeBufferedState,
  type BufferedState,
  type WindowUiCheckpointIntent
} from '@shared/types/bufferedState'

export interface WindowUiCheckpointAuthority {
  readonly rootDirectory: string
  readonly retainedDocumentIds: readonly string[]
}

/**
 * Turn renderer-authored presentation intent into a main-owned checkpoint.
 *
 * The renderer can choose presentation order, selection, scroll positions,
 * and layout only for the exact set of documents already retained by main.
 */
export function authorizeWindowUiCheckpoint(
  intent: WindowUiCheckpointIntent,
  authority: WindowUiCheckpointAuthority
): BufferedState {
  const retainedById = new Map(
    authority.retainedDocumentIds.map(documentId => [
      documentId,
      documentId
    ])
  )
  if (
    retainedById.size !== authority.retainedDocumentIds.length ||
    intent.tabs.length !== retainedById.size ||
    intent.tabs.some(tab => !retainedById.has(tab.documentId))
  ) {
    throw new Error(
      'Window UI checkpoint tabs must be an exact permutation of retained documents'
    )
  }
  if (
    intent.tabs.length > 0 &&
    intent.currentDocumentId === null
  ) {
    throw new Error(
      'Window UI checkpoint must have a selected admitted document'
    )
  }

  return decodeBufferedState({
    schema: 'document-core-window-ui-1',
    currentDocumentId:
      intent.currentDocumentId === null
        ? null
        : retainedById.get(intent.currentDocumentId) ?? null,
    tabs: intent.tabs.map(tab => ({
      documentId: retainedById.get(tab.documentId),
      scrollTop: tab.scrollTop
    })),
    project: {
      rootDirectory: authority.rootDirectory
    },
    layout: intent.layout
  })
}
