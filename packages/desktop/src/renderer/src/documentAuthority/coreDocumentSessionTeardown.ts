import type {
  CoreDocumentSessionManager,
  CoreDocumentViewLease
} from './coreDocumentSessionManager'
import type { CoreRecoveryDraftInput } from '@shared/types/coreRecoveryDraft'

export function createCoreTeardownDraftPreserver(input: {
  preserve: (draft: CoreRecoveryDraftInput, lease: CoreDocumentViewLease) => void
}): (error: unknown, lease: CoreDocumentViewLease | undefined) => void {
  return (error, lease) => {
    const draft = lease?.captureRecoveryDraft(error)
    if (draft === undefined || lease === undefined) {
      throw new Error('Core teardown recovery draft is unavailable')
    }
    if (draft.documentId !== lease.documentId || draft.generation !== lease.identity.generation) {
      throw new Error('Core teardown recovery draft belongs to another view lease')
    }
    input.preserve(draft, lease)
  }
}

export interface CoreDocumentSessionTeardownInput {
  readonly manager: CoreDocumentSessionManager
  readonly transition: Promise<unknown>
  readonly finalLease: () => CoreDocumentViewLease | undefined
  readonly clearFinalLease: () => void
  readonly documentIds: Iterable<string>
  readonly preserveFailure?: (
    error: unknown,
    lease: CoreDocumentViewLease | undefined
  ) => void | Promise<void>
}

/**
 * Drains the final attached view and outstanding saves in other documents.
 * Failed final input is backed up before abort; other failures retain their
 * owning session while cleanup continues for independently drained documents.
 */
export async function teardownCoreDocumentSessions(
  input: CoreDocumentSessionTeardownInput
): Promise<void> {
  let failure: unknown
  let finalLease: CoreDocumentViewLease | undefined
  let finalDraftPreserved = false
  try {
    await input.transition
    finalLease = input.finalLease()
    input.clearFinalLease()
    if (finalLease !== undefined) await input.manager.handoff(finalLease)
  } catch (error) {
    failure = error
    finalLease ??= input.finalLease()
    // Failed input must reach durable recovery before its session is discarded.
    // A backup failure leaves the owning session available for retry.
    if (input.preserveFailure !== undefined) {
      await input.preserveFailure(error, finalLease)
      finalDraftPreserved = true
    }
  }

  const failedFinalDocument = failure === undefined ? undefined : finalLease?.documentId
  for (const documentId of input.documentIds) {
    try {
      if (documentId === failedFinalDocument) {
        if (finalDraftPreserved) input.manager.abort(documentId)
      } else {
        await input.manager.close(documentId)
      }
    } catch (error) {
      failure ??= error
    }
  }
  if (failure !== undefined) throw failure
}
