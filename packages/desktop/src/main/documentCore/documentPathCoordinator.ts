import type {
  DocumentCorePathReceipt
} from '../../shared/types/documentCore'
import type {
  DocumentCoreFileHost
} from './documentFileHost'

interface DocumentPathRelocation {
  readonly ownerId: string
  readonly documentId: string
  readonly targetPathname: string
  readonly relocate: DocumentCoreFileHost['relocate']
  readonly retarget: (receipt: DocumentCorePathReceipt) => void
}

/**
 * The single post-commit coordination seam for a document path transition.
 *
 * FileHost owns the serialized filesystem/durable-metadata transaction.
 * Opened-path lists and watchers may move only after that transaction returns
 * its closed receipt.
 */
export async function coordinateDocumentPathRelocation({
  ownerId,
  documentId,
  targetPathname,
  relocate,
  retarget
}: DocumentPathRelocation): Promise<DocumentCorePathReceipt> {
  const receipt = await relocate(ownerId, {
    documentId,
    targetPathname
  })
  retarget(receipt)
  return receipt
}
