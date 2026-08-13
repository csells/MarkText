import { describe, expect, it } from 'vitest'

import {
  canToggleCoreTrackChanges,
  createCoreTrackChangesMode
} from '@/documentAuthority/coreTrackChangesMode'

describe('Core Track Changes mode', () => {
  it('keeps routing native changes through Track Changes until the user turns it off', () => {
    const routed: string[] = []
    const mode = createCoreTrackChangesMode({
      accept: () => {
        routed.push('plain')
        return 'accepted'
      },
      acceptTracked: () => {
        routed.push('tracked')
        return 'accepted'
      }
    })

    expect(mode.enabled()).toBe(false)
    expect(mode.toggle()).toBe(true)
    expect(mode.accept({ id: 1 })).toEqual({
      result: 'accepted',
      tracked: true
    })
    expect(mode.accept({ id: 2 })).toEqual({
      result: 'accepted',
      tracked: true
    })
    expect(mode.enabled()).toBe(true)

    expect(mode.toggle()).toBe(false)
    expect(mode.accept({ id: 3 })).toEqual({
      result: 'accepted',
      tracked: false
    })
    expect(routed).toEqual(['tracked', 'tracked', 'plain'])
  })

  it('can always be turned off after annotations leave no editable paragraph', () => {
    expect(canToggleCoreTrackChanges({
      enabled: true,
      editableBindingCount: 0,
      resolving: false
    })).toBe(true)
    expect(canToggleCoreTrackChanges({
      enabled: false,
      editableBindingCount: 0,
      resolving: false
    })).toBe(false)
    expect(canToggleCoreTrackChanges({
      enabled: true,
      editableBindingCount: 0,
      resolving: true
    })).toBe(false)
  })
})
