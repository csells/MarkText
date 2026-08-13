export type CoreAuthorityPerformancePhase =
  | 'open-request'
  | 'open-ack'
  | 'first-editable-viewport'
  | 'dispatch'
  | 'ack'
  | 'reconcile'

type CoreAuthorityPerformanceTransactionFact = Readonly<{
  readonly transaction: number
}>

export type CoreAuthorityPerformanceEvent = Readonly<{
  readonly phase: 'open-request' | 'open-ack'
  readonly documentId: string
  readonly at: number
}> | Readonly<{
  readonly phase: 'first-editable-viewport'
  readonly surface: 'wysiwyg' | 'source'
  readonly documentId: string
  readonly at: number
}> | Readonly<{
  readonly phase: 'dispatch'
  readonly documentId: string
  readonly transaction: number
  readonly pendingDepth: number
  readonly at: number
}> | Readonly<{
  readonly phase: 'ack'
  readonly documentId: string
  readonly transaction: number
  readonly at: number
}> | Readonly<{
  readonly phase: 'reconcile'
  readonly documentId: string
  readonly transaction: number
  readonly corrected: boolean
  readonly at: number
}>

export interface CoreAuthorityPerformanceTrace {
  record(
    phase: 'open-request' | 'open-ack',
    documentId: string
  ): void
  record(
    phase: 'first-editable-viewport',
    documentId: string,
    fact: Readonly<{ readonly surface: 'wysiwyg' | 'source' }>
  ): void
  capture(event: CoreAuthorityPerformanceEvent): void
  record(
    phase: 'dispatch',
    documentId: string,
    fact: CoreAuthorityPerformanceTransactionFact &
      Readonly<{ readonly pendingDepth: number }>
  ): void
  record(
    phase: 'ack',
    documentId: string,
    fact: CoreAuthorityPerformanceTransactionFact
  ): void
  record(
    phase: 'reconcile',
    documentId: string,
    fact: CoreAuthorityPerformanceTransactionFact &
      Readonly<{ readonly corrected: boolean }>
  ): void
  events(): readonly CoreAuthorityPerformanceEvent[]
  status(): Readonly<{
    readonly accepting: boolean
    readonly eventCount: number
    readonly stopReason?: 'capacity'
  }>
}

export async function measureCoreDocumentOpen<T>(
  trace: CoreAuthorityPerformanceTrace | undefined,
  documentId: string,
  open: () => Promise<T>
): Promise<T> {
  trace?.record('open-request', documentId)
  const result = await open()
  trace?.record('open-ack', documentId)
  return result
}

export function createCoreAuthorityPerformanceTrace(options: Readonly<{
  readonly clock?: () => number
  readonly maximumEvents?: number
}> = {}): CoreAuthorityPerformanceTrace {
  const clock = options.clock ?? (() => performance.now())
  const maximumEvents = options.maximumEvents ?? 4096
  if (!Number.isSafeInteger(maximumEvents) || maximumEvents < 1) {
    throw new RangeError('Core performance trace capacity must be positive')
  }
  const recorded: CoreAuthorityPerformanceEvent[] = []

  const capture = (event: CoreAuthorityPerformanceEvent): void => {
    if (
      recorded.length >= maximumEvents || event.documentId.length === 0 ||
      !Number.isFinite(event.at) || event.at < 0
    ) return
    if (
      event.phase === 'open-request' || event.phase === 'open-ack'
    ) {
      recorded.push(Object.freeze({ ...event }))
      return
    }
    if (event.phase === 'first-editable-viewport') {
      if (event.surface !== 'wysiwyg' && event.surface !== 'source') return
      recorded.push(Object.freeze({ ...event }))
      return
    }
    if (
      !('transaction' in event) || !Number.isSafeInteger(event.transaction) ||
      event.transaction < 1
    ) return
    if (
      event.phase === 'dispatch' &&
      (!Number.isSafeInteger(event.pendingDepth) || event.pendingDepth < 1)
    ) return
    recorded.push(Object.freeze({ ...event }))
  }

  const record = (
    phase: CoreAuthorityPerformancePhase,
    documentId: string,
    fact?: CoreAuthorityPerformanceTransactionFact & Readonly<{
      readonly pendingDepth?: number
      readonly corrected?: boolean
      readonly surface?: 'wysiwyg' | 'source'
    }>
  ): void => {
    if (recorded.length >= maximumEvents || documentId.length === 0) return
    const at = clock()
    if (!Number.isFinite(at) || at < 0) return
    if (
      phase === 'open-request' || phase === 'open-ack'
    ) {
      capture(Object.freeze({ phase, documentId, at }))
      return
    }
    if (phase === 'first-editable-viewport') {
      if (fact?.surface !== 'wysiwyg' && fact?.surface !== 'source') return
      capture(Object.freeze({ phase, documentId, surface: fact.surface, at }))
      return
    }
    if (!Number.isSafeInteger(fact?.transaction) || fact!.transaction < 1) return
    if (phase === 'dispatch') {
      if (!Number.isSafeInteger(fact?.pendingDepth) || fact!.pendingDepth! < 1) return
      capture(Object.freeze({
        phase,
        documentId,
        transaction: fact!.transaction,
        pendingDepth: fact!.pendingDepth!,
        at
      }))
      return
    }
    if (phase === 'ack') {
      capture(Object.freeze({
        phase,
        documentId,
        transaction: fact!.transaction,
        at
      }))
      return
    }
    if (typeof fact?.corrected !== 'boolean') return
    capture(Object.freeze({
      phase,
      documentId,
      transaction: fact.transaction,
      corrected: fact.corrected,
      at
    }))
  }

  return Object.freeze({
    record,
    capture,
    events: () => Object.freeze(recorded.map(event => Object.freeze({ ...event }))),
    status: () => Object.freeze({
      accepting: recorded.length < maximumEvents,
      eventCount: recorded.length,
      ...(recorded.length >= maximumEvents
        ? { stopReason: 'capacity' as const }
        : {})
    })
  }) as CoreAuthorityPerformanceTrace
}
