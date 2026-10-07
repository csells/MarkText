import { describe, expect, it, vi } from 'vitest'
import { resolveMuyaViewAcknowledgement } from '@/documentAuthority/resolveMuyaViewAcknowledgement'
import type { CoreAppliedReply } from '@/documentAuthority/coreProtocol'
import type { MuyaMarkupView } from '@/documentAuthority/muyaMarkupView'

const outcome = (revision: number, edits: number): CoreAppliedReply =>
  ({
    type: 'applied',
    session: 1,
    sequence: 1,
    revision,
    accepted: true,
    sourceLength: 10,
    diagnosticCount: 0,
    diagnostics: [],
    change: {
      appliedEdits: Array.from({ length: edits }, () => ({ start: 0, end: 0, insert: 'x' })),
      projections: []
    }
  }) as unknown as CoreAppliedReply

describe('Muya view acknowledgement', () => {
  const presented = { bindings: [] } as unknown as MuyaMarkupView
  const projected = { bindings: [] } as unknown as MuyaMarkupView

  it('keeps the presented view for an input that only moves the selection', () => {
    // Such as ArrowDown out of a table: projecting a long document again
    // stalled the key.
    const project = vi.fn(() => ({ view: projected }))
    const lease = { projectAcknowledgedPlainTextView: project } as never
    const acknowledged = resolveMuyaViewAcknowledgement({
      lease,
      outcome: outcome(7, 0),
      previousView: presented,
      previousRevision: 7,
      currentEditor: () => null
    })
    expect(acknowledged.view).toBe(presented)
    expect(project).not.toHaveBeenCalled()
  })

  it('projects the acknowledged revision when the document changed', () => {
    const project = vi.fn(() => ({ view: projected }))
    const lease = { projectAcknowledgedPlainTextView: project } as never
    for (const [revision, edits, previousRevision] of [
      [8, 1, 6],
      [7, 0, 6],
      [7, 0, undefined]
    ] as const) {
      expect(
        resolveMuyaViewAcknowledgement({
          lease,
          outcome: outcome(revision, edits),
          previousView: previousRevision === undefined ? undefined : presented,
          previousRevision,
          currentEditor: () => null
        }).view
      ).toBe(projected)
    }
  })
})
