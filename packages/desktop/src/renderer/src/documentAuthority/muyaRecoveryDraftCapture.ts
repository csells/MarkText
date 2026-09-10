import type { Muya } from '@muyajs/core'
import type { CoreRecoveryDraftInput } from '@shared/types/coreRecoveryDraft'
import type { CoreDocumentViewLease } from './coreDocumentSessionManager'

/** Failure-only snapshot of the native draft owned by one desktop view lease. */
export function createMuyaRecoveryDraftCapture(input: {
  muya: Muya
  lease: CoreDocumentViewLease
  pathname: string | undefined
  nativeIntent: () => unknown
  acknowledgedView: () => unknown
}) {
  let captured: CoreRecoveryDraftInput | undefined
  return (error: unknown): CoreRecoveryDraftInput | undefined => {
    if (captured !== undefined) return captured
    // Keep the native draft alive with its lease until drain or durable backup.
    // Vue's mounted editor reference may already be cleared by this point.
    const muya = input.muya
    muya.flush()
    const nativeState = structuredClone(muya.getState())
    const visibleText = muya.domNode.innerText ?? muya.domNode.textContent ?? ''
    muya.setEditablePaths([])
    captured = {
      documentId: input.lease.documentId,
      pathname: input.pathname,
      generation: input.lease.identity.generation,
      revision: input.lease.identity.revision,
      reason: error instanceof Error ? error.message : String(error),
      visibleText,
      nativeState,
      nativeIntent: input.nativeIntent(),
      acknowledgedView: structuredClone(input.acknowledgedView())
    }
    return captured
  }
}
