/**
 * Persistent coordinate index for the fixed set of safe regions in a plain,
 * CM-free paragraph document. Full parsing owns the immutable base safe-point
 * array. Regional edits path-copy only a sparse prefix-sum overlay whose point
 * deltas describe changed region lengths; callers never flatten or rebase the
 * untouched suffix.
 */
export interface PlainParagraphIndexRecorder {
  readonly recordInitialBuildUnit: () => void
  readonly recordLookupComparison: () => void
  readonly recordOverlayNodeVisit: () => void
  readonly recordOverlayNodeAllocation: () => void
  readonly recordOverlayNodeReuse: () => void
  readonly recordChangedLeafUnit: () => void
  readonly recordLocalCopyUnit: () => void
  readonly recordOverlayDepth: (depth: number) => void
}

export interface PlainParagraphSourceEdit {
  readonly start: number
  readonly end: number
  readonly insert: string
}

export interface PlainParagraphRegionBracket {
  readonly start: number
  readonly endPrevious: number
  readonly endNext: number
  readonly delta: number
  readonly startSafePointRank: number
  readonly endSafePointRank: number
  readonly previousEventStart: number
  readonly previousEventEnd: number
}

interface DeltaNode {
  readonly sum: number
  readonly left?: DeltaNode
  readonly right?: DeltaNode
}

export interface PlainParagraphRetainedIndex {
  readonly sourceLength: number
  readonly safePointCount: number
  /**
   * End of the immutable prefix whose document-wide coordinates are consumed
   * by facts outside a candidate region. A regional edit must start strictly
   * after this position so retained suffix shifting cannot stale those facts.
   */
  readonly dependencyPrefixEnd: number
  readonly coordinateAt: (rank: number) => number
  readonly bracketForEdits: (
    edits: readonly PlainParagraphSourceEdit[],
    nextLength: number
  ) => PlainParagraphRegionBracket | undefined
  readonly withRegionLengthDelta: (
    endSafePointRank: number,
    delta: number,
    nextLength: number
  ) => PlainParagraphRetainedIndex
}

function deltaNode(
  sum: number,
  left: DeltaNode | undefined,
  right: DeltaNode | undefined,
  recorder: PlainParagraphIndexRecorder
): DeltaNode {
  recorder.recordOverlayNodeAllocation()
  recorder.recordLocalCopyUnit()
  return Object.freeze({
    sum,
    ...(left === undefined ? {} : { left }),
    ...(right === undefined ? {} : { right })
  })
}

function pointAdd(
  node: DeltaNode | undefined,
  low: number,
  high: number,
  rank: number,
  delta: number,
  recorder: PlainParagraphIndexRecorder,
  depth: number = 1
): DeltaNode {
  if (node !== undefined) recorder.recordOverlayNodeVisit()
  recorder.recordOverlayDepth(depth)
  if (high - low === 1) {
    recorder.recordChangedLeafUnit()
    return deltaNode((node?.sum ?? 0) + delta, undefined, undefined, recorder)
  }
  const middle = low + ((high - low) >> 1)
  let left = node?.left
  let right = node?.right
  if (rank < middle) {
    left = pointAdd(left, low, middle, rank, delta, recorder, depth + 1)
    if (right !== undefined) recorder.recordOverlayNodeReuse()
  } else {
    right = pointAdd(right, middle, high, rank, delta, recorder, depth + 1)
    if (left !== undefined) recorder.recordOverlayNodeReuse()
  }
  return deltaNode(
    (left?.sum ?? 0) + (right?.sum ?? 0),
    left,
    right,
    recorder
  )
}

function prefixDelta(
  node: DeltaNode | undefined,
  low: number,
  high: number,
  throughRank: number,
  recorder: PlainParagraphIndexRecorder,
  depth: number = 1
): number {
  if (node === undefined || throughRank < low) return 0
  recorder.recordOverlayNodeVisit()
  recorder.recordOverlayDepth(depth)
  if (high - 1 <= throughRank) return node.sum
  const middle = low + ((high - low) >> 1)
  return prefixDelta(
    node.left,
    low,
    middle,
    throughRank,
    recorder,
    depth + 1
  ) + prefixDelta(
    node.right,
    middle,
    high,
    throughRank,
    recorder,
    depth + 1
  )
}

function createIndex(
  baseSafePoints: readonly number[],
  sourceLength: number,
  overlay: DeltaNode | undefined,
  dependencyPrefixEnd: number,
  recorder: PlainParagraphIndexRecorder
): PlainParagraphRetainedIndex {
  const coordinateAt = Object.freeze((rank: number): number => {
    if (!Number.isInteger(rank) || rank < 0 || rank >= baseSafePoints.length) {
      throw new RangeError('Plain paragraph safe-point rank is outside its index')
    }
    const base = baseSafePoints[rank]
    if (base === undefined) {
      throw new Error('Plain paragraph safe-point index is sparse')
    }
    return base + prefixDelta(
      overlay,
      0,
      baseSafePoints.length,
      rank,
      recorder
    )
  })
  const bound = (value: number, inclusive: boolean): number => {
    let low = 0
    let high = baseSafePoints.length
    while (low < high) {
      recorder.recordLookupComparison()
      const middle = low + ((high - low) >> 1)
      const coordinate = coordinateAt(middle)
      if (coordinate < value || (inclusive && coordinate === value)) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    return low
  }
  const bracketForEdits = Object.freeze((
    edits: readonly PlainParagraphSourceEdit[],
    nextLength: number
  ): PlainParagraphRegionBracket | undefined => {
    if (edits.length === 0) return undefined
    let editStart = Number.POSITIVE_INFINITY
    let editEnd = Number.NEGATIVE_INFINITY
    for (const edit of edits) {
      if (
        !Number.isInteger(edit.start) ||
        !Number.isInteger(edit.end) ||
        edit.start < 0 ||
        edit.end < edit.start ||
        edit.end > sourceLength
      ) {
        return undefined
      }
      editStart = Math.min(editStart, edit.start)
      editEnd = Math.max(editEnd, edit.end)
    }
    const startInsertionRank = bound(editStart, true)
    const startSafePointRank = startInsertionRank - 1
    const start = startSafePointRank < 0
      ? 0
      : coordinateAt(startSafePointRank)
    const endSafePointRank = bound(editEnd, true)
    const endPrevious = endSafePointRank < baseSafePoints.length
      ? coordinateAt(endSafePointRank)
      : sourceLength
    if (start >= endPrevious) return undefined
    const delta = nextLength - sourceLength
    return Object.freeze({
      start,
      endPrevious,
      endNext: endPrevious + delta,
      delta,
      startSafePointRank,
      endSafePointRank,
      previousEventStart: startSafePointRank + 1,
      previousEventEnd: endSafePointRank + 1
    })
  })
  const withRegionLengthDelta = Object.freeze((
    endSafePointRank: number,
    delta: number,
    nextLength: number
  ): PlainParagraphRetainedIndex => {
    if (
      !Number.isInteger(endSafePointRank) ||
      endSafePointRank < 0 ||
      endSafePointRank > baseSafePoints.length ||
      nextLength !== sourceLength + delta
    ) {
      throw new RangeError('Plain paragraph region delta is outside its index')
    }
    // EOF has no later safe-point coordinate to shift; its length lives on the index.
    const nextOverlay = delta === 0 || endSafePointRank === baseSafePoints.length
      ? overlay
      : pointAdd(
        overlay,
        0,
        baseSafePoints.length,
        endSafePointRank,
        delta,
        recorder
      )
    return createIndex(
      baseSafePoints,
      nextLength,
      nextOverlay,
      dependencyPrefixEnd,
      recorder
    )
  })
  return Object.freeze({
    sourceLength,
    safePointCount: baseSafePoints.length,
    dependencyPrefixEnd,
    coordinateAt,
    bracketForEdits,
    withRegionLengthDelta
  })
}

export function createPlainParagraphRetainedIndex(
  safePoints: readonly number[],
  sourceLength: number,
  dependencyPrefixEnd: number,
  recorder: PlainParagraphIndexRecorder
): PlainParagraphRetainedIndex {
  if (
    !Number.isInteger(dependencyPrefixEnd) ||
    dependencyPrefixEnd < 0 ||
    dependencyPrefixEnd > sourceLength
  ) {
    throw new Error('Plain paragraph dependency prefix is outside its source')
  }
  let previous = 0
  for (const point of safePoints) {
    recorder.recordInitialBuildUnit()
    if (
      !Number.isInteger(point) ||
      point <= previous ||
      point >= sourceLength
    ) {
      throw new Error('Plain paragraph safe points are not strictly ordered')
    }
    previous = point
  }
  return createIndex(
    safePoints,
    sourceLength,
    undefined,
    dependencyPrefixEnd,
    recorder
  )
}
