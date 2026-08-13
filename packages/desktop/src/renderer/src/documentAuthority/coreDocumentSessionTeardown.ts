import type {
  CoreDocumentSessionManager,
  CoreDocumentViewLease
} from './coreDocumentSessionManager'

export interface CoreDocumentSessionTeardownInput {
  readonly manager: CoreDocumentSessionManager
  readonly transition: Promise<unknown>
  readonly finalLease: () => CoreDocumentViewLease | undefined
  readonly clearFinalLease: () => void
  readonly documentIds: Iterable<string>
}

/**
 * Drains the final attached view, then destroys every Core session. Cleanup is
 * best-effort across all documents while the first failure remains observable.
 */
export async function teardownCoreDocumentSessions(
  input: CoreDocumentSessionTeardownInput
): Promise<void> {
  let failure: unknown
  try {
    await input.transition
    const lease = input.finalLease()
    input.clearFinalLease()
    if (lease !== undefined) await input.manager.handoff(lease)
  } catch (error) {
    failure = error
  }

  for (const documentId of input.documentIds) {
    try {
      input.manager.abort(documentId)
    } catch (error) {
      failure ??= error
    }
  }
  if (failure !== undefined) throw failure
}
