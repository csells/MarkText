import type { DocumentSourceEdit } from '@marktext/document-core'

export interface OptimisticHistoryTransformInput {
  /** UTF-16 code-unit length before actor history and optimistic transactions. */
  readonly baseSourceLength: number
  /** One actor transaction expressed in the base source coordinate domain. */
  readonly appliedEdits: readonly DocumentSourceEdit[]
  /** Each transaction uses the optimistic coordinates produced by its predecessor. */
  readonly queuedTransactions: readonly (readonly DocumentSourceEdit[])[]
}

export interface OptimisticHistoryTransformConflict {
  readonly kind: 'conflict'
  readonly reason: 'pending-boundary-deleted'
  readonly transactionIndex: number
  readonly editIndex: number
  readonly boundary: 'start' | 'end'
  readonly position: number
}

export interface OptimisticHistoryTransformed {
  readonly kind: 'transformed'
  /** Transactions are sequential and relative to the preceding actor state. */
  readonly rebasedTransactions: readonly (readonly DocumentSourceEdit[])[]
  /** Base-coordinate edits from the final optimistic view to the actor result. */
  readonly reconciliationEdits: readonly DocumentSourceEdit[]
}

export type OptimisticHistoryTransformResult =
  | OptimisticHistoryTransformConflict
  | OptimisticHistoryTransformed

interface ProvenancePiece {
  readonly origin: number
  readonly start: number
  readonly end: number
  readonly buffer?: string
}

interface StableEdit extends DocumentSourceEdit {
  readonly ordinal: number
  readonly insertionOrigin: number
}

interface PieceCursor {
  pieceIndex: number
  pieceOffset: number
  position: number
}

interface CommonSpan {
  readonly origin: number
  readonly optimisticStart: number
  readonly authoritativeStart: number
  readonly length: number
}

interface SpanChainScore {
  readonly baseUnits: number
  readonly totalUnits: number
}

interface PositionedPiece {
  readonly start: number
  readonly end: number
  readonly position: number
}

type BoundaryAffinity = 'before' | 'after'

const BASE_ORIGIN = 0

const pieceLength = (piece: ProvenancePiece): number => piece.end - piece.start

const sequenceLength = (pieces: readonly ProvenancePiece[]): number =>
  pieces.reduce((sum, piece) => sum + pieceLength(piece), 0)

const appendPiece = (
  output: ProvenancePiece[],
  piece: ProvenancePiece
): void => {
  if (piece.start === piece.end) return
  const previous = output.at(-1)
  if (
    previous !== undefined &&
    previous.origin === piece.origin &&
    previous.buffer === piece.buffer &&
    previous.end === piece.start
  ) {
    output[output.length - 1] = Object.freeze({
      origin: previous.origin,
      start: previous.start,
      end: piece.end,
      ...(piece.buffer === undefined ? {} : { buffer: piece.buffer })
    })
    return
  }
  output.push(piece)
}

const stableEdits = (
  edits: readonly DocumentSourceEdit[],
  sourceLength: number,
  nextOrigin: () => number,
  label: string
): readonly StableEdit[] => {
  if (!Array.isArray(edits)) throw new TypeError(`${label} must be an array`)
  const stable: StableEdit[] = []
  let previousEnd = 0
  for (let index = 0; index < edits.length; index += 1) {
    const edit = edits[index]
    if (
      edit === undefined ||
      !Number.isSafeInteger(edit.start) ||
      !Number.isSafeInteger(edit.end) ||
      edit.start < previousEnd ||
      edit.end < edit.start ||
      edit.end > sourceLength ||
      typeof edit.insert !== 'string'
    ) {
      throw new RangeError(`${label} edit ${String(index)} is invalid`)
    }
    stable.push(Object.freeze({
      start: edit.start,
      end: edit.end,
      insert: edit.insert,
      ordinal: index,
      insertionOrigin: nextOrigin()
    }))
    previousEnd = edit.end
  }
  return Object.freeze(stable)
}

const moveCursor = (
  pieces: readonly ProvenancePiece[],
  cursor: PieceCursor,
  target: number,
  output?: ProvenancePiece[]
): void => {
  while (cursor.position < target) {
    const piece = pieces[cursor.pieceIndex]
    if (piece === undefined) throw new RangeError('Edit exceeds the source')
    const available = pieceLength(piece) - cursor.pieceOffset
    const consumed = Math.min(available, target - cursor.position)
    if (output !== undefined) {
      appendPiece(output, Object.freeze({
        origin: piece.origin,
        start: piece.start + cursor.pieceOffset,
        end: piece.start + cursor.pieceOffset + consumed,
        ...(piece.buffer === undefined ? {} : { buffer: piece.buffer })
      }))
    }
    cursor.position += consumed
    cursor.pieceOffset += consumed
    if (cursor.pieceOffset === pieceLength(piece)) {
      cursor.pieceIndex += 1
      cursor.pieceOffset = 0
    }
  }
}

const applyEdits = (
  pieces: readonly ProvenancePiece[],
  sourceLength: number,
  edits: readonly StableEdit[]
): readonly ProvenancePiece[] => {
  const output: ProvenancePiece[] = []
  const cursor: PieceCursor = { pieceIndex: 0, pieceOffset: 0, position: 0 }
  for (const edit of edits) {
    moveCursor(pieces, cursor, edit.start, output)
    if (edit.insert.length > 0) {
      appendPiece(output, Object.freeze({
        origin: edit.insertionOrigin,
        start: 0,
        end: edit.insert.length,
        buffer: edit.insert
      }))
    }
    moveCursor(pieces, cursor, edit.end)
  }
  moveCursor(pieces, cursor, sourceLength, output)
  return Object.freeze(output)
}

const authoritativePositionOf = (
  pieces: readonly ProvenancePiece[],
  origin: number,
  provenanceOffset: number
): number | undefined => {
  let position = 0
  for (const piece of pieces) {
    if (
      piece.origin === origin &&
      piece.start <= provenanceOffset &&
      provenanceOffset < piece.end
    ) {
      return position + provenanceOffset - piece.start
    }
    position += pieceLength(piece)
  }
  return undefined
}

const boundaryContext = (
  pieces: readonly ProvenancePiece[],
  position: number
): Readonly<{
  right?: Readonly<{ readonly origin: number; readonly offset: number }>
  left?: Readonly<{ readonly origin: number; readonly offset: number }>
}> => {
  let cursor = 0
  let left: { origin: number; offset: number } | undefined
  for (const piece of pieces) {
    const end = cursor + pieceLength(piece)
    if (position < end) {
      return Object.freeze({
        right: Object.freeze({
          origin: piece.origin,
          offset: piece.start + position - cursor
        }),
        ...(position === cursor
          ? (left === undefined ? {} : { left: Object.freeze(left) })
          : {
            left: Object.freeze({
              origin: piece.origin,
              offset: piece.start + position - cursor - 1
            })
          })
      })
    }
    left = { origin: piece.origin, offset: piece.end - 1 }
    cursor = end
  }
  return Object.freeze(left === undefined ? {} : { left: Object.freeze(left) })
}

const positionAfterEditSet = (
  position: number,
  edits: readonly DocumentSourceEdit[],
  affinity: BoundaryAffinity
): number | undefined => {
  let delta = 0
  for (const edit of edits) {
    if (position < edit.start) break
    if (position === edit.start) {
      return edit.start + delta + (affinity === 'after' ? edit.insert.length : 0)
    }
    if (position < edit.end) return undefined
    delta += edit.insert.length - (edit.end - edit.start)
  }
  return position + delta
}

const positionAfterTransactions = (
  position: number,
  history: readonly StableEdit[],
  priorTransactions: readonly (readonly DocumentSourceEdit[])[],
  affinity: BoundaryAffinity
): number | undefined => {
  let mapped = positionAfterEditSet(position, history, affinity)
  for (const transaction of priorTransactions) {
    if (mapped === undefined) return undefined
    mapped = positionAfterEditSet(mapped, transaction, affinity)
  }
  return mapped
}

const mapBoundary = (
  optimistic: readonly ProvenancePiece[],
  authoritative: readonly ProvenancePiece[],
  position: number,
  history: readonly StableEdit[],
  priorTransactions: readonly (readonly DocumentSourceEdit[])[],
  affinity: BoundaryAffinity
): number | undefined => {
  const context = boundaryContext(optimistic, position)
  const mappedRight = context.right === undefined
    ? undefined
    : authoritativePositionOf(
      authoritative,
      context.right.origin,
      context.right.offset
    )
  const mappedLeft = context.left === undefined
    ? undefined
    : authoritativePositionOf(
      authoritative,
      context.left.origin,
      context.left.offset
    )
  if (affinity === 'before' && mappedLeft !== undefined) return mappedLeft + 1
  if (affinity === 'after' && mappedRight !== undefined) return mappedRight
  const baseBoundary = context.right?.origin === BASE_ORIGIN
    ? context.right.offset
    : context.right === undefined && context.left?.origin === BASE_ORIGIN
      ? context.left.offset + 1
      : undefined
  if (baseBoundary !== undefined) {
    return positionAfterTransactions(
      baseBoundary,
      history,
      priorTransactions,
      affinity
    )
  }
  if (affinity === 'after' && mappedLeft !== undefined) return mappedLeft + 1
  if (affinity === 'before' && mappedRight !== undefined) return mappedRight
  if (context.right === undefined) {
    return sequenceLength(authoritative)
  }
  return undefined
}

const rebasedEdits = (
  edits: readonly StableEdit[],
  optimistic: readonly ProvenancePiece[],
  authoritative: readonly ProvenancePiece[],
  history: readonly StableEdit[],
  priorTransactions: readonly (readonly DocumentSourceEdit[])[],
  transactionIndex: number
): readonly StableEdit[] | OptimisticHistoryTransformConflict => {
  const rebased: StableEdit[] = []
  let previousEnd = 0
  for (const edit of edits) {
    const start = mapBoundary(
      optimistic,
      authoritative,
      edit.start,
      history,
      priorTransactions,
      'after'
    )
    if (start === undefined) {
      return Object.freeze({
        kind: 'conflict',
        reason: 'pending-boundary-deleted',
        transactionIndex,
        editIndex: edit.ordinal,
        boundary: 'start',
        position: edit.start
      })
    }
    const end = mapBoundary(
      optimistic,
      authoritative,
      edit.end,
      history,
      priorTransactions,
      edit.start === edit.end ? 'after' : 'before'
    )
    if (end === undefined) {
      return Object.freeze({
        kind: 'conflict',
        reason: 'pending-boundary-deleted',
        transactionIndex,
        editIndex: edit.ordinal,
        boundary: 'end',
        position: edit.end
      })
    }
    if (start < previousEnd || end < start) {
      return Object.freeze({
        kind: 'conflict',
        reason: 'pending-boundary-deleted',
        transactionIndex,
        editIndex: edit.ordinal,
        boundary: 'start',
        position: edit.start
      })
    }
    rebased.push(Object.freeze({ ...edit, start, end }))
    previousEnd = end
  }
  return Object.freeze(rebased)
}

const commonSpans = (
  optimistic: readonly ProvenancePiece[],
  authoritative: readonly ProvenancePiece[]
): readonly CommonSpan[] => {
  const indexByOrigin = (pieces: readonly ProvenancePiece[]) => {
    const index = new Map<number, PositionedPiece[]>()
    let position = 0
    for (const piece of pieces) {
      const intervals = index.get(piece.origin) ?? []
      intervals.push(Object.freeze({
        start: piece.start,
        end: piece.end,
        position
      }))
      index.set(piece.origin, intervals)
      position += pieceLength(piece)
    }
    return index
  }

  const optimisticByOrigin = indexByOrigin(optimistic)
  const authoritativeByOrigin = indexByOrigin(authoritative)
  const spans: CommonSpan[] = []
  for (const [origin, optimisticIntervals] of optimisticByOrigin) {
    const authoritativeIntervals = authoritativeByOrigin.get(origin)
    if (authoritativeIntervals === undefined) continue
    let optimisticIndex = 0
    let authoritativeIndex = 0
    while (
      optimisticIndex < optimisticIntervals.length &&
      authoritativeIndex < authoritativeIntervals.length
    ) {
      const optimisticInterval = optimisticIntervals[optimisticIndex]!
      const authoritativeInterval = authoritativeIntervals[authoritativeIndex]!
      const start = Math.max(optimisticInterval.start, authoritativeInterval.start)
      const end = Math.min(optimisticInterval.end, authoritativeInterval.end)
      if (start < end) {
        spans.push(Object.freeze({
          origin,
          optimisticStart: optimisticInterval.position +
            start - optimisticInterval.start,
          authoritativeStart: authoritativeInterval.position +
            start - authoritativeInterval.start,
          length: end - start
        }))
      }
      if (optimisticInterval.end <= authoritativeInterval.end) optimisticIndex += 1
      if (authoritativeInterval.end <= optimisticInterval.end) authoritativeIndex += 1
    }
  }
  spans.sort((left, right) => left.optimisticStart - right.optimisticStart)

  // Later optimistic input can cross earlier pending insertions after it is
  // rebased through actor history. A reconciliation script may retain only a
  // sequence whose coordinates increase in both documents. Prefer retaining
  // all shared base units because the renderer intentionally has no base
  // source from which to synthesize them, then minimize inserted-text repair.
  const scores: SpanChainScore[] = []
  const predecessors: Array<number | undefined> = []
  let bestIndex: number | undefined
  const isBetter = (
    candidate: SpanChainScore,
    incumbent: SpanChainScore | undefined
  ): boolean => incumbent === undefined ||
    candidate.baseUnits > incumbent.baseUnits ||
    candidate.baseUnits === incumbent.baseUnits &&
    candidate.totalUnits > incumbent.totalUnits

  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index]!
    let score: SpanChainScore = {
      baseUnits: span.origin === BASE_ORIGIN ? span.length : 0,
      totalUnits: span.length
    }
    let predecessor: number | undefined
    for (let priorIndex = 0; priorIndex < index; priorIndex += 1) {
      const prior = spans[priorIndex]!
      if (
        prior.optimisticStart + prior.length > span.optimisticStart ||
        prior.authoritativeStart + prior.length > span.authoritativeStart
      ) continue
      const priorScore = scores[priorIndex]!
      const candidate: SpanChainScore = {
        baseUnits: priorScore.baseUnits +
          (span.origin === BASE_ORIGIN ? span.length : 0),
        totalUnits: priorScore.totalUnits + span.length
      }
      if (isBetter(candidate, score)) {
        score = candidate
        predecessor = priorIndex
      }
    }
    scores.push(score)
    predecessors.push(predecessor)
    if (isBetter(score, bestIndex === undefined ? undefined : scores[bestIndex])) {
      bestIndex = index
    }
  }

  const monotonic: CommonSpan[] = []
  for (let index = bestIndex; index !== undefined; index = predecessors[index]) {
    monotonic.push(spans[index]!)
  }
  monotonic.reverse()
  return Object.freeze(monotonic)
}

const insertedText = (
  pieces: readonly ProvenancePiece[],
  start: number,
  end: number,
  cursor: PieceCursor
): string => {
  const output: string[] = []
  moveCursor(pieces, cursor, start)
  while (cursor.position < end) {
    const piece = pieces[cursor.pieceIndex]
    if (piece === undefined) throw new RangeError('Text range exceeds the source')
    const consumed = Math.min(
      pieceLength(piece) - cursor.pieceOffset,
      end - cursor.position
    )
    if (consumed > 0) {
      if (piece.buffer === undefined) {
        throw new Error('History transform cannot synthesize unknown base source')
      }
      const bufferStart = piece.start + cursor.pieceOffset
      output.push(piece.buffer.slice(
        bufferStart,
        bufferStart + consumed
      ))
    }
    cursor.position += consumed
    cursor.pieceOffset += consumed
    if (cursor.pieceOffset === pieceLength(piece)) {
      cursor.pieceIndex += 1
      cursor.pieceOffset = 0
    }
  }
  return output.join('')
}

const reconciliationEdits = (
  optimistic: readonly ProvenancePiece[],
  authoritative: readonly ProvenancePiece[]
): readonly DocumentSourceEdit[] => {
  const edits: DocumentSourceEdit[] = []
  let optimisticPosition = 0
  let authoritativePosition = 0
  const authoritativeCursor: PieceCursor = {
    pieceIndex: 0,
    pieceOffset: 0,
    position: 0
  }
  for (const span of commonSpans(optimistic, authoritative)) {
    if (
      span.optimisticStart !== optimisticPosition ||
      span.authoritativeStart !== authoritativePosition
    ) {
      edits.push(Object.freeze({
        start: optimisticPosition,
        end: span.optimisticStart,
        insert: insertedText(
          authoritative,
          authoritativePosition,
          span.authoritativeStart,
          authoritativeCursor
        )
      }))
    }
    moveCursor(
      authoritative,
      authoritativeCursor,
      span.authoritativeStart + span.length
    )
    optimisticPosition = span.optimisticStart + span.length
    authoritativePosition = span.authoritativeStart + span.length
  }
  const optimisticLength = sequenceLength(optimistic)
  const authoritativeLength = sequenceLength(authoritative)
  if (
    optimisticPosition !== optimisticLength ||
    authoritativePosition !== authoritativeLength
  ) {
    edits.push(Object.freeze({
      start: optimisticPosition,
      end: optimisticLength,
      insert: insertedText(
        authoritative,
        authoritativePosition,
        authoritativeLength,
        authoritativeCursor
      )
    }))
  }
  return Object.freeze(edits)
}

const publicEdits = (
  edits: readonly StableEdit[]
): readonly DocumentSourceEdit[] => Object.freeze(edits.map(edit =>
  Object.freeze({ start: edit.start, end: edit.end, insert: edit.insert })
))

/**
 * Rebases optimistic transactions after one earlier actor transaction without
 * reading the base source. A boundary whose base provenance was deleted and
 * has no surviving optimistic anchor returns a portable conflict.
 */
export function transformOptimisticHistory(
  input: OptimisticHistoryTransformInput
): OptimisticHistoryTransformResult {
  if (
    !Number.isSafeInteger(input.baseSourceLength) ||
    input.baseSourceLength < 0
  ) throw new RangeError('Base source length must be a non-negative integer')
  if (!Array.isArray(input.queuedTransactions)) {
    throw new TypeError('Queued transactions must be an array')
  }

  let origin = 1
  const nextOrigin = (): number => origin++
  const base = Object.freeze<readonly ProvenancePiece[]>(input.baseSourceLength === 0
    ? []
    : [Object.freeze({
      origin: BASE_ORIGIN,
      start: 0,
      end: input.baseSourceLength
    })]
  )
  const history = stableEdits(
    input.appliedEdits,
    input.baseSourceLength,
    nextOrigin,
    'Actor history'
  )
  let optimistic = base
  let authoritative = applyEdits(base, input.baseSourceLength, history)
  const transactions: Array<readonly DocumentSourceEdit[]> = []

  for (
    let transactionIndex = 0;
    transactionIndex < input.queuedTransactions.length;
    transactionIndex += 1
  ) {
    const transaction = stableEdits(
      input.queuedTransactions[transactionIndex] ?? [],
      sequenceLength(optimistic),
      nextOrigin,
      `Queued transaction ${String(transactionIndex)}`
    )
    const rebased = rebasedEdits(
      transaction,
      optimistic,
      authoritative,
      history,
      transactions,
      transactionIndex
    )
    if ('kind' in rebased) return rebased
    optimistic = applyEdits(
      optimistic,
      sequenceLength(optimistic),
      transaction
    )
    authoritative = applyEdits(
      authoritative,
      sequenceLength(authoritative),
      rebased
    )
    transactions.push(publicEdits(rebased))
  }

  return Object.freeze({
    kind: 'transformed',
    rebasedTransactions: Object.freeze(transactions),
    reconciliationEdits: reconciliationEdits(optimistic, authoritative)
  })
}
