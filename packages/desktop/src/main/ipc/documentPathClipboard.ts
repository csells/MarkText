import {
  clipboard,
  ipcMain,
  type WebContents
} from 'electron'
import type {
  DocumentPathClipboardReceipt
} from '@shared/types/clipboardTransactions'
import {
  describeDocumentCoreFile
} from './documentCore'
import {
  decodeDocumentPathClipboardRequest
} from './documentPathClipboardRuntimeCodec'

export interface DocumentPathClipboardDescription {
  readonly documentId: string
  readonly pathname: string | null
}

export interface DocumentPathClipboardDependencies {
  readonly describeDocument: (
    sender: WebContents,
    documentId: string
  ) => DocumentPathClipboardDescription
  readonly writeText: (text: string) => void
}

const productionDependencies: DocumentPathClipboardDependencies =
  Object.freeze({
    describeDocument: (sender: WebContents, documentId: string) =>
      describeDocumentCoreFile(sender, documentId),
    writeText: (text: string) => clipboard.writeText(text)
  })

export function registerDocumentPathClipboardHandler(
  dependencies: DocumentPathClipboardDependencies = productionDependencies
): void {
  ipcMain.handle(
    'mt::document::copy-path',
    async(
      event,
      rawRequest: unknown
    ): Promise<DocumentPathClipboardReceipt> => {
      const request = decodeDocumentPathClipboardRequest(rawRequest)
      const document = dependencies.describeDocument(
        event.sender,
        request.documentId
      )
      if (document.documentId !== request.documentId) {
        throw new Error(
          'Document path resolver returned another document identity'
        )
      }
      if (document.pathname === null) {
        throw new Error('Untitled document has no admitted pathname')
      }
      dependencies.writeText(document.pathname)
      return Object.freeze({
        schema: 'document-path-clipboard-receipt-1',
        kind: 'written'
      })
    }
  )
}
