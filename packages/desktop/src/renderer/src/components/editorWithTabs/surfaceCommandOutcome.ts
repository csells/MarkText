/**
 * The visible half of command availability.
 *
 * A command that cannot run in the current surface rejects visibly; a handler
 * that returns without an effect is indistinguishable to the user from one
 * that worked. Every surface command presents its outcome through this one
 * module so the rejection vocabulary and its presentation live in one place.
 */

export const SURFACE_COMMAND_UNAVAILABLE_KEY = 'editor.commandUnavailableHere'
export const SURFACE_COMMAND_UNAVAILABLE_EXCLUSIVE_TYPE =
  'surfaceCommandUnavailable'

export type SurfaceCommandOutcome =
  | Readonly<{ kind: 'executed' }>
  | Readonly<{ kind: 'unavailable-in-surface'; surface: 'source' | 'markup' }>

export interface SurfaceCommandNotificationSink {
  pushTabNotification: (data: {
    tabId: string
    msg: string
    showConfirm?: boolean
    style?: string
    exclusiveType?: string
  }) => void
}

export function presentSurfaceCommandOutcome(
  outcome: SurfaceCommandOutcome,
  tabId: string,
  sink: SurfaceCommandNotificationSink,
  translate: (key: string) => string
): void {
  if (outcome.kind === 'executed') return
  // One exclusive banner: repeated attempts replace rather than stack, and no
  // rejection steals focus from the surface the user is working in.
  sink.pushTabNotification({
    tabId,
    msg: translate(SURFACE_COMMAND_UNAVAILABLE_KEY),
    showConfirm: false,
    style: 'warn',
    exclusiveType: SURFACE_COMMAND_UNAVAILABLE_EXCLUSIVE_TYPE
  })
}
