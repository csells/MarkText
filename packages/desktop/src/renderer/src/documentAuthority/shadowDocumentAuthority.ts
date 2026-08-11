import type {
  DocumentSourceEdit,
  MarkdownOptions
} from '@marktext/document-core'

import type {
  ShadowActorPort,
  ShadowQueueContext,
  ShadowRejectionReason,
  ShadowReply,
  ShadowRequest
} from './protocol'

export interface ShadowOpenInput {
  readonly source: string
  readonly options?: Readonly<Partial<MarkdownOptions>>
  readonly documentId?: string
}

export interface ShadowTicket {
  readonly sequence: number
  readonly state: 'queued' | 'disabled' | 'unchanged'
  readonly reason?: ShadowRejectionReason
}

export interface ShadowReport extends ShadowReply {
  readonly documentId?: string
  readonly terminal?: boolean
}

export interface ShadowDocumentAuthority {
  readonly mode: 'shadow'
  readonly diagnosticOnly: true
  open(input: ShadowOpenInput): ShadowTicket
  observe(nextSource: string): ShadowTicket
  close(): ShadowTicket
  settled(): Promise<void>
  reports(): readonly ShadowReport[]
  dispose(): void
}

export interface ShadowDocumentAuthorityOptions {
  readonly port: ShadowActorPort
  /** Includes the in-flight request. */
  readonly maxPending?: number
  /**
   * Bounds renderer-side snapshot comparison and retained queued strings.
   * Larger live documents remain entirely upstream-authoritative and disable
   * this optional Shadow session until its next explicit open barrier.
   */
  readonly maxDiffSourceUnits?: number
  /** Retained diagnostic-only results; older reports are discarded. */
  readonly maxReports?: number
}

type ShadowJob =
  | Readonly<{
    readonly type: 'open'
    readonly session: number
    readonly generation: number
    readonly sequence: number
    readonly source: string
    readonly options?: Readonly<Partial<MarkdownOptions>>
    readonly documentId?: string
    readonly queue: ShadowQueueContext
  }>
  | Readonly<{
    readonly type: 'observe'
    readonly session: number
    readonly generation: number
    readonly sequence: number
    readonly previousSource: string
    readonly nextSource: string
    readonly documentId?: string
    readonly queue: ShadowQueueContext
  }>
  | Readonly<{
    readonly type: 'close'
    readonly session: number
    readonly generation: number
    readonly sequence: number
    readonly documentId?: string
    readonly queue: ShadowQueueContext
  }>

const DEFAULT_MAX_PENDING = 4
const DEFAULT_MAX_REPORTS = 256
const DEFAULT_MAX_DIFF_SOURCE_UNITS = 262_144
let nextAuthoritySession = 1

function exactSingleSplice(
  previous: string,
  next: string
): readonly DocumentSourceEdit[] {
  if (previous === next) return Object.freeze([])

  const sharedLimit = Math.min(previous.length, next.length)
  let start = 0
  while (start < sharedLimit && previous[start] === next[start]) start += 1

  let previousEnd = previous.length
  let nextEnd = next.length
  while (
    previousEnd > start &&
    nextEnd > start &&
    previous[previousEnd - 1] === next[nextEnd - 1]
  ) {
    previousEnd -= 1
    nextEnd -= 1
  }

  return Object.freeze([Object.freeze({
    start,
    end: previousEnd,
    insert: next.slice(start, nextEnd)
  })])
}

export function createShadowDocumentAuthority(
  options: ShadowDocumentAuthorityOptions
): ShadowDocumentAuthority {
  const maxPending = options.maxPending ?? DEFAULT_MAX_PENDING
  if (!Number.isInteger(maxPending) || maxPending < 1) {
    throw new RangeError('Shadow maxPending must be a positive integer')
  }
  const maxReports = options.maxReports ?? DEFAULT_MAX_REPORTS
  if (!Number.isInteger(maxReports) || maxReports < 1) {
    throw new RangeError('Shadow maxReports must be a positive integer')
  }
  const maxDiffSourceUnits = options.maxDiffSourceUnits ??
    DEFAULT_MAX_DIFF_SOURCE_UNITS
  if (!Number.isInteger(maxDiffSourceUnits) || maxDiffSourceUnits < 1) {
    throw new RangeError('Shadow maxDiffSourceUnits must be a positive integer')
  }

  let sequence = 0
  const session = nextAuthoritySession
  nextAuthoritySession += 1
  let generation = 0
  let currentRevision = 0
  let currentDocumentId: string | undefined
  let lastObservedSource: string | undefined
  let inFlight: ShadowJob | undefined
  let pumpScheduled = false
  let disabled = false
  let disableReason: ShadowRejectionReason | undefined
  let closed = true
  let disposed = false
  const queue: ShadowJob[] = []
  const reportLog: ShadowReport[] = []
  const settleWaiters = new Set<() => void>()

  const pushReport = (report: ShadowReport): void => {
    // Replies may arrive after a later request has already failed locally
    // (queue overflow) or after a replacement generation has opened. Keep the
    // diagnostic ledger in logical request order so its last item always
    // describes the newest observed request, not the latest network timing.
    let index = reportLog.length
    while (index > 0) {
      const previous = reportLog[index - 1]
      if (previous === undefined || previous.sequence <= report.sequence) break
      index -= 1
    }
    reportLog.splice(index, 0, report)
    if (reportLog.length > maxReports) reportLog.shift()
  }

  const outstanding = (): number => queue.length + (inFlight === undefined ? 0 : 1)

  const resolveSettled = (): void => {
    if (inFlight !== undefined || queue.length !== 0) return
    for (const resolve of settleWaiters) resolve()
    settleWaiters.clear()
  }

  const freezeReport = (
    reply: ShadowReply,
    job: ShadowJob,
    terminal = false
  ): ShadowReport => Object.freeze({
    ...reply,
    ...(job.documentId === undefined ? {} : { documentId: job.documentId }),
    ...(terminal ? { terminal: true } : {})
  })

  const localFailure = (
    job: ShadowJob,
    reason: ShadowRejectionReason,
    queueDepth: number
  ): ShadowReport => freezeReport(Object.freeze({
    type: 'result',
    session: job.session,
    generation: job.generation,
    sequence: job.sequence,
    revision: currentRevision,
    accepted: false,
    status: 'rejected',
    diagnosticCount: 0,
    diagnostics: Object.freeze([]),
    rejectionReason: reason,
    metrics: Object.freeze({ parseMs: 0, queueMs: 0, queueDepth })
  }), job, true)

  const dropCurrentSessionQueue = (): void => {
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (
        queue[index]?.session === session &&
        queue[index]?.generation === generation
      ) {
        queue.splice(index, 1)
      }
    }
  }

  const disableCurrentSession = (
    reason: ShadowRejectionReason = 'session-disabled'
  ): void => {
    disabled = true
    disableReason = reason
    lastObservedSource = undefined
    dropCurrentSessionQueue()
  }

  const requestOf = (job: ShadowJob): ShadowRequest => {
    if (job.type === 'open') {
      return Object.freeze({
        type: 'open',
        session: job.session,
        generation: job.generation,
        sequence: job.sequence,
        source: job.source,
        ...(job.options === undefined ? {} : { options: job.options })
      })
    }
    if (job.type === 'close') {
      return Object.freeze({
        type: 'close',
        session: job.session,
        generation: job.generation,
        sequence: job.sequence
      })
    }
    return Object.freeze({
      type: 'observe',
      session: job.session,
      generation: job.generation,
      sequence: job.sequence,
      baseRevision: currentRevision,
      edits: exactSingleSplice(job.previousSource, job.nextSource)
    })
  }

  const pump = (): void => {
    if (disposed || inFlight !== undefined) return
    const job = queue.shift()
    if (job === undefined) {
      resolveSettled()
      return
    }
    inFlight = job
    const request = requestOf(job)
    options.port.request(request, job.queue).then(reply => {
      if (disposed) return
      const isCurrentSession = job.session === session &&
        job.generation === generation
      const identityMatches = reply.session === job.session &&
        reply.generation === job.generation &&
        reply.sequence === job.sequence
      if (!identityMatches) {
        const failure = localFailure(job, 'transport-error', job.queue.queueDepth)
        pushReport(failure)
        if (isCurrentSession) disableCurrentSession('transport-error')
      } else {
        const terminal = !reply.accepted
        pushReport(freezeReport(reply, job, terminal))
        if (isCurrentSession) {
          if (reply.accepted) {
            currentRevision = reply.revision
            if (job.type === 'close') {
              closed = true
              disabled = true
              lastObservedSource = undefined
            }
          } else {
            disableCurrentSession(reply.rejectionReason ?? 'session-disabled')
          }
        }
      }
    }).catch(() => {
      if (disposed) return
      const failure = localFailure(job, 'transport-error', job.queue.queueDepth)
      pushReport(failure)
      if (
        job.session === session &&
        job.generation === generation
      ) {
        disableCurrentSession('transport-error')
      }
    }).finally(() => {
      if (disposed) return
      inFlight = undefined
      schedulePump()
      resolveSettled()
    })
  }

  const schedulePump = (): void => {
    if (disposed || inFlight !== undefined || pumpScheduled) return
    pumpScheduled = true
    const run = (): void => {
      pumpScheduled = false
      pump()
    }
    if (queue[0]?.type === 'observe') {
      // Snapshot diffing is temporary Shadow instrumentation. Keep even its
      // bounded scan out of the microtask checkpoint that precedes paint.
      if (typeof globalThis.requestIdleCallback === 'function') {
        globalThis.requestIdleCallback(run, { timeout: 100 })
      } else {
        setTimeout(run, 0)
      }
    } else {
      queueMicrotask(run)
    }
  }

  const queuedTicket = (targetSequence: number): ShadowTicket => Object.freeze({
    sequence: targetSequence,
    state: 'queued'
  })

  const disabledTicket = (
    targetSequence: number,
    reason: ShadowRejectionReason = 'closed'
  ): ShadowTicket => Object.freeze({
    sequence: targetSequence,
    state: 'disabled',
    reason
  })

  return Object.freeze({
    mode: 'shadow',
    diagnosticOnly: true,
    open(input: ShadowOpenInput): ShadowTicket {
      if (disposed) throw new Error('Shadow document authority is disposed')
      if (typeof input.source !== 'string') {
        throw new TypeError('Shadow source must be a string')
      }

      sequence += 1
      generation += 1
      currentRevision = 0
      currentDocumentId = input.documentId
      lastObservedSource = input.source
      disabled = false
      disableReason = undefined
      closed = false

      // An explicit open is a recovery/session barrier. Work not yet sent for
      // the superseded session can be discarded; a late in-flight result is
      // still recorded under its old session but cannot advance this one.
      queue.splice(0, queue.length)
      const job = Object.freeze({
        type: 'open' as const,
        session,
        generation,
        sequence,
        source: input.source,
        ...(input.options === undefined
          ? {}
          : { options: Object.freeze({ ...input.options }) }),
        ...(input.documentId === undefined
          ? {}
          : { documentId: input.documentId }),
        queue: Object.freeze({
          queuedAt: Date.now(),
          queueDepth: inFlight === undefined ? 0 : 1
        })
      })
      queue.push(job)
      schedulePump()
      return queuedTicket(sequence)
    },
    observe(nextSource: string): ShadowTicket {
      if (disposed) throw new Error('Shadow document authority is disposed')
      if (typeof nextSource !== 'string') {
        throw new TypeError('Shadow source must be a string')
      }
      sequence += 1
      if (disabled || closed || lastObservedSource === undefined) {
        return disabledTicket(
          sequence,
          closed ? 'closed' : (disableReason ?? 'session-disabled')
        )
      }
      const depth = outstanding()
      const previousSource = lastObservedSource
      const job = Object.freeze({
        type: 'observe' as const,
        session,
        generation,
        sequence,
        previousSource,
        nextSource,
        ...(currentDocumentId === undefined
          ? {}
          : { documentId: currentDocumentId }),
        queue: Object.freeze({ queuedAt: Date.now(), queueDepth: depth })
      })

      // The snapshot adapter is a bounded Phase 1 diagnostic, not the Phase 1A
      // production edit gateway. Never add an unbounded whole-document scan or
      // retain an arbitrarily large burst on the renderer's input path.
      if (
        previousSource.length > maxDiffSourceUnits ||
        nextSource.length > maxDiffSourceUnits
      ) {
        pushReport(localFailure(job, 'snapshot-too-large', depth))
        disableCurrentSession('snapshot-too-large')
        resolveSettled()
        return disabledTicket(sequence, 'snapshot-too-large')
      }

      if (nextSource === previousSource) {
        return Object.freeze({ sequence, state: 'unchanged' })
      }

      lastObservedSource = nextSource

      // Shadow reports the newest settled snapshot, not every intermediate
      // keystroke. Coalescing keeps an intentionally deferred idle observer
      // from disabling itself merely because several editor mutations arrive
      // before the browser grants idle time.
      const queued = queue.at(-1)
      if (
        queued?.type === 'observe' &&
        queued.session === session &&
        queued.generation === generation
      ) {
        queue[queue.length - 1] = Object.freeze({
          ...job,
          previousSource: queued.previousSource,
          queue: queued.queue
        })
        return queuedTicket(sequence)
      }

      if (depth >= maxPending) {
        pushReport(localFailure(job, 'queue-full', depth))
        disableCurrentSession('queue-full')
        resolveSettled()
        return disabledTicket(sequence, 'queue-full')
      }

      queue.push(job)
      schedulePump()
      return queuedTicket(sequence)
    },
    close(): ShadowTicket {
      if (disposed) throw new Error('Shadow document authority is disposed')
      sequence += 1
      if (closed || generation === 0) return disabledTicket(sequence)

      queue.splice(0, queue.length)
      disabled = true
      disableReason = 'closed'
      const job = Object.freeze({
        type: 'close' as const,
        session,
        generation,
        sequence,
        ...(currentDocumentId === undefined
          ? {}
          : { documentId: currentDocumentId }),
        queue: Object.freeze({
          queuedAt: Date.now(),
          queueDepth: inFlight === undefined ? 0 : 1
        })
      })
      queue.push(job)
      schedulePump()
      return queuedTicket(sequence)
    },
    settled(): Promise<void> {
      if (inFlight === undefined && queue.length === 0) return Promise.resolve()
      return new Promise(resolve => settleWaiters.add(resolve))
    },
    reports(): readonly ShadowReport[] {
      return Object.freeze([...reportLog])
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      disabled = true
      disableReason = 'closed'
      closed = true
      lastObservedSource = undefined
      queue.splice(0, queue.length)
      inFlight = undefined
      options.port.dispose()
      resolveSettled()
    }
  })
}
