import { reportAsyncFailure } from '@marktext/document-view'
import {
  decodeDocumentPathClipboardReceipt
} from '@shared/types/clipboardTransactions'

export async function copyAdmittedDocumentPath(
  documentId: string
): Promise<boolean> {
  try {
    const receipt = await window.electron.ipcRenderer.invoke(
      'mt::document::copy-path',
      {
        schema: 'document-path-clipboard-1',
        documentId
      }
    )
    decodeDocumentPathClipboardReceipt(receipt)
    return true
  } catch (error) {
    reportAsyncFailure(error, 'Copy admitted document path')
    return false
  }
}
