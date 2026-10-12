import type {
  CriticMarkupNode,
  ExecutionBudgetId,
  MarkdownNode,
  MarkdownOptionsV1,
  ResourceDiagnostic,
  SourceRange
} from '../../revision.js'
import {
  parseProfile1Window,
  type Profile1DocumentProducts,
  type RetainedPassSourceEdit
} from '../profile1Document.js'
import {
  exactProjectedOffset,
  publicMarkupEventRangeForSource,
  sameAccountingShape,
  shiftResourceDiagnostic
} from './regionalWindow.js'
import { sameRange, sourceRange as range } from './sourceRanges.js'
import type { CanonicalSourceView } from '../persistentCanonicalSource.js'
import type { Profile1PhysicalTraversalRecorderV1 } from './physicalTraversalAccounting.js'

type RegionalCriticMarkupKind = Exclude<CriticMarkupNode['kind'], 'comment'>
type RegionalCriticMarkupArmName = 'content' | 'old' | 'new'

export interface CriticMarkupRegionalArmIndex<
  Name extends RegionalCriticMarkupArmName = RegionalCriticMarkupArmName
> {
  readonly name: Name
  readonly range: SourceRange
}

export interface CriticMarkupRegionalMarkerIndex<
  Role extends 'open' | 'separator' | 'close' =
  'open' | 'separator' | 'close'
> {
  readonly role: Role
  readonly range: SourceRange
}

interface CriticMarkupRegionalIndexCommon {
  readonly source: SourceRange
  readonly syntax: SourceRange
  readonly events: Readonly<{ readonly start: number; readonly end: number }>
  readonly annotation: SourceRange
}

export type CriticMarkupRegionalIndex =
  | Readonly<CriticMarkupRegionalIndexCommon & {
    readonly kind: Exclude<RegionalCriticMarkupKind, 'substitution'>
    readonly markers: readonly [
      CriticMarkupRegionalMarkerIndex<'open'>,
      CriticMarkupRegionalMarkerIndex<'close'>
    ]
    readonly arms: readonly [CriticMarkupRegionalArmIndex<'content'>]
  }>
  | Readonly<CriticMarkupRegionalIndexCommon & {
    readonly kind: 'substitution'
    readonly markers: readonly [
      CriticMarkupRegionalMarkerIndex<'open'>,
      CriticMarkupRegionalMarkerIndex<'separator'>,
      CriticMarkupRegionalMarkerIndex<'close'>
    ]
    readonly arms: readonly [
      CriticMarkupRegionalArmIndex<'old'>,
      CriticMarkupRegionalArmIndex<'new'>
    ]
  }>

export interface CriticMarkupRegionalAdmission {
  readonly kind: 'admitted'
  readonly previousProducts: Profile1DocumentProducts
  readonly nextProducts: Profile1DocumentProducts
  readonly nextIndex: CriticMarkupRegionalIndex
  readonly previousWindow: string
  readonly nextWindow: string
}

export interface CriticMarkupRegionalResourceFailure {
  readonly kind: 'resource-failure'
  readonly fatalDiagnostic: ResourceDiagnostic
}

export type CriticMarkupRegionalAdmissionResult =
  | CriticMarkupRegionalAdmission
  | CriticMarkupRegionalResourceFailure

function markerInventoryMatches(
  products: Profile1DocumentProducts,
  root: Exclude<CriticMarkupNode, { readonly kind: 'comment' }>
): boolean {
  const decisions = products.retainedIntrinsic?.markerDecisions ?? []
  const open = decisions[0]
  const close = decisions.at(-1)
  if (
    open?.kind !== root.kind ||
    open.role !== 'open' ||
    open.parentOpenRunId !== null ||
    !sameRange(open.range, root.markers.open) ||
    close?.kind !== root.kind ||
    close.role !== 'close' ||
    close.action !== 'matched' ||
    close.openerRunId !== open.runId ||
    !sameRange(close.range, root.markers.close)
  ) {
    return false
  }
  if (root.kind !== 'substitution') return decisions.length === 2
  const separator = decisions[1]
  return decisions.length === 3 &&
    separator?.kind === 'substitution' &&
    separator.role === 'separator' &&
    separator.openerRunId === open.runId &&
    sameRange(separator.range, root.markers.separator)
}

function balancedMarkup(
  products: Profile1DocumentProducts,
  root: Exclude<CriticMarkupNode, { readonly kind: 'comment' }>
): boolean {
  const events = Array.from(
    { length: products.markup.eventCount },
    (_, ordinal) => products.markup.eventAt(ordinal)
  )
  if (events[0]?.kind !== 'text' || events.at(-1)?.kind !== 'text') {
    return false
  }
  let ordinal = 1
  for (const arm of root.arms) {
    const enter = events[ordinal]
    const text = events[ordinal + 1]
    const exit = events[ordinal + 2]
    if (
      enter?.kind !== 'enter' ||
      text?.kind !== 'text' ||
      exit?.kind !== 'exit' ||
      enter.mark.nodeId !== root.nodeId ||
      enter.mark.kind !== root.kind ||
      exit.mark !== enter.mark ||
      !sameRange(text.sourceRange, arm.range) ||
      (root.kind === 'substitution' &&
        (enter.mark.kind !== 'substitution' || enter.mark.arm !== arm.name))
    ) {
      return false
    }
    ordinal += 3
  }
  return ordinal === events.length - 1
}

function standardRootOf(
  products: Profile1DocumentProducts
): Exclude<CriticMarkupNode, { readonly kind: 'comment' }> | undefined {
  const retained = products.retainedIntrinsic
  if (
    retained === undefined ||
    retained.roots.length !== 1 ||
    !retained.hasCriticMarkupCandidate ||
    retained.referenceDefinitionCount !== 0 ||
    retained.diagnostics.length !== 0 ||
    retained.markdownLiterals.length !== 0
  ) {
    return undefined
  }
  const root = retained.roots[0]
  if (
    root === undefined ||
    root.kind === 'comment' ||
    root.arms.some(arm => arm.children.length !== 0)
  ) {
    return undefined
  }
  const correctArms = root.kind === 'substitution'
    ? root.arms.length === 2 &&
      root.arms[0]?.name === 'old' &&
      root.arms[1]?.name === 'new'
    : root.arms.length === 1 && root.arms[0]?.name === 'content'
  return correctArms &&
    markerInventoryMatches(products, root) &&
    balancedMarkup(products, root)
    ? root
    : undefined
}

function markersOf(
  root: Exclude<CriticMarkupNode, { readonly kind: 'comment' }>
): readonly CriticMarkupRegionalMarkerIndex[] {
  const markers: CriticMarkupRegionalMarkerIndex[] = [Object.freeze({
    role: 'open',
    range: range(root.markers.open.start, root.markers.open.end)
  })]
  if (root.kind === 'substitution') {
    markers.push(Object.freeze({
      role: 'separator',
      range: range(root.markers.separator.start, root.markers.separator.end)
    }))
  }
  markers.push(Object.freeze({
    role: 'close',
    range: range(root.markers.close.start, root.markers.close.end)
  }))
  return Object.freeze(markers)
}

export function createCriticMarkupRegionalIndex(
  products: Profile1DocumentProducts
): CriticMarkupRegionalIndex | undefined {
  const retained = products.retainedIntrinsic
  const root = standardRootOf(products)
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
  const events = publicMarkupEventRangeForSource(products, sourceRange, root)
  if (events === undefined) return undefined
  const common = Object.freeze({
    source: sourceRange,
    syntax: range(syntaxStart, syntaxEnd),
    events,
    annotation: range(root.range.start, root.range.end)
  })
  if (root.kind === 'substitution') {
    return Object.freeze({
      ...common,
      kind: root.kind,
      markers: Object.freeze([
        Object.freeze({ role: 'open' as const, range: root.markers.open }),
        Object.freeze({
          role: 'separator' as const,
          range: root.markers.separator
        }),
        Object.freeze({ role: 'close' as const, range: root.markers.close })
      ] as const),
      arms: Object.freeze([
        Object.freeze({ name: 'old' as const, range: root.arms[0].range }),
        Object.freeze({ name: 'new' as const, range: root.arms[1].range })
      ] as const)
    })
  }
  return Object.freeze({
    ...common,
    kind: root.kind,
    markers: Object.freeze([
      Object.freeze({ role: 'open' as const, range: root.markers.open }),
      Object.freeze({ role: 'close' as const, range: root.markers.close })
    ] as const),
    arms: Object.freeze([Object.freeze({
      name: 'content' as const,
      range: root.arms[0].range
    })] as const)
  })
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

function expectedLocalTopology(
  products: Profile1DocumentProducts,
  index: CriticMarkupRegionalIndex
): boolean {
  const root = standardRootOf(products)
  if (root === undefined || root.kind !== index.kind) return false
  const local = (absolute: SourceRange): SourceRange => range(
    absolute.start - index.source.start,
    absolute.end - index.source.start
  )
  if (
    !sameRange(root.range, local(index.annotation)) ||
    root.arms.length !== index.arms.length ||
    index.markers.length !== (root.kind === 'substitution' ? 3 : 2)
  ) {
    return false
  }
  const rootMarkers = markersOf(root)
  for (let ordinal = 0; ordinal < rootMarkers.length; ordinal += 1) {
    const rootMarker = rootMarkers[ordinal]
    const indexedMarker = index.markers[ordinal]
    if (
      rootMarker === undefined ||
      indexedMarker === undefined ||
      rootMarker.role !== indexedMarker.role ||
      !sameRange(rootMarker.range, local(indexedMarker.range))
    ) {
      return false
    }
  }
  for (let ordinal = 0; ordinal < root.arms.length; ordinal += 1) {
    const rootArm = root.arms[ordinal]
    const indexedArm = index.arms[ordinal]
    if (
      rootArm === undefined ||
      indexedArm === undefined ||
      rootArm.name !== indexedArm.name ||
      !sameRange(rootArm.range, local(indexedArm.range))
    ) {
      return false
    }
  }
  return true
}

function evolveIndex(
  index: CriticMarkupRegionalIndex,
  edit: RetainedPassSourceEdit,
  delta: number,
  extendsArmEnd: boolean
): CriticMarkupRegionalIndex {
  const transformOffset = (offset: number): number =>
    offset < edit.start || (offset === edit.start && !extendsArmEnd)
      ? offset
      : offset + delta
  const transformRange = (sourceRange: SourceRange): SourceRange => range(
    transformOffset(sourceRange.start),
    transformOffset(sourceRange.end)
  )
  const common = {
    ...index,
    source: range(index.source.start, index.source.end + delta),
    annotation: transformRange(index.annotation)
  }
  if (index.kind === 'substitution') {
    return Object.freeze({
      ...common,
      kind: index.kind,
      markers: Object.freeze([
        Object.freeze({
          role: 'open' as const,
          range: transformRange(index.markers[0].range)
        }),
        Object.freeze({
          role: 'separator' as const,
          range: transformRange(index.markers[1].range)
        }),
        Object.freeze({
          role: 'close' as const,
          range: transformRange(index.markers[2].range)
        })
      ] as const),
      arms: Object.freeze([
        Object.freeze({
          name: 'old' as const,
          range: transformRange(index.arms[0].range)
        }),
        Object.freeze({
          name: 'new' as const,
          range: transformRange(index.arms[1].range)
        })
      ] as const)
    })
  }
  return Object.freeze({
    ...common,
    kind: index.kind,
    markers: Object.freeze([
      Object.freeze({
        role: 'open' as const,
        range: transformRange(index.markers[0].range)
      }),
      Object.freeze({
        role: 'close' as const,
        range: transformRange(index.markers[1].range)
      })
    ] as const),
    arms: Object.freeze([Object.freeze({
      name: 'content' as const,
      range: transformRange(index.arms[0].range)
    })] as const)
  })
}

export function admitCriticMarkupRegionalChange(
  previousSource: CanonicalSourceView,
  nextSource: CanonicalSourceView,
  index: CriticMarkupRegionalIndex,
  edits: readonly RetainedPassSourceEdit[],
  executionBudget: ExecutionBudgetId,
  markdownOptions: MarkdownOptionsV1,
  physicalRecorder: Profile1PhysicalTraversalRecorderV1
): CriticMarkupRegionalAdmissionResult | undefined {
  const edit = edits.length === 1 ? edits[0] : undefined
  if (edit === undefined) return undefined
  // Typing appends at an arm's end, so a caret there extends the arm; its
  // closer moves with the text. A caret at an arm's start stays with the opener.
  const activeArmOrdinal = index.arms.findIndex(arm =>
    edit.start >= arm.range.start &&
    edit.end <= arm.range.end &&
    !(edit.start === edit.end &&
      (edit.start <= arm.range.start || edit.start > arm.range.end))
  )
  if (activeArmOrdinal < 0) return undefined
  const delta = nextSource.length - previousSource.length
  const extendsArmEnd = edit.start === edit.end &&
    edit.start === index.arms[activeArmOrdinal]?.range.end
  let nextIndex = evolveIndex(index, edit, delta, extendsArmEnd)
  const previousWindow = previousSource.slice(
    index.source.start,
    index.source.end
  )
  const nextWindow = nextSource.slice(
    index.source.start,
    index.source.end + delta
  )
  // Only a region at the document start can open front matter.
  const regionalOptions = index.source.start === 0
    ? markdownOptions
    : Object.freeze({ ...markdownOptions, frontMatter: false })
  const parseWindow = (source: string, endsAtDocumentEnd: boolean) => parseProfile1Window(
    source, executionBudget, regionalOptions, true, physicalRecorder, endsAtDocumentEnd
  )
  const previousProducts = parseWindow(previousWindow, index.source.end === previousSource.length)
  const nextProducts = parseWindow(nextWindow, index.source.end + delta === nextSource.length)
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
  const previousEditing = previousProducts.editing()
  const nextEditing = nextProducts.editing()
  if (
    previousEditing.source.length !== index.syntax.end - index.syntax.start
  ) {
    return undefined
  }
  nextIndex = Object.freeze({
    ...nextIndex,
    syntax: range(
      index.syntax.start,
      index.syntax.start + nextEditing.source.length
    )
  })
  if (
    !expectedLocalTopology(previousProducts, index) ||
    !expectedLocalTopology(nextProducts, nextIndex) ||
    !sameAccountingShape(previousProducts, nextProducts) ||
    !sameMarkdownTopology(
      previousEditing.markdown.root,
      nextEditing.markdown.root
    ) ||
    previousEditing.mappedTape.some(segment =>
      segment.kind !== 'canonical'
    ) ||
    nextEditing.mappedTape.some(segment =>
      segment.kind !== 'canonical'
    )
  ) {
    return undefined
  }
  return Object.freeze({
    kind: 'admitted',
    previousProducts,
    nextProducts,
    nextIndex,
    previousWindow,
    nextWindow
  })
}
