import type { SourceRange } from '../../revision.js'

export type Profile1SyntaxAccountingEventKind =
  | 'TapeRun'
  | 'MarkdownNode'
  | 'CriticNode'
  | 'MarkerNode'
  | 'ArmNode'
  | 'ProjectionSegment'

export interface Profile1SyntaxAccountingEvent {
  readonly kind: Profile1SyntaxAccountingEventKind
  readonly range: SourceRange
  readonly key: string
}

export interface Profile1SyntaxAccountingTrace {
  readonly events: readonly Profile1SyntaxAccountingEvent[]
}

interface AccountingBucket {
  count: number
  readonly ranges: number[] | undefined
  readonly events: Profile1SyntaxAccountingEvent[] | undefined
}

const EVENT_ORDER: readonly Profile1SyntaxAccountingEventKind[] =
  Object.freeze([
    'TapeRun',
    'MarkdownNode',
    'CriticNode',
    'MarkerNode',
    'ArmNode',
    'ProjectionSegment'
  ])

export interface Profile1SyntaxAccountingRecorder {
  readonly emit: (
    kind: Profile1SyntaxAccountingEventKind,
    range: SourceRange,
    key: string
  ) => void
  readonly eventCount: () => number
  /** Compact EVENT_ORDER bucket counts; no per-event objects are retained. */
  readonly counts: () => readonly number[]
  readonly firstEventBeyond: (
    limit: number
  ) => Readonly<{ readonly range: SourceRange; readonly observed: number }> | undefined
  readonly trace: () => Profile1SyntaxAccountingTrace
}

export class Profile1LogicalNodeLimitError extends Error {
  readonly range: SourceRange
  readonly limit: number
  readonly observed: number

  constructor(range: SourceRange, limit: number) {
    super('Profile 1 logical-node limit exceeded')
    this.name = 'Profile1LogicalNodeLimitError'
    this.range = range
    this.limit = limit
    this.observed = limit + 1
  }
}

/**
 * Production accounting is written at the same construction sites that emit
 * syntax. Desktop parses retain compact start/end pairs so the exact first
 * over-budget event can be reported in manifest order. Tests can additionally
 * retain keys to compare the complete ordered trace; no second tree walk or
 * manifest arithmetic participates in admission.
 */
export function createProfile1SyntaxAccountingRecorder(
  retainRanges: boolean,
  retainTrace: boolean,
  maximumEvents: number = Number.POSITIVE_INFINITY
): Profile1SyntaxAccountingRecorder {
  if (
    maximumEvents !== Number.POSITIVE_INFINITY &&
    (!Number.isSafeInteger(maximumEvents) || maximumEvents < 0)
  ) {
    throw new RangeError(
      'Syntax-accounting maximum must be a nonnegative safe integer or infinity'
    )
  }
  const buckets = new Map<
    Profile1SyntaxAccountingEventKind,
    AccountingBucket
  >(EVENT_ORDER.map((kind) => [
    kind,
    {
      count: 0,
      ranges: retainRanges ? [] : undefined,
      events: retainTrace ? [] : undefined
    }
  ]))
  let totalEvents = 0

  const emit = (
    kind: Profile1SyntaxAccountingEventKind,
    range: SourceRange,
    key: string
  ): void => {
    const bucket = buckets.get(kind)
    if (bucket === undefined) {
      throw new Error(`Unknown Profile 1 accounting event: ${String(kind)}`)
    }
    bucket.count += 1
    totalEvents += 1
    if (totalEvents > maximumEvents) {
      throw new Profile1LogicalNodeLimitError(range, maximumEvents)
    }
    bucket.ranges?.push(range.start, range.end)
    bucket.events?.push(Object.freeze({ kind, range, key }))
  }

  const eventCount = (): number => totalEvents

  const counts = (): readonly number[] => Object.freeze(
    EVENT_ORDER.map(kind => buckets.get(kind)?.count ?? 0)
  )

  const firstEventBeyond = (
    limit: number
  ): Readonly<{ readonly range: SourceRange; readonly observed: number }> | undefined => {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new RangeError('Syntax-accounting limit must be a nonnegative safe integer')
    }
    let preceding = 0
    for (const kind of EVENT_ORDER) {
      const bucket = buckets.get(kind)
      if (bucket === undefined) {
        continue
      }
      if (preceding + bucket.count <= limit) {
        preceding += bucket.count
        continue
      }
      const ordinal = limit - preceding
      const rangeStart = bucket.ranges?.[ordinal * 2]
      const rangeEnd = bucket.ranges?.[ordinal * 2 + 1]
      if (rangeStart === undefined || rangeEnd === undefined) {
        throw new Error(
          'Exact syntax-accounting failure requested without retained ranges'
        )
      }
      return Object.freeze({
        range: Object.freeze({
          start: rangeStart as SourceRange['start'],
          end: rangeEnd as SourceRange['end']
        }),
        observed: limit + 1
      })
    }
    return undefined
  }

  const trace = (): Profile1SyntaxAccountingTrace => {
    const events: Profile1SyntaxAccountingEvent[] = []
    for (const kind of EVENT_ORDER) {
      const bucket = buckets.get(kind)
      if (bucket?.events === undefined) {
        throw new Error('Syntax-accounting trace capture was not enabled')
      }
      for (const event of bucket.events) events.push(event)
    }
    return Object.freeze({ events: Object.freeze(events) })
  }

  return Object.freeze({
    emit: Object.freeze(emit),
    eventCount: Object.freeze(eventCount),
    counts: Object.freeze(counts),
    firstEventBeyond: Object.freeze(firstEventBeyond),
    trace: Object.freeze(trace)
  })
}
