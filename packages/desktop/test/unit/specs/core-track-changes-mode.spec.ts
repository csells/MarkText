import { describe, expect, it } from 'vitest'

import {
  canToggleCoreTrackChanges,
  createCoreTrackChangesMode,
  createCoreTrackChangesModes
} from '@/documentAuthority/coreTrackChangesMode'

describe('Core Track Changes mode', () => {
  it('retains the authoring mode until the user changes it', () => {
    const mode = createCoreTrackChangesMode()
    expect(mode.enabled()).toBe(false)
    expect(mode.toggle()).toBe(true)
    expect(mode.enabled()).toBe(true)
    expect(mode.enabled()).toBe(true)
    expect(mode.toggle()).toBe(false)
    expect(mode.enabled()).toBe(false)
  })

  it('keeps one mode per open document across its views until the document closes', () => {
    const modes = createCoreTrackChangesModes()
    modes.forDocument('a').toggle()
    expect(modes.forDocument('a').enabled()).toBe(true)
    expect(modes.forDocument('b').enabled()).toBe(false)
    modes.forget('a')
    expect(modes.forDocument('a').enabled()).toBe(false)
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
