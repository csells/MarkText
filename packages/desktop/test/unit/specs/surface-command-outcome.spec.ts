import { describe, expect, it, vi } from 'vitest'
import {
  SURFACE_COMMAND_UNAVAILABLE_KEY,
  SURFACE_COMMAND_UNAVAILABLE_EXCLUSIVE_TYPE,
  presentSurfaceCommandOutcome
} from '@/components/editorWithTabs/surfaceCommandOutcome'

describe('surface command outcome', () => {
  // Non-negotiable 10: a required command that cannot run rejects visibly.
  // A handler that returns without an effect is indistinguishable from one
  // that worked, which is the defect this presenter exists to remove.
  it('presents one visible rejection when a command is unavailable here', () => {
    const pushTabNotification = vi.fn()
    presentSurfaceCommandOutcome(
      { kind: 'unavailable-in-surface', surface: 'source' },
      'tab-1',
      { pushTabNotification },
      (key: string) => `translated:${key}`
    )

    expect(pushTabNotification).toHaveBeenCalledTimes(1)
    expect(pushTabNotification).toHaveBeenCalledWith({
      tabId: 'tab-1',
      msg: `translated:${SURFACE_COMMAND_UNAVAILABLE_KEY}`,
      showConfirm: false,
      style: 'warn',
      exclusiveType: SURFACE_COMMAND_UNAVAILABLE_EXCLUSIVE_TYPE
    })
  })

  it('presents nothing when the command executed', () => {
    const pushTabNotification = vi.fn()
    presentSurfaceCommandOutcome(
      { kind: 'executed' },
      'tab-1',
      { pushTabNotification },
      (key: string) => key
    )

    expect(pushTabNotification).not.toHaveBeenCalled()
  })

  it('collapses repeats onto one exclusive banner rather than stacking', () => {
    const pushTabNotification = vi.fn()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      presentSurfaceCommandOutcome(
        { kind: 'unavailable-in-surface', surface: 'source' },
        'tab-1',
        { pushTabNotification },
        (key: string) => key
      )
    }

    const exclusiveTypes = new Set(
      pushTabNotification.mock.calls.map(([data]) => data.exclusiveType)
    )
    expect(exclusiveTypes).toEqual(
      new Set([SURFACE_COMMAND_UNAVAILABLE_EXCLUSIVE_TYPE])
    )
  })
})
