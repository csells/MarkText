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
  let interactive: { generation: number, settled: Promise<void>, release(): void } | undefined
  return Object.freeze({
    invalidate(): void {
      if (disposed) return
      generation += 1
      interactive?.release()
      interactive = undefined
      host.pending(true)
    },
    async request(
      read: (current: () => boolean) => Promise<T | undefined>,
      options: Readonly<{ passive?: boolean }> = {}
    ): Promise<void> {
      if (disposed) return
      // Background presentation must neither cancel a user's navigation nor
      // disable an already-valid button between pointer down and click.
      if (options.passive && interactive !== undefined) {
        const preceding = interactive
        await preceding.settled
        if (disposed || preceding.generation !== generation) return
      }
      const requestedGeneration = ++generation
      const current = (): boolean => !disposed && requestedGeneration === generation
      let active: typeof interactive
      if (!options.passive) {
        let release!: () => void
        const settled = new Promise<void>(resolve => { release = resolve })
        active = { generation: requestedGeneration, settled, release }
        interactive?.release()
        interactive = active
        host.pending(true)
      }
      try {
        const value = await read(current)
        if (!current() || value === undefined) return
        host.publish(value)
        host.pending(false)
      } catch (error) {
        if (current()) host.fault(error)
      } finally {
        if (active !== undefined) {
          if (interactive === active) interactive = undefined
          active.release()
        }
      }
    },
    dispose(): void {
      disposed = true
      interactive?.release()
      interactive = undefined
      generation += 1
      host.pending(false)
    }
  })
}
