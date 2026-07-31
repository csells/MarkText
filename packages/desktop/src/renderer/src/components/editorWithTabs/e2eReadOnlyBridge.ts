type ReadOnlyBridge = NonNullable<Window['__marktextE2EReadOnly']>

/** Install the opt-in test bridge and return an ownership-safe disposer. */
export const installE2EReadOnlyBridge = (
  host: Window,
  enabled: boolean,
  readCanonicalMarkdown: () => string,
  readLastExecutionReport: ReadOnlyBridge['readLastExecutionReport']
): (() => void) => {
  if (!enabled) return () => {}

  const bridge: ReadOnlyBridge = Object.freeze({
    readCanonicalMarkdown,
    readLastExecutionReport
  })
  Object.defineProperty(host, '__marktextE2EReadOnly', {
    configurable: true,
    enumerable: false,
    value: bridge,
    writable: false
  })

  return () => {
    if (host.__marktextE2EReadOnly === bridge) {
      Reflect.deleteProperty(host, '__marktextE2EReadOnly')
    }
  }
}
