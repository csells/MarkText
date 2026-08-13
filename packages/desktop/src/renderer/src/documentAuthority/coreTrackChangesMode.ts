export type CoreTrackChangesAdmission = 'accepted' | 'unsupported'

export type CoreTrackChangesRoute = Readonly<{
  readonly result: CoreTrackChangesAdmission
  readonly tracked: boolean
}>

export interface CoreTrackChangesMode {
  enabled(): boolean
  toggle(): boolean
  reset(): void
  accept(change: unknown): CoreTrackChangesRoute
}

export interface CoreTrackChangesModeLanes {
  readonly accept: (change: unknown) => CoreTrackChangesAdmission
  readonly acceptTracked: (change: unknown) => CoreTrackChangesAdmission
}

export function canToggleCoreTrackChanges(input: Readonly<{
  readonly enabled: boolean
  readonly editableBindingCount: number
  readonly resolving: boolean
}>): boolean {
  return !input.resolving && (input.enabled || input.editableBindingCount > 0)
}

/**
 * Keeps the visible Track Changes toggle independent from one transaction.
 * The editor owns when the mode is enabled; the adapter lanes own admission.
 */
export function createCoreTrackChangesMode(
  lanes: CoreTrackChangesModeLanes
): CoreTrackChangesMode {
  let enabled = false

  return Object.freeze({
    enabled: () => enabled,
    toggle(): boolean {
      enabled = !enabled
      return enabled
    },
    reset(): void {
      enabled = false
    },
    accept(change: unknown): CoreTrackChangesRoute {
      const tracked = enabled
      return Object.freeze({
        result: tracked
          ? lanes.acceptTracked(change)
          : lanes.accept(change),
        tracked
      })
    }
  })
}
