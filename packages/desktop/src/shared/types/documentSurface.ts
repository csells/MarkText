import {
  closedRecord as decodeClosedRecord
} from './closedRecord'
export const DOCUMENT_SURFACES = Object.freeze([
  'markup',
  'source',
  'original',
  'revised'
] as const)

export type DocumentSurface = (typeof DOCUMENT_SURFACES)[number]

export interface DocumentSurfaceContextRequest {
  readonly requestId: string
  readonly x: number
  readonly y: number
}

export type DocumentSurfaceContextResponse =
  | Readonly<{
    requestId: string
    documentId: string
    revisionId: string
    surface: DocumentSurface
  }>
  | Readonly<{
    requestId: string
    documentId: null
    revisionId: null
    surface: null
  }>

export interface DocumentClipboardMenuState {
  readonly surface: DocumentSurface
  readonly hasSelection: boolean
}

/**
 * The menu projection of the per-revision intent capability snapshot
 * (G5/G8): the enablement bits main's Edit menu reads. The renderer derives
 * it from the one published snapshot, never from ad-hoc editor state.
 */
export interface DocumentCapabilityMenuState {
  readonly undo: boolean
  readonly redo: boolean
  readonly duplicateBlock: boolean
  readonly insertParagraph: boolean
  readonly deleteBlock: boolean
}

export interface DocumentClipboardConsumerPolicy {
  readonly copyAsRich: boolean
  readonly copyAsHtml: boolean
  readonly pasteAsPlainText: boolean
}

const closedRecord = (
  value: unknown,
  fields: readonly string[],
  label: string
): Readonly<Record<string, unknown>> =>
  decodeClosedRecord(value, label, { required: fields })

const identity = (value: unknown, label: string): string => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4096 ||
    value.includes('\0')
  ) {
    throw new TypeError(`${label} must be one bounded non-empty identity`)
  }
  return value
}

const coordinate = (value: unknown, label: string): number => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    Math.abs(value) > 1_000_000
  ) {
    throw new TypeError(`${label} must be one bounded integer coordinate`)
  }
  return value
}

const documentSurface = (
  value: unknown,
  label: string
): DocumentSurface => {
  if (
    typeof value !== 'string' ||
    !DOCUMENT_SURFACES.includes(value as DocumentSurface)
  ) {
    throw new TypeError(`${label} is not a document surface`)
  }
  return value as DocumentSurface
}

export const decodeDocumentSurfaceContextRequest = (
  value: unknown
): DocumentSurfaceContextRequest => {
  const request = closedRecord(
    value,
    ['requestId', 'x', 'y'],
    'Document surface context request'
  )
  return Object.freeze({
    requestId: identity(
      request.requestId,
      'Document surface context requestId'
    ),
    x: coordinate(request.x, 'Document surface context x'),
    y: coordinate(request.y, 'Document surface context y')
  })
}

export const decodeDocumentSurfaceContextResponse = (
  value: unknown
): DocumentSurfaceContextResponse => {
  const response = closedRecord(
    value,
    ['requestId', 'documentId', 'revisionId', 'surface'],
    'Document surface context response'
  )
  const requestId = identity(
    response.requestId,
    'Document surface context requestId'
  )
  if (
    response.documentId === null &&
    response.revisionId === null &&
    response.surface === null
  ) {
    return Object.freeze({
      requestId,
      documentId: null,
      revisionId: null,
      surface: null
    })
  }
  if (
    response.documentId === null ||
    response.revisionId === null ||
    response.surface === null
  ) {
    throw new TypeError(
      'Document surface identity fields must be all present or all null'
    )
  }
  return Object.freeze({
    requestId,
    documentId: identity(
      response.documentId,
      'Document surface documentId'
    ),
    revisionId: identity(
      response.revisionId,
      'Document surface revisionId'
    ),
    surface: documentSurface(
      response.surface,
      'Document surface context surface'
    )
  })
}

export const decodeDocumentCapabilityMenuState = (
  value: unknown
): DocumentCapabilityMenuState => {
  const state = closedRecord(
    value,
    ['undo', 'redo', 'duplicateBlock', 'insertParagraph', 'deleteBlock'],
    'Document capability menu state'
  )
  for (const bit of [
    state.undo,
    state.redo,
    state.duplicateBlock,
    state.insertParagraph,
    state.deleteBlock
  ]) {
    if (typeof bit !== 'boolean') {
      throw new TypeError(
        'Document capability menu state must carry boolean enablement'
      )
    }
  }
  return Object.freeze({
    undo: state.undo as boolean,
    redo: state.redo as boolean,
    duplicateBlock: state.duplicateBlock as boolean,
    insertParagraph: state.insertParagraph as boolean,
    deleteBlock: state.deleteBlock as boolean
  })
}

export const decodeDocumentClipboardMenuState = (
  value: unknown
): DocumentClipboardMenuState => {
  const state = closedRecord(
    value,
    ['surface', 'hasSelection'],
    'Document clipboard menu state'
  )
  if (typeof state.hasSelection !== 'boolean') {
    throw new TypeError(
      'Document clipboard menu hasSelection must be a boolean'
    )
  }
  return Object.freeze({
    surface: documentSurface(
      state.surface,
      'Document clipboard menu surface'
    ),
    hasSelection: state.hasSelection
  })
}

export const documentSurfaceFromProjection = (
  projection: 'marked' | 'original' | 'revised'
): Exclude<DocumentSurface, 'source'> =>
  projection === 'marked' ? 'markup' : projection

/**
 * Menu availability is a projection of the document engine's clipboard
 * consumer policy: semantic copies exist in all rendered projections, Source
 * uses its native text commands, and mutation is available only in Markup.
 */
export const documentClipboardConsumerPolicy = (
  state: DocumentClipboardMenuState
): DocumentClipboardConsumerPolicy => {
  const semanticCopy =
    state.hasSelection && state.surface !== 'source'
  return Object.freeze({
    copyAsRich: semanticCopy,
    copyAsHtml: semanticCopy,
    pasteAsPlainText: state.surface === 'markup'
  })
}
