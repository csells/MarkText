export interface CoreTrackChangesMode {
  enabled(): boolean
  toggle(): boolean
}

/** Each open document's Track Changes mode, which outlives the views bound to it. */
export interface CoreTrackChangesModes {
  forDocument(documentId: string): CoreTrackChangesMode
  forget(documentId: string): void
}

export function canToggleCoreTrackChanges(
  input: Readonly<{
    readonly enabled: boolean
    readonly editableBindingCount: number
    readonly resolving: boolean
  }>
): boolean {
  return !input.resolving && (input.enabled || input.editableBindingCount > 0)
}

/**
 * Keeps the visible Track Changes toggle independent from one transaction.
 * Actual model operations capture this value before editing begins.
 */
export function createCoreTrackChangesMode(): CoreTrackChangesMode {
  let enabled = false

  return Object.freeze({
    enabled: () => enabled,
    toggle(): boolean {
      enabled = !enabled
      return enabled
    }
  })
}

/**
 * Track Changes stays on for a document until the user turns it off, as
 * suggesting mode does in Google Docs, through Source mode and tab switches
 * that replace the document's view.
 */
export function createCoreTrackChangesModes(): CoreTrackChangesModes {
  const modes = new Map<string, CoreTrackChangesMode>()

  return Object.freeze({
    forDocument(documentId: string): CoreTrackChangesMode {
      let mode = modes.get(documentId)
      if (mode === undefined) {
        mode = createCoreTrackChangesMode()
        modes.set(documentId, mode)
      }
      return mode
    },
    forget(documentId: string): void {
      modes.delete(documentId)
    }
  })
}
