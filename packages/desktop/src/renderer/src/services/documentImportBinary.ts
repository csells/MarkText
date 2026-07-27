import { reportAsyncFailure } from '@marktext/document-view'
import {
  decodeDocumentImportBinaryReceipt,
  MAX_DOCUMENT_IMPORT_BYTES
} from '@shared/types/documentImport'

type DroppedFileContent = Pick<File, 'name' | 'size' | 'arrayBuffer'>

export async function importDroppedFile(
  file: DroppedFileContent
): Promise<boolean> {
  try {
    if (file.size > MAX_DOCUMENT_IMPORT_BYTES) {
      throw new RangeError('Dropped document exceeds the supported size')
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const rawReceipt = await window.electron.ipcRenderer.invoke(
      'mt::document-import::binary',
      {
        schema: 'document-import-binary-request-1',
        name: file.name,
        bytes
      }
    )
    decodeDocumentImportBinaryReceipt(rawReceipt)
    return true
  } catch (error) {
    reportAsyncFailure(error, 'Dropped document import')
    return false
  }
}
