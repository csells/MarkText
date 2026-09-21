export interface CoreTrackChangesMode {
  enabled(): boolean
  toggle(): boolean
  reset(): void
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
    },
    reset(): void {
      enabled = false
    }
  })
}
