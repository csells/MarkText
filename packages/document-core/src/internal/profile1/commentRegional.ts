import type {
  CriticMarkupNode,
  ExecutionBudgetId,
  MarkdownOptionsV1,
  ResourceDiagnostic,
  SourceRange
} from '../../revision.js'
import {
  createProfile1DocumentReuseCache,
  parseProfile1Document,
  type Profile1DocumentProducts,
  type RetainedPassSourceEdit
} from '../profile1Document.js'
import type { CanonicalSourceView } from '../persistentCanonicalSource.js'
import type { Profile1PhysicalTraversalRecorderV1 } from './physicalTraversalAccounting.js'

export interface CommentRegionalIndex {
  readonly source: SourceRange
  readonly syntax: SourceRange
  readonly events: Readonly<{ readonly start: number; readonly end: number }>
  readonly annotation: SourceRange
  readonly payload: SourceRange
  readonly projection: SourceRange
  readonly open: SourceRange
  readonly close: SourceRange
}

export interface CommentRegionalAdmission {
  readonly kind: 'admitted'
  readonly previousProducts: Profile1DocumentProducts
  readonly nextProducts: Profile1DocumentProducts
  readonly previousDisplay: ReturnType<Profile1DocumentProducts['commentDisplay']>
  readonly nextDisplay: ReturnType<Profile1DocumentProducts['commentDisplay']>
  readonly nextIndex: CommentRegionalIndex
  readonly previousWindow: string
  readonly nextWindow: string
}

export interface CommentRegionalResourceFailure {
  readonly kind: 'resource-failure'
  readonly fatalDiagnostic: ResourceDiagnostic
}

export type CommentRegionalAdmissionResult =
  | CommentRegionalAdmission
  | CommentRegionalResourceFailure

function range(start: number, end: number): SourceRange {
  return Object.freeze({
    start: start as SourceRange['start'],
    end: end as SourceRange['end']
  })
}

function sameRange(
  left: Readonly<{ readonly start: number; readonly end: number }>,
  right: Readonly<{ readonly start: number; readonly end: number }>
): boolean {
  return left.start === right.start && left.end === right.end
}

function shiftResourceDiagnostic(
  diagnostic: ResourceDiagnostic,
  sourceDelta: number
): ResourceDiagnostic {
  return Object.freeze({
    kind: diagnostic.kind,
    code: diagnostic.code,
    range: range(
      diagnostic.range.start + sourceDelta,
      diagnostic.range.end + sourceDelta
    ),
    metadata: diagnostic.metadata
  })
}

function exactProjectedOffset(
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

function publicMarkupEventRangeForSource(
  products: Profile1DocumentProducts,
  source: SourceRange
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
    if (event.kind !== 'text') return undefined
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
        if (!visit(range(cursor, boundary))) return undefined
        cursor = boundary
      }
      safePointIndex += 1
    }
    if (cursor < eventRange.end && !visit(range(cursor, eventRange.end))) {
      return undefined
    }
  }
  return first === undefined || end === undefined
    ? undefined
    : Object.freeze({ start: first, end })
}

function commentRootOf(products: Profile1DocumentProducts) {
  const retained = products.retainedIntrinsic
  if (
    retained === undefined ||
    retained.roots.length !== 1 ||
    !retained.hasCriticMarkupCandidate ||
    retained.diagnostics.length !== 0
  ) {
    return undefined
  }
  const root = retained.roots[0]
  if (
    root?.kind !== 'comment' ||
    root.arms.length !== 1 ||
    root.arms[0]?.name !== 'comment'
  ) {
    return undefined
  }
  const open = retained.markerDecisions.find(decision =>
    decision.kind === 'comment' &&
    decision.role === 'open' &&
    decision.parentOpenRunId === null &&
    sameRange(decision.range, root.markers.open)
  )
  const close = retained.markerDecisions.find(decision =>
    decision.kind === 'comment' &&
    decision.role === 'close' &&
    decision.action === 'matched' &&
    decision.openerRunId === open?.runId &&
    sameRange(decision.range, root.markers.close)
  )
  return root?.kind === 'comment' &&
    root.arms.length === 1 &&
    root.arms[0].name === 'comment' &&
    open?.kind === 'comment' &&
    open.role === 'open' &&
    open.parentOpenRunId === null &&
    sameRange(open.range, root.markers.open) &&
    close?.kind === 'comment' &&
    close.role === 'close' &&
    close.action === 'matched' &&
    close.openerRunId === open.runId &&
    sameRange(close.range, root.markers.close)
    ? root
    : undefined
}

export function createCommentRegionalIndex(
  products: Profile1DocumentProducts
): CommentRegionalIndex | undefined {
  const retained = products.retainedIntrinsic
  const root = commentRootOf(products)
  if (retained === undefined || root === undefined) return undefined
  let sourceStart = 0
  let sourceEnd = retained.sourceLength
  for (const safePoint of retained.safePoints) {
    if (safePoint <= root.range.start) sourceStart = safePoint
    if (safePoint > root.range.end) {
      sourceEnd = safePoint
      break
    }
  }
  if (sourceStart === 0 || sourceEnd >= retained.sourceLength) return undefined
  const editing = products.editing()
  const syntaxStart = exactProjectedOffset(editing, sourceStart)
  const syntaxEnd = exactProjectedOffset(editing, sourceEnd)
  if (syntaxStart === undefined || syntaxEnd === undefined) return undefined
  for (const segment of editing.mappedTape) {
    if (
      segment.projectedStart < syntaxEnd &&
      syntaxStart < segment.projectedEnd &&
      segment.kind !== 'canonical'
    ) {
      return undefined
    }
  }
  const sourceRange = range(sourceStart, sourceEnd)
  const events = publicMarkupEventRangeForSource(products, sourceRange)
  if (events === undefined) return undefined
  const display = products.commentDisplay(root.nodeId)
  return Object.freeze({
    source: sourceRange,
    syntax: range(syntaxStart, syntaxEnd),
    events,
    annotation: range(root.range.start, root.range.end),
    payload: range(root.arms[0].range.start, root.arms[0].range.end),
    projection: range(0, display.source.length),
    open: range(root.markers.open.start, root.markers.open.end),
    close: range(root.markers.close.start, root.markers.close.end)
  })
}

function sameAccountingShape(
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

function sameCriticTopology(
  previous: Profile1DocumentProducts,
  next: Profile1DocumentProducts
): boolean {
  const previousRoot = commentRootOf(previous)
  const nextRoot = commentRootOf(next)
  if (previousRoot === undefined || nextRoot === undefined) return false
  const pending: Array<readonly [CriticMarkupNode, CriticMarkupNode]> = [
    [previousRoot, nextRoot]
  ]
  while (pending.length > 0) {
    const pair = pending.pop()
    if (pair === undefined) break
    const [left, right] = pair
    if (left.kind !== right.kind || left.arms.length !== right.arms.length) {
      return false
    }
    for (let armIndex = 0; armIndex < left.arms.length; armIndex += 1) {
      const leftArm = left.arms[armIndex]
      const rightArm = right.arms[armIndex]
      if (
        leftArm === undefined ||
        rightArm === undefined ||
        leftArm.name !== rightArm.name ||
        leftArm.children.length !== rightArm.children.length
      ) {
        return false
      }
      for (
        let childIndex = leftArm.children.length - 1;
        childIndex >= 0;
        childIndex -= 1
      ) {
        const leftChild = leftArm.children[childIndex]
        const rightChild = rightArm.children[childIndex]
        if (leftChild === undefined || rightChild === undefined) return false
        pending.push([leftChild, rightChild])
      }
    }
  }
  return true
}

function expectedLocalTopology(
  products: Profile1DocumentProducts,
  index: CommentRegionalIndex
): boolean {
  const root = commentRootOf(products)
  if (root === undefined) return false
  const local = (absolute: SourceRange): SourceRange => range(
    absolute.start - index.source.start,
    absolute.end - index.source.start
  )
  return sameRange(root.range, local(index.annotation)) &&
    sameRange(root.arms[0].range, local(index.payload)) &&
    sameRange(root.markers.open, local(index.open)) &&
    sameRange(root.markers.close, local(index.close))
}

function touchesNestedMarker(
  products: Profile1DocumentProducts,
  index: CommentRegionalIndex,
  edit: RetainedPassSourceEdit
): boolean {
  const retained = products.retainedIntrinsic
  const root = commentRootOf(products)
  if (retained === undefined || root === undefined) return true
  const localStart = edit.start - index.source.start
  const localEnd = edit.end - index.source.start
  for (const decision of retained.markerDecisions) {
    if (
      sameRange(decision.range, root.markers.open) ||
      sameRange(decision.range, root.markers.close)
    ) {
      continue
    }
    if (localStart === localEnd) {
      if (decision.range.start < localStart && localStart < decision.range.end) {
        return true
      }
    } else if (
      localStart < decision.range.end &&
      decision.range.start < localEnd
    ) {
      return true
    }
  }
  return false
}

function evolveIndex(
  index: CommentRegionalIndex,
  _edit: RetainedPassSourceEdit,
  delta: number
): CommentRegionalIndex {
  return Object.freeze({
    ...index,
    source: range(index.source.start, index.source.end + delta),
    annotation: range(index.annotation.start, index.annotation.end + delta),
    payload: range(index.payload.start, index.payload.end + delta),
    open: index.open,
    close: range(index.close.start + delta, index.close.end + delta)
  })
}

export function admitCommentRegionalChange(
  previousSource: CanonicalSourceView,
  nextSource: CanonicalSourceView,
  index: CommentRegionalIndex,
  requestedAnnotation: Readonly<{
    readonly start: number
    readonly end: number
  }>,
  edits: readonly RetainedPassSourceEdit[],
  executionBudget: ExecutionBudgetId,
  markdownOptions: MarkdownOptionsV1,
  physicalRecorder: Profile1PhysicalTraversalRecorderV1
): CommentRegionalAdmissionResult | undefined {
  if (!sameRange(requestedAnnotation, index.annotation)) return undefined
  const edit = edits.length === 1 ? edits[0] : undefined
  if (
    edit === undefined ||
    edit.start < index.payload.start ||
    edit.end > index.payload.end
  ) {
    return undefined
  }
  const delta = nextSource.length - previousSource.length
  let nextIndex = evolveIndex(index, edit, delta)
  const previousWindow = previousSource.slice(index.source.start, index.source.end)
  const nextWindow = nextSource.slice(
    index.source.start,
    index.source.end + delta
  )
  const parseWindow = (source: string) => parseProfile1Document(
    source,
    executionBudget,
    undefined,
    markdownOptions,
    true,
    undefined,
    createProfile1DocumentReuseCache(),
    physicalRecorder
  )
  const previousProducts = parseWindow(previousWindow)
  if (previousProducts.kind !== 'complete') {
    return Object.freeze({
      kind: 'resource-failure',
      fatalDiagnostic: shiftResourceDiagnostic(
        previousProducts.fatalDiagnostic,
        index.source.start
      )
    })
  }
  if (touchesNestedMarker(previousProducts, index, edit)) return undefined
  const nextProducts = parseWindow(nextWindow)
  if (nextProducts.kind !== 'complete') {
    return Object.freeze({
      kind: 'resource-failure',
      fatalDiagnostic: shiftResourceDiagnostic(
        nextProducts.fatalDiagnostic,
        index.source.start
      )
    })
  }
  const previousEditing = previousProducts.editing()
  const nextEditing = nextProducts.editing()
  const previousRoot = commentRootOf(previousProducts)
  const nextRoot = commentRootOf(nextProducts)
  if (previousRoot === undefined || nextRoot === undefined) return undefined
  const previousDisplay = previousProducts.commentDisplay(previousRoot.nodeId)
  const nextDisplay = nextProducts.commentDisplay(nextRoot.nodeId)
  nextIndex = Object.freeze({
    ...nextIndex,
    syntax: range(
      index.syntax.start,
      index.syntax.start + nextEditing.source.length
    ),
    projection: range(0, nextDisplay.source.length)
  })
  if (
    previousEditing.source.length !== index.syntax.end - index.syntax.start ||
    previousDisplay.source.length !== index.projection.end ||
    !expectedLocalTopology(previousProducts, index) ||
    !expectedLocalTopology(nextProducts, nextIndex) ||
    !sameCriticTopology(previousProducts, nextProducts) ||
    !sameAccountingShape(previousProducts, nextProducts) ||
    previousEditing.source !== nextEditing.source
  ) {
    return undefined
  }
  return Object.freeze({
    kind: 'admitted',
    previousProducts,
    nextProducts,
    previousDisplay,
    nextDisplay,
    nextIndex,
    previousWindow,
    nextWindow
  })
}
