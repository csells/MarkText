import type {
  CriticMarkupNode,
  ResourceDiagnostic,
  SourceRange
} from '../../revision.js'
import type { Profile1DocumentProducts } from '../profile1Document.js'
import { sourceRange } from './sourceRanges.js'

export function shiftResourceDiagnostic(
  diagnostic: ResourceDiagnostic,
  sourceDelta: number
): ResourceDiagnostic {
  return Object.freeze({
    kind: diagnostic.kind,
    code: diagnostic.code,
    range: sourceRange(
      diagnostic.range.start + sourceDelta,
      diagnostic.range.end + sourceDelta
    ),
    metadata: diagnostic.metadata
  })
}

export function exactProjectedOffset(
  projection: ReturnType<Profile1DocumentProducts['editing']>,
  sourceOffset: number
): number | undefined {
  for (const segment of projection.mappedTape) {
    if (segment.kind !== 'canonical') continue
    const length = segment.projectedEnd - segment.projectedStart
    const sourceEnd = segment.sourceStart + length
    if (segment.sourceStart <= sourceOffset && sourceOffset <= sourceEnd) {
      return segment.projectedStart + sourceOffset - segment.sourceStart
    }
  }
  return undefined
}

export function publicMarkupEventRangeForSource(
  products: Profile1DocumentProducts,
  source: SourceRange,
  // An annotation window's own marks stand for its whole range; a window
  // without one admits only text events.
  root?: CriticMarkupNode
): Readonly<{ readonly start: number; readonly end: number }> | undefined {
  const safePoints = products.retainedIntrinsic?.safePoints ?? []
  let safePointIndex = 0
  let publicOrdinal = 0
  let first: number | undefined
  let end: number | undefined
  let regionEnded = false
  const visit = (eventRange: SourceRange): boolean => {
    const overlaps = eventRange.start < source.end &&
      source.start < eventRange.end
    if (
      overlaps &&
      (eventRange.start < source.start || eventRange.end > source.end)
    ) {
      return false
    }
    if (overlaps) {
      if (regionEnded) return false
      first ??= publicOrdinal
      end = publicOrdinal + 1
    } else if (first !== undefined && eventRange.start >= source.end) {
      regionEnded = true
    }
    publicOrdinal += 1
    return true
  }
  for (let ordinal = 0; ordinal < products.markup.eventCount; ordinal += 1) {
    const event = products.markup.eventAt(ordinal)
    if (event.kind !== 'text') {
      if (
        root === undefined ||
        event.mark.nodeId !== root.nodeId ||
        !visit(root.range)
      ) {
        return undefined
      }
      continue
    }
    const eventRange = event.sourceRange
    while (
      safePointIndex < safePoints.length &&
      (safePoints[safePointIndex] ?? eventRange.start) <= eventRange.start
    ) {
      safePointIndex += 1
    }
    let cursor: number = eventRange.start
    while (
      safePointIndex < safePoints.length &&
      (safePoints[safePointIndex] ?? eventRange.end) < eventRange.end
    ) {
      const boundary = safePoints[safePointIndex]
      if (boundary !== undefined && cursor < boundary) {
        if (!visit(sourceRange(cursor, boundary))) return undefined
        cursor = boundary
      }
      safePointIndex += 1
    }
    if (cursor < eventRange.end && !visit(sourceRange(cursor, eventRange.end))) {
      return undefined
    }
  }
  return first === undefined || end === undefined
    ? undefined
    : Object.freeze({ start: first, end })
}

export function sameAccountingShape(
  previous: Profile1DocumentProducts,
  next: Profile1DocumentProducts
): boolean {
  const previousEvents = previous.accountingTrace?.events
  const nextEvents = next.accountingTrace?.events
  return previousEvents !== undefined &&
    nextEvents !== undefined &&
    previousEvents.length === nextEvents.length &&
    previousEvents.every((event, ordinal) =>
      event.kind === nextEvents[ordinal]?.kind
    )
}
