export interface CoreDocumentRetirementManager {
  close(documentId: string): Promise<void>
  abort(documentId: string): void
}

export interface RetireClosedCoreDocumentSessionsInput {
  readonly manager: CoreDocumentRetirementManager
  readonly openedDocumentIds: Set<string>
  readonly liveDocumentIds: ReadonlySet<string>
  readonly registrations: Map<string, () => void>
}

/**
 * Retires actor authority after the owning tab has left the durable tab set.
 * A failed graceful close is aborted because no view remains that could
 * reconcile the session; registration cleanup is unconditional.
 */
export async function retireClosedCoreDocumentSessions(
  input: RetireClosedCoreDocumentSessionsInput
): Promise<void> {
  let failure: unknown
  for (const documentId of [...input.openedDocumentIds]) {
    if (input.liveDocumentIds.has(documentId)) continue
    try {
      await input.manager.close(documentId)
    } catch (error) {
      failure ??= error
      try {
        input.manager.abort(documentId)
      } catch (abortError) {
        failure ??= abortError
      }
    } finally {
      input.registrations.get(documentId)?.()
      input.registrations.delete(documentId)
      input.openedDocumentIds.delete(documentId)
    }
  }
  if (failure !== undefined) throw failure
}
