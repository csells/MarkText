export const PERFORMANCE_CHROMIUM_SCHEDULING_POLICY =
  'hidden-unthrottled-rendering-v1' as const

// Hidden measurement windows must keep the same Chromium scheduling policy in
// both implementations. These switches affect background scheduling only; the
// browser-event-to-DOM measurement boundary remains unchanged.
export const PERFORMANCE_CHROMIUM_SCHEDULING_SWITCHES = Object.freeze([
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows'
] as const)

export const withPerformanceChromiumScheduling = (
  applicationArguments: readonly string[]
): readonly string[] => Object.freeze([
  ...PERFORMANCE_CHROMIUM_SCHEDULING_SWITCHES,
  ...applicationArguments
])
