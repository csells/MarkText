import { ipcMain, type WebContents } from 'electron'
import path from 'node:path'
import {
  decodeDocumentImportBinaryReceipt,
  type DocumentImportBinaryReceipt
} from '@shared/types/documentImport'
import {
  decodeDocumentImportBinaryRequest
} from './documentImportBinaryRuntimeCodec'
import { hasMarkdownExtension } from 'common/filesystem/paths'
import { PANDOC_EXTENSIONS } from '../config'

export interface DocumentImportBinaryEditor {
  readonly admitImportedMarkdown: (source: string) => void | Promise<void>
  readonly notifyPandocUnavailable: () => void
}

export interface DocumentImportBinaryHandlerDependencies {
  readonly resolveEditor: (
    sender: WebContents
  ) => DocumentImportBinaryEditor | null
  readonly decodeMarkdown: (bytes: Uint8Array) => string
  readonly isPandocAvailable: () => boolean
  readonly convertPandoc: (
    extension: string,
    bytes: Uint8Array
  ) => Promise<string>
}

export function registerDocumentImportBinaryHandler(
  dependencies: DocumentImportBinaryHandlerDependencies
): void {
  ipcMain.handle(
    'mt::document-import::binary',
    async(event, rawRequest: unknown): Promise<DocumentImportBinaryReceipt> => {
      // Close the complete renderer envelope before resolving its sender or
      // touching the filesystem/process boundary.
      const request = decodeDocumentImportBinaryRequest(rawRequest)
      const editor = dependencies.resolveEditor(event.sender)
      if (editor === null) {
        throw new Error(
          'Binary document import requires a sender-owned editor window'
        )
      }
      if (hasMarkdownExtension(request.name)) {
        const source = dependencies.decodeMarkdown(request.bytes)
        await editor.admitImportedMarkdown(source)
        return decodeDocumentImportBinaryReceipt({
          schema: 'document-import-binary-receipt-1',
          disposition: 'opened-markdown'
        })
      }
      const extension = path.extname(request.name).slice(1).toLowerCase()
      if (!PANDOC_EXTENSIONS.includes(extension)) {
        throw new TypeError('Unsupported document import filename')
      }
      if (!dependencies.isPandocAvailable()) {
        editor.notifyPandocUnavailable()
        return decodeDocumentImportBinaryReceipt({
          schema: 'document-import-binary-receipt-1',
          disposition: 'pandoc-unavailable'
        })
      }
      const source = await dependencies.convertPandoc(
        extension,
        request.bytes
      )
      await editor.admitImportedMarkdown(source)
      return decodeDocumentImportBinaryReceipt({
        schema: 'document-import-binary-receipt-1',
        disposition: 'converted'
      })
    }
  )
}
