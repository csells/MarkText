import { onBeforeUnmount, type Ref } from 'vue'
import {
  decodeDocumentSurfaceContextRequest,
  documentSurfaceFromProjection,
  type DocumentSurface,
  type DocumentSurfaceContextResponse
} from '@shared/types/documentSurface'

interface SurfaceEditor {
  readonly getProjection: () => 'marked' | 'original' | 'revised'
  readonly snapshot: () => Readonly<{ revisionId: string }>
}

interface DocumentSurfaceContextOptions {
  readonly editor: Readonly<Ref<SurfaceEditor | null>>
  readonly documentId: Readonly<Ref<string | null>>
  readonly sourceCode: Readonly<Ref<boolean>>
  readonly semanticRoot: Readonly<Ref<HTMLElement | null>>
}

const surfaceAtPoint = (
  options: DocumentSurfaceContextOptions,
  x: number,
  y: number
): DocumentSurface | null => {
  const hit = document.elementFromPoint(x, y)
  const semanticRoot = options.semanticRoot.value
  if (!(hit instanceof Element) || semanticRoot === null) return null

  if (options.sourceCode.value) {
    const editorWrapper = semanticRoot.closest('.editor-wrapper')
    const surfaceContainer = editorWrapper?.parentElement ?? null
    const sourceRoot = hit.closest('[data-document-surface="source"]')
    return sourceRoot !== null &&
      surfaceContainer?.contains(sourceRoot) === true
      ? 'source'
      : null
  }

  if (!semanticRoot.contains(hit)) return null
  const targetEditor = options.editor.value
  return targetEditor === null
    ? null
    : documentSurfaceFromProjection(targetEditor.getProjection())
}

export const useDocumentSurfaceContext = (
  options: DocumentSurfaceContextOptions
): void => {
  const handleQuery = (_event: unknown, value: unknown): void => {
    let request
    try {
      request = decodeDocumentSurfaceContextRequest(value)
    } catch {
      return
    }

    const targetEditor = options.editor.value
    const documentId = options.documentId.value
    let response: DocumentSurfaceContextResponse = {
      requestId: request.requestId,
      documentId: null,
      revisionId: null,
      surface: null
    }
    try {
      const surface = targetEditor === null
        ? null
        : surfaceAtPoint(options, request.x, request.y)
      if (
        targetEditor !== null &&
        surface !== null &&
        documentId !== null
      ) {
        response = {
          requestId: request.requestId,
          documentId,
          revisionId: targetEditor.snapshot().revisionId,
          surface
        }
      }
    } catch {
      // Stale DOM or editor identity fails closed at this IPC boundary.
    }
    window.electron.ipcRenderer.send(
      'mt::document-surface-context-response',
      response
    )
  }

  const stop = window.electron.ipcRenderer.on(
    'mt::query-document-surface-context',
    handleQuery
  )
  onBeforeUnmount(stop)
}
