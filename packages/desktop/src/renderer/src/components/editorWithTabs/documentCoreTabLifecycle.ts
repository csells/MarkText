export type DocumentCoreTabCloser = (documentId: string) => Promise<void>

let activeCloser: DocumentCoreTabCloser | null = null

/**
 * Bind the one mounted document host to renderer tab lifetime.
 *
 * The returned disposer only removes its own registration, so a delayed
 * teardown cannot disconnect a newer mounted editor.
 */
export function registerDocumentCoreTabCloser(
  closer: DocumentCoreTabCloser
): Readonly<{ dispose: () => void }> {
  activeCloser = closer
  return Object.freeze({
    dispose: () => {
      if (activeCloser === closer) activeCloser = null
    }
  })
}

/** Await release of a tab's main-owned document session, when one is mounted. */
export function closeDocumentCoreTab(documentId: string): Promise<void> {
  return activeCloser?.(documentId) ?? Promise.resolve()
}
