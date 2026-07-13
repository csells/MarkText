type ReadOnlyBridge = NonNullable<Window['__marktextE2EReadOnly']>

/** Install the opt-in test bridge and return an ownership-safe disposer. */
export const installE2EReadOnlyBridge = (
  host: Window,
  enabled: boolean,
  readCanonicalMarkdown: () => string
): (() => void) => {
  if (!enabled) return () => {}

  const bridge: ReadOnlyBridge = Object.freeze({ readCanonicalMarkdown })
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
