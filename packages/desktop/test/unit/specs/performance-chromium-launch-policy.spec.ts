import { describe, expect, it } from 'vitest'

import {
  PERFORMANCE_CHROMIUM_SCHEDULING_POLICY,
  PERFORMANCE_CHROMIUM_SCHEDULING_SWITCHES,
  withPerformanceChromiumScheduling
} from '../../e2e/helpers/performanceChromiumLaunchPolicy'

describe('hidden performance Chromium launch policy', () => {
  it('uses one exact anti-throttling policy for external and Playwright launches', () => {
    expect(PERFORMANCE_CHROMIUM_SCHEDULING_POLICY)
      .toBe('hidden-unthrottled-rendering-v1')
    expect(PERFORMANCE_CHROMIUM_SCHEDULING_SWITCHES).toEqual([
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows'
    ])

    const externalArgs = withPerformanceChromiumScheduling([
      '--inspect-brk=5858',
      '--remote-debugging-port=5859',
      'upstream.md'
    ])
    const playwrightElectronArgs = withPerformanceChromiumScheduling([
      '--user-data-dir',
      '/tmp/profile',
      'core.md'
    ])

    expect(externalArgs).toEqual([
      ...PERFORMANCE_CHROMIUM_SCHEDULING_SWITCHES,
      '--inspect-brk=5858',
      '--remote-debugging-port=5859',
      'upstream.md'
    ])
    expect(playwrightElectronArgs).toEqual([
      ...PERFORMANCE_CHROMIUM_SCHEDULING_SWITCHES,
      '--user-data-dir',
      '/tmp/profile',
      'core.md'
    ])
    expect(Object.isFrozen(PERFORMANCE_CHROMIUM_SCHEDULING_SWITCHES)).toBe(true)
    expect(Object.isFrozen(externalArgs)).toBe(true)
    expect(Object.isFrozen(playwrightElectronArgs)).toBe(true)
  })
})
