import type { CoreDocumentViewLease } from './coreDocumentSessionManager'

export type CoreDocumentViewState = 'source' | 'reconciling' | 'wysiwyg'

export interface CoreDocumentViewHandoffManager {
  saveBarrier(documentId: string): Promise<Readonly<{ source: string }>>
  handoff(lease: CoreDocumentViewLease): Promise<void>
}

export interface CoreDocumentViewHandoffInput {
  readonly manager: CoreDocumentViewHandoffManager
  readonly lease: CoreDocumentViewLease
  readonly reconcile: (documentId: string, source: string) => void
  readonly setState: (state: CoreDocumentViewState) => void
}

/** Keeps the outgoing source projection authoritative until reconciliation. */
export async function handoffCoreDocumentView(
  input: CoreDocumentViewHandoffInput
): Promise<void> {
  input.setState('reconciling')
  try {
    const snapshot = await input.manager.saveBarrier(input.lease.documentId)
    input.reconcile(input.lease.documentId, snapshot.source)
    await input.manager.handoff(input.lease)
    input.setState('wysiwyg')
  } catch (error) {
    input.setState('source')
    throw error
  }
}
