import type { IReconcileRegion } from '@muyajs/core'

/**
 * The roots presented since an editor last reconciled that a further view
 * change can have replaced, as one range: roots `[start, previousEnd)` of the
 * presented document are roots `[start, nextEnd)` of the latest view. A later
 * change widens it to cover both changes; an unchanged gap between them is
 * compared again, which is only redundant.
 */
export function composeMuyaReconcileRegion(
  pending: IReconcileRegion | undefined,
  change: IReconcileRegion
): IReconcileRegion {
  if (pending === undefined) return change
  const pendingDelta = pending.nextEnd - pending.previousEnd
  // The change's end in presented coordinates: roots after the pending
  // range moved by its delta, and one inside it ends with it.
  const changeEnd =
    change.previousEnd < pending.start
      ? change.previousEnd
      : change.previousEnd <= pending.nextEnd
        ? pending.previousEnd
        : change.previousEnd - pendingDelta
  const start = Math.min(pending.start, change.start)
  const previousEnd = Math.max(pending.previousEnd, changeEnd)
  return {
    start,
    previousEnd,
    nextEnd: previousEnd + pendingDelta + change.nextEnd - change.previousEnd
  }
}
