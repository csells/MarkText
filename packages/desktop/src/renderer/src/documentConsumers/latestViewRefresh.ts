/**
 * Publishes only the newest asynchronous view read. Invalidating input keeps
 * actions disabled until a current read succeeds; disposal also rejects late
 * replies and errors from an outgoing document. Scheduling stays with the host.
 */
export function createLatestViewRefresh<T>(host: Readonly<{
  publish(value: T): void
  pending(value: boolean): void
  fault(error: unknown): void
}>) {
  let generation = 0
  let disposed = false
  return Object.freeze({
    invalidate(): void {
      if (disposed) return
      generation += 1
      host.pending(true)
    },
    async request(read: (current: () => boolean) => Promise<T | undefined>): Promise<void> {
      if (disposed) return
      const requestedGeneration = ++generation
      const current = (): boolean => !disposed && requestedGeneration === generation
      host.pending(true)
      try {
        const value = await read(current)
        if (!current() || value === undefined) return
        host.publish(value)
        host.pending(false)
      } catch (error) {
        if (current()) host.fault(error)
      }
    },
    dispose(): void {
      disposed = true
      generation += 1
      host.pending(false)
    }
  })
}
