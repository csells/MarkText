import { describe, expect, it } from 'vitest'

import {
  canToggleCoreTrackChanges,
  createCoreTrackChangesMode
} from '@/documentAuthority/coreTrackChangesMode'

describe('Core Track Changes mode', () => {
  it('retains the authoring mode until the user changes it or the view retires', () => {
    const mode = createCoreTrackChangesMode()
    expect(mode.enabled()).toBe(false)
    expect(mode.toggle()).toBe(true)
    expect(mode.enabled()).toBe(true)
    expect(mode.enabled()).toBe(true)
    expect(mode.toggle()).toBe(false)
    expect(mode.enabled()).toBe(false)
    mode.toggle()
    mode.reset()
    expect(mode.enabled()).toBe(false)
  })

  it('can always be turned off after annotations leave no editable paragraph', () => {
    expect(
      canToggleCoreTrackChanges({
        enabled: true,
        editableBindingCount: 0,
        resolving: false
      })
    ).toBe(true)
    expect(
      canToggleCoreTrackChanges({
        enabled: false,
        editableBindingCount: 0,
        resolving: false
      })
    ).toBe(false)
    expect(
      canToggleCoreTrackChanges({
        enabled: true,
        editableBindingCount: 0,
        resolving: true
      })
    ).toBe(false)
  })
})
