import type { Muya } from '@muyajs/core'

import type { CoreDocumentViewLease } from './coreDocumentSessionManager'
import type { CoreAppliedReply } from './coreProtocol'
import { applyMuyaMarkupChanges } from './muyaMarkupChanges'
import type { MuyaMarkupView } from './muyaMarkupView'

/** Resolve the acknowledged model projection while its desktop lease is owned. */
export function resolveMuyaViewAcknowledgement(input: {
  lease: CoreDocumentViewLease | undefined
  outcome: CoreAppliedReply
  previousView: MuyaMarkupView | undefined
  previousRevision: number | undefined
  currentEditor: () => Muya | null
}) {
  const { lease, outcome, previousView, previousRevision } = input
  if (lease === undefined) {
    throw new Error('Core Muya history view is unavailable')
  }
  const regional = outcome.change.projections.find(
    (change) => change.name === 'markup' && change.scope === 'regions'
  )
  const patched =
    previousView !== undefined &&
    previousRevision === outcome.revision - 1 &&
    regional?.name === 'markup' &&
    regional.scope === 'regions'
      ? applyMuyaMarkupChanges(previousView, regional)
      : undefined
  // An input that only moves the selection is accepted at the same revision,
  // whose view is the one already presented.
  const unchanged =
    previousView !== undefined &&
    previousRevision === outcome.revision &&
    outcome.change.appliedEdits.length === 0
  const view = unchanged
    ? previousView
    : (patched ?? lease.projectAcknowledgedPlainTextView(outcome.revision).view)
  // A native view can be destroyed while its lease is draining queued input.
  // Acknowledgement still advances the model; only a surviving view is painted.
  // Read the live view reference only after the owned projection is available.
  return { view, muya: input.currentEditor() }
}
