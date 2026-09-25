import { afterEach, beforeEach, vi, type MockInstance } from 'vitest'

/**
 * Upstream History joins every change made within one second of the step it
 * opened into that undo step. Specs that check each action's own undo entry
 * space their actions past that window, as a user pausing between them would.
 */
export const separateUndoSteps = (): { hold: () => void } => {
  let clock: MockInstance<() => number> | undefined
  let spaced = true
  beforeEach(() => {
    let now = 1_000_000
    spaced = true
    clock = vi.spyOn(Date, 'now').mockImplementation(() => (spaced ? (now += 1_001) : now))
  })
  afterEach(() => {
    clock?.mockRestore()
    clock = undefined
  })
  return {
    /** Act without pausing for the rest of this spec, like fast typing. */
    hold: () => {
      spaced = false
    }
  }
}

/**
 * A real clock whose `pause()` moves past upstream's one-second undo window,
 * for a spec that checks one action's own undo entry among grouped ones.
 */
export const undoWindowClock = (): { pause: () => void } => {
  let offset = 0
  let clock: MockInstance<() => number> | undefined
  beforeEach(() => {
    offset = 0
    const now = Date.now.bind(Date)
    clock = vi.spyOn(Date, 'now').mockImplementation(() => now() + offset)
  })
  afterEach(() => {
    clock?.mockRestore()
    clock = undefined
  })
  return {
    pause: () => {
      offset += 1_001
    }
  }
}
