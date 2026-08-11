import type {
  CriticMarkupNode,
  ExecutionBudgetId,
  MarkdownNode,
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

export interface CriticMarkupRegionalIndex {
  readonly kind: 'addition'
  readonly source: SourceRange
  readonly syntax: SourceRange
  readonly events: Readonly<{ readonly start: number; readonly end: number }>
  readonly annotation: SourceRange
  readonly arm: SourceRange
}

export interface AdditionRegionalAdmission {
  readonly kind: 'admitted'
  readonly previousProducts: Profile1DocumentProducts
  readonly nextProducts: Profile1DocumentProducts
  readonly nextIndex: CriticMarkupRegionalIndex
  readonly previousWindow: string
  readonly nextWindow: string
}

export interface AdditionRegionalResourceFailure {
  readonly kind: 'resource-failure'
  readonly fatalDiagnostic: ResourceDiagnostic
}

export type AdditionRegionalAdmissionResult =
  | AdditionRegionalAdmission
  | AdditionRegionalResourceFailure

function range(start: number, end: number): SourceRange {
  return Object.freeze({
    start: start as SourceRange['start'],
    end: end as SourceRange['end']
  })
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
  projection: Profile1DocumentProducts['revised'],
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
  root: CriticMarkupNode,
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
    if (event.kind !== 'text') {
      if (event.mark.nodeId !== root.nodeId || !visit(root.range)) {
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

function additionRootOf(
  products: Profile1DocumentProducts
): CriticMarkupNode | undefined {
  const retained = products.retainedIntrinsic
  if (
    retained === undefined ||
    retained.roots.length !== 1 ||
    !retained.hasCriticMarkupCandidate ||
    retained.markerDecisions.length !== 2 ||
    retained.referenceDefinitionCount !== 0 ||
    retained.diagnostics.length !== 0 ||
    retained.markdownLiterals.length !== 0
  ) {
    return undefined
  }
  const root = retained.roots[0]
  const arm = root?.arms[0]
  const openDecision = retained.markerDecisions[0]
  const closeDecision = retained.markerDecisions[1]
  return root?.kind === 'addition' &&
    root.arms.length === 1 &&
    arm?.name === 'content' &&
    arm.children.length === 0 &&
    openDecision?.kind === 'addition' &&
    openDecision.role === 'open' &&
    openDecision.range.start === root.markers.open.start &&
    openDecision.range.end === root.markers.open.end &&
    closeDecision?.kind === 'addition' &&
    closeDecision.role === 'close' &&
    closeDecision.action === 'matched' &&
    closeDecision.range.start === root.markers.close.start &&
    closeDecision.range.end === root.markers.close.end &&
    balancedAdditionMarkup(products)
    ? root
    : undefined
}

export function createAdditionRegionalIndex(
  products: Profile1DocumentProducts
): CriticMarkupRegionalIndex | undefined {
  const retained = products.retainedIntrinsic
  const root = additionRootOf(products)
  const arm = root?.arms[0]
  if (retained === undefined || root === undefined || arm === undefined) {
    return undefined
  }
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
  const events = publicMarkupEventRangeForSource(products, root, sourceRange)
  if (events === undefined) return undefined
  return Object.freeze({
    kind: 'addition',
    source: sourceRange,
    syntax: range(syntaxStart, syntaxEnd),
    events,
    annotation: range(root.range.start, root.range.end),
    arm: range(arm.range.start, arm.range.end)
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

function sameMarkdownTopology(previous: MarkdownNode, next: MarkdownNode): boolean {
  const pending: Array<readonly [MarkdownNode, MarkdownNode]> = [[previous, next]]
  while (pending.length > 0) {
    const pair = pending.pop()
    if (pair === undefined) break
    const [left, right] = pair
    if (
      left.kind !== right.kind ||
      left.childCount !== right.childCount ||
      Object.keys(left.attributes).join('\u0000') !==
      Object.keys(right.attributes).join('\u0000')
    ) {
      return false
    }
    for (let ordinal = 0; ordinal < left.childCount; ordinal += 1) {
      pending.push([left.childAt(ordinal), right.childAt(ordinal)])
    }
  }
  return true
}

function balancedAdditionMarkup(products: Profile1DocumentProducts): boolean {
  if (products.markup.eventCount !== 5) return false
  const events = Array.from(
    { length: products.markup.eventCount },
    (_, ordinal) => products.markup.eventAt(ordinal)
  )
  const enter = events[1]
  const exit = events[3]
  return events[0]?.kind === 'text' &&
    enter?.kind === 'enter' &&
    enter.mark.kind === 'addition' &&
    events[2]?.kind === 'text' &&
    exit?.kind === 'exit' &&
    exit.mark === enter.mark &&
    events[4]?.kind === 'text'
}

function expectedLocalTopology(
  products: Profile1DocumentProducts,
  index: CriticMarkupRegionalIndex,
  delta: number
): boolean {
  const root = additionRootOf(products)
  const arm = root?.arms[0]
  if (root === undefined || arm === undefined) return false
  const localAnnotationStart = index.annotation.start - index.source.start
  const localAnnotationEnd = index.annotation.end - index.source.start + delta
  const localArmStart = index.arm.start - index.source.start
  const localArmEnd = index.arm.end - index.source.start + delta
  return root.range.start === localAnnotationStart &&
    root.range.end === localAnnotationEnd &&
    root.markers.open.start === localAnnotationStart &&
    root.markers.open.end === localArmStart &&
    root.markers.close.start === localArmEnd &&
    root.markers.close.end === localAnnotationEnd &&
    arm.range.start === localArmStart &&
    arm.range.end === localArmEnd &&
    balancedAdditionMarkup(products)
}

export function admitAdditionRegionalChange(
  previousSource: CanonicalSourceView,
  nextSource: CanonicalSourceView,
  index: CriticMarkupRegionalIndex,
  edits: readonly RetainedPassSourceEdit[],
  executionBudget: ExecutionBudgetId,
  markdownOptions: MarkdownOptionsV1,
  physicalRecorder: Profile1PhysicalTraversalRecorderV1
): AdditionRegionalAdmissionResult | undefined {
  const edit = edits.length === 1 ? edits[0] : undefined
  if (
    edit === undefined ||
    edit.start < index.arm.start ||
    edit.end > index.arm.end ||
    (edit.start === edit.end &&
      (edit.start <= index.arm.start || edit.start >= index.arm.end))
  ) {
    return undefined
  }
  const delta = nextSource.length - previousSource.length
  const previousWindow = previousSource.slice(
    index.source.start,
    index.source.end
  )
  const nextWindow = nextSource.slice(
    index.source.start,
    index.source.end + delta
  )
  const regionalOptions = Object.freeze({ ...markdownOptions, frontMatter: false })
  const parseWindow = (source: string) => parseProfile1Document(
    source,
    executionBudget,
    undefined,
    regionalOptions,
    true,
    undefined,
    createProfile1DocumentReuseCache(),
    physicalRecorder
  )
  const previousProducts = parseWindow(previousWindow)
  const nextProducts = parseWindow(nextWindow)
  if (previousProducts.kind !== 'complete') {
    return Object.freeze({
      kind: 'resource-failure',
      fatalDiagnostic: shiftResourceDiagnostic(
        previousProducts.fatalDiagnostic,
        index.source.start
      )
    })
  }
  if (nextProducts.kind !== 'complete') {
    return Object.freeze({
      kind: 'resource-failure',
      fatalDiagnostic: shiftResourceDiagnostic(
        nextProducts.fatalDiagnostic,
        index.source.start
      )
    })
  }
  if (
    !expectedLocalTopology(previousProducts, index, 0) ||
    !expectedLocalTopology(nextProducts, index, delta) ||
    !sameAccountingShape(previousProducts, nextProducts) ||
    !sameMarkdownTopology(
      previousProducts.editing().markdown.root,
      nextProducts.editing().markdown.root
    ) ||
    previousProducts.editing().mappedTape.some(segment =>
      segment.kind !== 'canonical'
    ) ||
    nextProducts.editing().mappedTape.some(segment =>
      segment.kind !== 'canonical'
    )
  ) {
    return undefined
  }
  return Object.freeze({
    kind: 'admitted',
    previousProducts,
    nextProducts,
    nextIndex: Object.freeze({
      ...index,
      source: range(index.source.start, index.source.end + delta),
      syntax: range(index.syntax.start, index.syntax.end + delta),
      annotation: range(index.annotation.start, index.annotation.end + delta),
      arm: range(index.arm.start, index.arm.end + delta)
    }),
    previousWindow,
    nextWindow
  })
}
