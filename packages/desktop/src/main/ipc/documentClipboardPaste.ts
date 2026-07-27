import {
  clipboard,
  ipcMain,
  type WebContents
} from 'electron'
import type {
  DocumentCoreMainDispatchRequest,
  DocumentCorePublication
} from '@shared/types/documentCore'
import {
  assertDocumentCoreRevision,
  dispatchDocumentCoreIntent
} from './documentCore'
import {
  decodeDocumentClipboardPasteRequest
} from './documentClipboardPasteRuntimeCodec'
import {
  decodeDocumentCoreMainDispatchRequest
} from './documentCoreRuntimeCodec'
import {
  decodeDocumentClipboardHtml
} from './documentClipboardHtmlAuthority'

export interface DocumentClipboardPasteDependencies {
  readonly assertRevision: (
    sender: WebContents,
    documentId: string,
    revisionId: string
  ) => Promise<void>
  readonly readHtml: () => string
  readonly readText: () => string
  readonly dispatch: (
    sender: WebContents,
    request: DocumentCoreMainDispatchRequest
  ) => Promise<DocumentCorePublication>
}

const productionDependencies: DocumentClipboardPasteDependencies =
  Object.freeze({
    assertRevision: assertDocumentCoreRevision,
    readHtml: () => clipboard.readHTML(),
    readText: () => clipboard.readText(),
    dispatch: dispatchDocumentCoreIntent
  })

export function registerDocumentClipboardPasteHandler(
  dependencies: DocumentClipboardPasteDependencies = productionDependencies
): void {
  ipcMain.handle(
    'mt::document::paste-clipboard',
    async(event, rawRequest: unknown): Promise<DocumentCorePublication> => {
      const request = decodeDocumentClipboardPasteRequest(rawRequest)
      await dependencies.assertRevision(
        event.sender,
        request.documentId,
        request.target.revision
      )

      // Clipboard material is read only after owner/revision authentication,
      // remains in main, and is admitted through the normal intent codec.
      const decoded = decodeDocumentClipboardHtml(dependencies.readHtml())
      if (decoded.kind === 'invalid') {
        throw new TypeError('Invalid document clipboard HTML envelope')
      }
      const authenticated = decoded.kind === 'authenticated'
      const text = authenticated
        ? decoded.source
        : dependencies.readText()
      const dispatch = decodeDocumentCoreMainDispatchRequest({
        documentId: request.documentId,
        baseSnapshotId: request.baseSnapshotId,
        intent: {
          kind: 'paste-text',
          target: request.target,
          text,
          source: authenticated
            ? 'raw-source-import'
            : 'external-text'
        }
      })
      return await dependencies.dispatch(event.sender, dispatch)
    }
  )
}
