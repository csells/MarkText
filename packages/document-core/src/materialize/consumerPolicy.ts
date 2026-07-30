import type {
  CanonicalSourceLease,
  MarkupLiveRenderPlan
} from '../documentSession.js'
import type {
  CompleteDocumentRevision,
  CriticMarkupNode,
  DocumentRevision,
  MarkdownNode,
  NodeId,
  Profile1SyntaxNodeKind,
  ViewRange
} from '../revision.js'
import {
  sourceHashV1,
  type RevisionSemanticHashV1,
  type SourceHashV1
} from '../hashCodec.js'
import {
  isAuthenticCanonicalSourceLease
} from '../internal/session/canonicalSourceLeaseAuthority.js'
import {
  consumeTrustedHtml,
  materializeCleanHtml,
  materializeReviewHtml,
  type StaticHtmlStructure,
  type TrustedHtml
} from './trustedHtml.js'
import { markdownTextValue } from './htmlRender.js'
import { materializeProjectedText } from './textMaterializers.js'
import { parserHeadingAnchors } from './headingOutline.js'

export type ConsumerView = 'markup' | 'original' | 'revised'
export type ClipboardView = ConsumerView | 'source'

export interface PrivateSourceFlavor {
  readonly text: string
}

export interface ClipboardBundle {
  readonly kind: 'clipboard-bundle'
  readonly plainText: string
  readonly privateSource?: PrivateSourceFlavor
  readonly html?: TrustedHtml<'clipboard'>
}

export interface ClipboardText {
  readonly kind: 'clipboard-text'
  readonly plainText: string
}

export interface DisabledConsumer {
  readonly kind: 'disabled'
  readonly view: 'original' | 'revised'
  readonly consumer: 'cut' | 'cut-table' | 'paste' | 'replace'
  readonly reason: 'read-only-view'
}

declare const clipboardReceiptBrand: unique symbol

export interface ClipboardWriteReceipt {
  readonly kind: 'clipboard-write-receipt'
  readonly [clipboardReceiptBrand]: true
}

export interface CutPreparation {
  readonly kind: 'cut-preparation'
  readonly view: 'markup' | 'source'
  readonly selection: ViewRange
  readonly semanticHash: RevisionSemanticHashV1
  readonly bundle: ClipboardBundle
}

export interface SemanticCutAuthorization {
  readonly kind: 'semantic-cut-authorization'
  readonly view: 'markup' | 'source'
  readonly selection: ViewRange
  readonly semanticHash: RevisionSemanticHashV1
}

export type ClipboardConsumer =
  | 'normal-copy'
  | 'copy-rich'
  | 'copy-html'
  | 'copy-markdown'
  | 'copy-table'
  | 'copy-heading-link'
  | 'cut'
  | 'cut-table'

type SelectionClipboardConsumer = Exclude<
  ClipboardConsumer,
  'copy-heading-link'
>

export type ClipboardConsumerRequest =
  | Readonly<{
    readonly view: ClipboardView
    readonly consumer: SelectionClipboardConsumer
    readonly selection: ViewRange
  }>
  | Readonly<{
    readonly view: ConsumerView
    readonly consumer: 'copy-heading-link'
    readonly targetNodeId: NodeId
  }>

export type ClipboardConsumerResult =
  | ClipboardBundle
  | ClipboardText
  | CutPreparation
  | DisabledConsumer

export type PastePayload =
  | Readonly<{ readonly kind: 'private-source'; readonly text: string }>
  | Readonly<{ readonly kind: 'markdown'; readonly text: string }>
  | Readonly<{ readonly kind: 'external-text'; readonly text: string }>
  | Readonly<{
    readonly kind: 'safe-html'
    readonly html: TrustedHtml<'clipboard'>
  }>

export interface PasteConsumerRequest {
  readonly view: ConsumerView
  readonly payload: PastePayload
}

export type PasteConsumerResult =
  | Readonly<{
    readonly kind: 'raw-syntax-import'
    readonly source: 'private-source' | 'markdown'
    readonly text: string
  }>
  | Readonly<{
    readonly kind: 'semantic-text-edit'
    readonly text: string
  }>
  | Readonly<{
    readonly kind: 'semantic-html-edit'
    readonly html: TrustedHtml<'clipboard'>
  }>
  | DisabledConsumer

export interface ReplaceHit {
  readonly start: number
  readonly end: number
  readonly expected: string
}

export interface ReplaceConsumerRequest {
  readonly view: ConsumerView
  readonly replacement: string
  readonly hits: readonly ReplaceHit[]
}

export type ReplaceConsumerResult =
  | Readonly<{
    readonly kind: 'replace-plan'
    readonly view: 'markup'
    readonly semanticHash: RevisionSemanticHashV1
    readonly edits: readonly Readonly<{
      readonly start: number
      readonly end: number
      readonly text: string
    }>[]
  }>
  | Readonly<{
    readonly kind: 'replace-rejected'
    readonly view: 'markup'
    readonly reason: 'stale-hit' | 'non-editable-hit'
    readonly edits: readonly never[]
  }>
  | DisabledConsumer

export type StaticConsumer = 'static-html' | 'styled-html' | 'pdf' | 'print'

type StaticSink<Consumer extends StaticConsumer> =
  Consumer extends 'static-html'
    ? 'static'
    : Consumer extends 'styled-html'
      ? 'styled'
      : Consumer

type StaticKind<Consumer extends StaticConsumer> =
  Consumer extends 'pdf'
    ? 'pdf-render-input'
    : Consumer extends 'print'
      ? 'print-render-input'
      : Consumer

export interface StaticConsumerRequest<Consumer extends StaticConsumer> {
  readonly view: ConsumerView
  readonly consumer: Consumer
  readonly structure: StaticHtmlStructure
}

export interface StaticConsumerResult<Consumer extends StaticConsumer> {
  readonly kind: StaticKind<Consumer>
  readonly view: ConsumerView
  readonly html: TrustedHtml<StaticSink<Consumer>>
}

export interface PersistenceConsumerResult<
  View extends PersistenceView = PersistenceView
> {
  readonly kind: 'canonical-persistence-source'
  readonly view: View
  readonly revision: CanonicalSourceLease['revision']['id']
  readonly sourceHash: SourceHashV1
  readonly text: string
}

export type PersistenceView = ConsumerView | 'source'

export interface LiveConsumerRoute {
  readonly kind: 'live-render-plan'
  readonly plan: MarkupLiveRenderPlan
}

export type ConsumerSink =
  | 'live'
  | 'text'
  | 'html'
  | 'clipboard'
  | 'pdf'
  | 'print'

/**
 * What "exact" means for one Profile 1 kind in one sink, anchored at the
 * editing surface (Markup view; the clean Original/Revised routes remain the
 * view × consumer cells above):
 *
 * - `exact-canonical`: the sink carries the construct's exact canonical
 *   source bytes.
 * - `projected-payload`: the sink carries the decoded payload text and never
 *   a marker spelling.
 * - `semantic-html`: the sanitized sink-branded HTML represents the construct
 *   semantically; raw syntax and hostile markup never pass through unescaped.
 * - `suppressed`: the payload is deliberately absent from the sink's text and
 *   surfaced only through its typed annotation channel.
 */
export type SinkExactnessClaim =
  | 'exact-canonical'
  | 'projected-payload'
  | 'semantic-html'
  | 'suppressed'

export type KindSinkExactness = Readonly<
  Record<ConsumerSink, SinkExactnessClaim>
>

/**
 * Coverage discipline: a `construct` row is proved directly against its own
 * canonical snippet; a `constituent` kind is emitted only inside its owning
 * construct and is proved through that row; `root` is the parse root every
 * row exercises.
 */
export type KindExactnessRow =
  | Readonly<{ readonly coverage: 'construct'; readonly sinks: KindSinkExactness }>
  | Readonly<{ readonly coverage: 'constituent'; readonly of: Profile1SyntaxNodeKind }>
  | Readonly<{ readonly coverage: 'root' }>

const MARKDOWN_CONSTRUCT: KindExactnessRow = Object.freeze({
  coverage: 'construct',
  sinks: Object.freeze({
    live: 'exact-canonical',
    text: 'exact-canonical',
    html: 'semantic-html',
    clipboard: 'exact-canonical',
    pdf: 'semantic-html',
    print: 'semantic-html'
  })
} as const)

const TRACKED_CHANGE_CONSTRUCT: KindExactnessRow = Object.freeze({
  coverage: 'construct',
  sinks: Object.freeze({
    live: 'projected-payload',
    text: 'exact-canonical',
    html: 'semantic-html',
    clipboard: 'exact-canonical',
    pdf: 'semantic-html',
    print: 'semantic-html'
  })
} as const)

function constituent(of: Profile1SyntaxNodeKind): KindExactnessRow {
  return Object.freeze({ coverage: 'constituent', of } as const)
}

/**
 * The per-Profile-1-kind exactness table over the six non-negotiable sinks.
 * One table, not six: every per-kind exactness question production answers is
 * declared here, and the strict `Record` makes a new syntax kind fail to
 * compile until it declares its row. Proven row by row, hostile input
 * included, by `test/materialize/per-kind-sink-exactness.spec.ts` (A41).
 */
export const PROFILE1_KIND_SINK_EXACTNESS: Readonly<
  Record<Profile1SyntaxNodeKind, KindExactnessRow>
> = Object.freeze({
  document: Object.freeze({ coverage: 'root' } as const),
  paragraph: MARKDOWN_CONSTRUCT,
  heading: MARKDOWN_CONSTRUCT,
  blockquote: MARKDOWN_CONSTRUCT,
  list: MARKDOWN_CONSTRUCT,
  'list-item': constituent('list'),
  'thematic-break': MARKDOWN_CONSTRUCT,
  text: constituent('paragraph'),
  'soft-break': MARKDOWN_CONSTRUCT,
  'hard-break': MARKDOWN_CONSTRUCT,
  emphasis: MARKDOWN_CONSTRUCT,
  strong: MARKDOWN_CONSTRUCT,
  strikethrough: MARKDOWN_CONSTRUCT,
  subscript: MARKDOWN_CONSTRUCT,
  superscript: MARKDOWN_CONSTRUCT,
  link: MARKDOWN_CONSTRUCT,
  image: MARKDOWN_CONSTRUCT,
  'inline-code': MARKDOWN_CONSTRUCT,
  'code-block': MARKDOWN_CONSTRUCT,
  'inline-html': MARKDOWN_CONSTRUCT,
  'html-block': MARKDOWN_CONSTRUCT,
  autolink: MARKDOWN_CONSTRUCT,
  definition: MARKDOWN_CONSTRUCT,
  'front-matter': MARKDOWN_CONSTRUCT,
  'inline-math': MARKDOWN_CONSTRUCT,
  'math-block': MARKDOWN_CONSTRUCT,
  diagram: MARKDOWN_CONSTRUCT,
  table: MARKDOWN_CONSTRUCT,
  'table-row': constituent('table'),
  'table-cell': constituent('table'),
  'footnote-definition': MARKDOWN_CONSTRUCT,
  'footnote-reference': MARKDOWN_CONSTRUCT,
  addition: TRACKED_CHANGE_CONSTRUCT,
  deletion: TRACKED_CHANGE_CONSTRUCT,
  substitution: TRACKED_CHANGE_CONSTRUCT,
  highlight: TRACKED_CHANGE_CONSTRUCT,
  comment: Object.freeze({
    coverage: 'construct',
    sinks: Object.freeze({
      live: 'suppressed',
      text: 'exact-canonical',
      html: 'semantic-html',
      clipboard: 'exact-canonical',
      pdf: 'semantic-html',
      print: 'semantic-html'
    })
  } as const),
  'critic-arm': constituent('addition'),
  'source-leaf': constituent('addition')
} as const)

const receiptBundles = new WeakMap<object, ClipboardBundle>()
const cutStates = new WeakMap<
  object,
  { readonly bundle: ClipboardBundle; authorized: boolean }
>()
const replaceAuthenticationCache = new WeakMap<
  CompleteDocumentRevision,
  Readonly<{
    readonly canonicalUnits: readonly CanonicalProjectionUnit[]
    readonly editableRanges: readonly NumericRange[]
  }>
>()

function assertComplete(
  revision: DocumentRevision
): asserts revision is CompleteDocumentRevision {
  if (revision.kind === 'source-only') {
    throw new Error(
      'SourceOnly revision has no view consumer; use acknowledged Source mode'
    )
  }
  if (revision.kind !== 'complete') {
    throw new TypeError(
      'Static consumers require an immutable DocumentRevision'
    )
  }
}

export function viewLength(
  revision: DocumentRevision,
  view: ClipboardView
): number {
  if (view === 'source') return revision.source.text.length
  assertComplete(revision)
  if (view !== 'markup') {
    return revision.projection(view).source.length
  }
  let length = 0
  for (let ordinal = 0; ordinal < revision.markup.runCount; ordinal += 1) {
    length += revision.markup.runAt(ordinal).text.length
  }
  return length
}

function normalizeSelection(
  revision: CompleteDocumentRevision,
  view: ConsumerView,
  selection: ViewRange
): ViewRange {
  const length = viewLength(revision, view)
  if (
    !Number.isInteger(selection.start) ||
    !Number.isInteger(selection.end) ||
    selection.start < 0 ||
    selection.end < selection.start ||
    selection.end > length
  ) {
    throw new RangeError(
      `${view} consumer selection must be inside [0, ${String(length)}]`
    )
  }
  return Object.freeze({ start: selection.start, end: selection.end })
}

interface NumericRange {
  readonly start: number
  readonly end: number
}

interface CanonicalProjectionUnit {
  readonly sourceOffset: number
  readonly projectedOffset: number
}

function allCriticMarkupNodes(
  revision: CompleteDocumentRevision
): readonly CriticMarkupNode[] {
  const nodes: CriticMarkupNode[] = []
  const pending: CriticMarkupNode[] = []
  for (
    let ordinal = revision.criticMarkup.rootCount - 1;
    ordinal >= 0;
    ordinal -= 1
  ) {
    pending.push(revision.criticMarkup.rootAt(ordinal))
  }
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) {
      continue
    }
    nodes.push(node)
    for (let armOrdinal = node.arms.length - 1; armOrdinal >= 0; armOrdinal -= 1) {
      const arm = node.arms[armOrdinal]
      if (arm === undefined) {
        continue
      }
      for (
        let childOrdinal = arm.children.length - 1;
        childOrdinal >= 0;
        childOrdinal -= 1
      ) {
        const child = arm.children[childOrdinal]
        if (child !== undefined) {
          pending.push(child)
        }
      }
    }
  }
  return nodes
}

function markupCanonicalRange(
  revision: CompleteDocumentRevision,
  selection: ViewRange
): NumericRange {
  if (selection.start === 0 && selection.end === viewLength(revision, 'markup')) {
    return { start: 0, end: revision.source.text.length }
  }
  if (selection.start === selection.end) {
    return { start: 0, end: 0 }
  }
  let modelPosition = 0
  let sourceStart: number | undefined
  let sourceEnd: number | undefined
  const markedIntervals = new Map<string, NumericRange[]>()
  for (let ordinal = 0; ordinal < revision.markup.runCount; ordinal += 1) {
    const run = revision.markup.runAt(ordinal)
    const runStart = modelPosition
    const runEnd = runStart + run.text.length
    for (const mark of run.marks) {
      const intervals = markedIntervals.get(mark.nodeId) ?? []
      intervals.push({ start: runStart, end: runEnd })
      markedIntervals.set(mark.nodeId, intervals)
    }
    const overlapStart = Math.max(selection.start, runStart)
    const overlapEnd = Math.min(selection.end, runEnd)
    if (overlapStart < overlapEnd) {
      const mappedStart =
        run.sourceRange.start + overlapStart - runStart
      const mappedEnd =
        run.sourceRange.start + overlapEnd - runStart
      sourceStart = sourceStart === undefined
        ? mappedStart
        : Math.min(sourceStart, mappedStart)
      sourceEnd = sourceEnd === undefined
        ? mappedEnd
        : Math.max(sourceEnd, mappedEnd)
    }
    modelPosition = runEnd
  }
  if (sourceStart === undefined || sourceEnd === undefined) {
    return { start: 0, end: 0 }
  }
  for (const node of allCriticMarkupNodes(revision)) {
    const intervals = markedIntervals.get(node.nodeId)
    if (
      intervals !== undefined &&
      intervals.length > 0 &&
      intervals.every((interval) =>
        selection.start <= interval.start &&
        selection.end >= interval.end
      )
    ) {
      sourceStart = Math.min(sourceStart, node.range.start)
      sourceEnd = Math.max(sourceEnd, node.range.end)
    }
  }
  return { start: sourceStart, end: sourceEnd }
}

function projectedCanonicalRange(
  revision: CompleteDocumentRevision,
  view: 'original' | 'revised',
  selection: ViewRange
): NumericRange {
  const projection = revision.projection(view)
  if (selection.start === 0 && selection.end === projection.source.length) {
    return { start: 0, end: revision.source.text.length }
  }
  let sourceStart: number | undefined
  let sourceEnd: number | undefined
  for (let offset = selection.start; offset < selection.end; offset += 1) {
    const origin = projection.provenance.originAt(offset)
    const start = origin.kind === 'canonical'
      ? origin.sourceOffset
      : origin.sourcePosition
    const end = origin.kind === 'canonical' ? start + 1 : start
    sourceStart = sourceStart === undefined
      ? start
      : Math.min(sourceStart, start)
    sourceEnd = sourceEnd === undefined ? end : Math.max(sourceEnd, end)
  }
  if (sourceStart === undefined || sourceEnd === undefined) {
    return { start: 0, end: 0 }
  }
  const canonicalUnits: CanonicalProjectionUnit[] = []
  let previousSourceOffset = -1
  for (let offset = 0; offset < projection.source.length; offset += 1) {
    const origin = projection.provenance.originAt(offset)
    if (origin.kind !== 'canonical') {
      continue
    }
    if (origin.sourceOffset < previousSourceOffset) {
      throw new Error(
        `${view} projection provenance is not in canonical source order`
      )
    }
    canonicalUnits.push({
      sourceOffset: origin.sourceOffset,
      projectedOffset: offset
    })
    previousSourceOffset = origin.sourceOffset
  }
  for (const node of allCriticMarkupNodes(revision)) {
    const visibleRange = visibleArmRange(node, view)
    if (visibleRange === undefined) {
      continue
    }
    const first = lowerBoundCanonicalUnit(canonicalUnits, visibleRange.start)
    const after = lowerBoundCanonicalUnit(canonicalUnits, visibleRange.end)
    const firstUnit = canonicalUnits[first]
    const lastUnit = canonicalUnits[after - 1]
    if (
      first < after &&
      firstUnit !== undefined &&
      lastUnit !== undefined &&
      firstUnit.projectedOffset >= selection.start &&
      lastUnit.projectedOffset < selection.end
    ) {
      sourceStart = Math.min(sourceStart, node.range.start)
      sourceEnd = Math.max(sourceEnd, node.range.end)
    }
  }
  return { start: sourceStart, end: sourceEnd }
}

function visibleArmRange(
  node: CriticMarkupNode,
  view: 'original' | 'revised'
): NumericRange | undefined {
  if (node.kind === 'comment') {
    return undefined
  }
  if (
    (node.kind === 'addition' && view === 'original') ||
    (node.kind === 'deletion' && view === 'revised')
  ) {
    return undefined
  }
  if (node.kind === 'substitution') {
    const arm = view === 'original' ? node.arms[0] : node.arms[1]
    return { start: arm.range.start, end: arm.range.end }
  }
  const arm = node.arms[0]
  return { start: arm.range.start, end: arm.range.end }
}

function lowerBoundCanonicalUnit(
  units: readonly CanonicalProjectionUnit[],
  sourceOffset: number
): number {
  let low = 0
  let high = units.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    const unit = units[middle]
    if (unit !== undefined && unit.sourceOffset < sourceOffset) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return low
}

function canonicalSlice(
  revision: CompleteDocumentRevision,
  view: ConsumerView,
  selection: ViewRange
): string {
  const range = view === 'markup'
    ? markupCanonicalRange(revision, selection)
    : projectedCanonicalRange(revision, view, selection)
  return revision.source.text.slice(range.start, range.end)
}

function htmlForClipboard(
  revision: CompleteDocumentRevision,
  view: ConsumerView,
  selection: ViewRange
): TrustedHtml<'clipboard'> {
  return view === 'markup'
    ? materializeReviewHtml(revision, {
      view: 'markup',
      sink: 'clipboard',
      range: selection
    })
    : materializeCleanHtml(revision, {
      view,
      sink: 'clipboard',
      range: selection
    })
}

function normalCopyBundle(
  revision: CompleteDocumentRevision,
  view: ConsumerView,
  selection: ViewRange
): ClipboardBundle {
  const html = htmlForClipboard(revision, view, selection)
  if (view === 'markup') {
    const exact = canonicalSlice(revision, view, selection)
    return Object.freeze({
      kind: 'clipboard-bundle',
      plainText: exact,
      privateSource: Object.freeze({
        text: exact
      }),
      html
    })
  }
  return Object.freeze({
    kind: 'clipboard-bundle',
    plainText: materializeProjectedText(revision, view, selection).text,
    html
  })
}

function tableRectangleText(
  revision: CompleteDocumentRevision,
  view: ConsumerView,
  selection: ViewRange
): string {
  const projected = revision.projection(
    view === 'markup' ? 'editing' : view
  )
  const document = projected.markdown
  const tables: MarkdownNode[] = []
  const pending: MarkdownNode[] = [document.root]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) continue
    if (
      node.kind === 'table' &&
      selection.start >= node.range.start &&
      selection.end <= node.range.end
    ) {
      tables.push(node)
    }
    for (let ordinal = node.childCount - 1; ordinal >= 0; ordinal -= 1) {
      pending.push(node.childAt(ordinal))
    }
  }
  const table = tables[0]
  if (table === undefined) {
    throw new RangeError('Table clipboard selection is not inside one table')
  }
  const rows = Array.from(
    { length: table.childCount },
    (_, ordinal) => table.childAt(ordinal)
  )
  const coordinateAt = (
    offset: number
  ): Readonly<{ row: number; column: number }> | undefined => {
    for (let row = 0; row < rows.length; row += 1) {
      const rowNode = rows[row]
      if (rowNode === undefined) continue
      for (let column = 0; column < rowNode.childCount; column += 1) {
        const cell = rowNode.childAt(column)
        if (offset >= cell.range.start && offset <= cell.range.end) {
          return Object.freeze({ row, column })
        }
      }
    }
    return undefined
  }
  const first = coordinateAt(selection.start)
  const last = coordinateAt(selection.end)
  if (first === undefined || last === undefined) {
    throw new RangeError('Table clipboard selection has no cell rectangle')
  }
  const rowStart = Math.min(first.row, last.row)
  const rowEnd = Math.max(first.row, last.row)
  const columnStart = Math.min(first.column, last.column)
  const columnEnd = Math.max(first.column, last.column)
  const lines: string[] = []
  for (let row = rowStart; row <= rowEnd; row += 1) {
    const rowNode = rows[row]
    if (rowNode === undefined) continue
    const cells: string[] = []
    for (let column = columnStart; column <= columnEnd; column += 1) {
      if (column >= rowNode.childCount) continue
      const cell = rowNode.childAt(column)
      cells.push(
        materializeProjectedText(revision, view, cell.range).text.trim()
      )
    }
    if (cells.length > 0) lines.push(cells.join('\t'))
  }
  if (lines.length === 0) {
    throw new RangeError('Table clipboard selection is empty')
  }
  return lines.join('\n')
}

export function materializeClipboardConsumer(
  revision: DocumentRevision,
  request: ClipboardConsumerRequest
): ClipboardConsumerResult {
  if (request.consumer === 'copy-heading-link') {
    assertComplete(revision)
    return materializeHeadingLink(
      revision,
      request.view,
      request.targetNodeId
    )
  }
  if (request.view === 'source') {
    const selection = request.selection
    const length = revision.source.text.length
    if (
      !Number.isInteger(selection.start) ||
      !Number.isInteger(selection.end) ||
      selection.start < 0 ||
      selection.end < selection.start ||
      selection.end > length
    ) {
      throw new RangeError(
        `source consumer selection must be inside [0, ${String(length)}]`
      )
    }
    if (
      request.consumer !== 'copy-markdown' &&
      request.consumer !== 'normal-copy' &&
      request.consumer !== 'cut'
    ) {
      throw new RangeError(
        `Source clipboard does not support ${request.consumer}`
      )
    }
    const exact = revision.source.text.slice(selection.start, selection.end)
    if (
      request.consumer === 'cut' &&
      selection.start === selection.end
    ) {
      throw new RangeError('Source cut selection is collapsed')
    }
    if (request.consumer === 'copy-markdown') {
      return Object.freeze({
        kind: 'clipboard-text' as const,
        plainText: exact
      })
    }
    const bundle = Object.freeze({
      kind: 'clipboard-bundle' as const,
      plainText: exact,
      privateSource: Object.freeze({
        text: exact
      })
    })
    if (request.consumer === 'normal-copy') return bundle
    const preparation: CutPreparation = Object.freeze({
      kind: 'cut-preparation',
      view: 'source',
      selection: Object.freeze({
        start: selection.start,
        end: selection.end
      }),
      semanticHash: revision.semanticHash,
      bundle
    })
    cutStates.set(preparation, {
      bundle: preparation.bundle,
      authorized: false
    })
    return preparation
  }
  assertComplete(revision)
  const selection = normalizeSelection(
    revision,
    request.view,
    request.selection
  )
  if (request.consumer === 'cut' || request.consumer === 'cut-table') {
    if (request.view !== 'markup') {
      return Object.freeze({
        kind: 'disabled',
        view: request.view,
        consumer: request.consumer,
        reason: 'read-only-view'
      })
    }
    if (selection.start === selection.end) {
      throw new RangeError('Markup cut selection is collapsed')
    }
    const bundle = request.consumer === 'cut-table'
      ? Object.freeze({
        kind: 'clipboard-bundle' as const,
        plainText: tableRectangleText(revision, 'markup', selection)
      })
      : normalCopyBundle(revision, 'markup', selection)
    const preparation: CutPreparation = Object.freeze({
      kind: 'cut-preparation',
      view: 'markup',
      selection,
      semanticHash: revision.semanticHash,
      bundle
    })
    cutStates.set(preparation, {
      bundle: preparation.bundle,
      authorized: false
    })
    return preparation
  }
  if (request.consumer === 'normal-copy') {
    return normalCopyBundle(revision, request.view, selection)
  }
  if (request.consumer === 'copy-markdown') {
    return Object.freeze({
      kind: 'clipboard-text',
      plainText: canonicalSlice(revision, request.view, selection)
    })
  }
  if (request.consumer === 'copy-table') {
    return Object.freeze({
      kind: 'clipboard-text',
      plainText: tableRectangleText(revision, request.view, selection)
    })
  }
  const html = htmlForClipboard(revision, request.view, selection)
  if (request.consumer === 'copy-html') {
    return Object.freeze({
      kind: 'clipboard-text',
      plainText: consumeTrustedHtml(html, 'clipboard')
    })
  }
  if (request.consumer === 'copy-rich') {
    return Object.freeze({
      kind: 'clipboard-bundle',
      plainText: materializeProjectedText(
        revision,
        request.view,
        selection
      ).text,
      html
    })
  }
  const impossible: never = request.consumer
  throw new TypeError(`Unknown clipboard consumer: ${String(impossible)}`)
}

function materializeHeadingLink(
  revision: CompleteDocumentRevision,
  view: ConsumerView,
  targetNodeId: NodeId
): ClipboardText {
  for (const heading of parserHeadingAnchors(revision, view)) {
    if (heading.nodeId !== targetNodeId) continue
    return Object.freeze({
      kind: 'clipboard-text',
      plainText: `#${heading.slug}`
    })
  }
  throw new RangeError(
    `Heading-link target ${targetNodeId} is not a heading in the ${view} view`
  )
}

export function acknowledgeClipboardWrite(
  bundle: ClipboardBundle
): ClipboardWriteReceipt {
  const receipt = Object.freeze({
    kind: 'clipboard-write-receipt' as const
  }) as ClipboardWriteReceipt
  receiptBundles.set(receipt, bundle)
  return receipt
}

export function authorizeCut(
  preparation: CutPreparation,
  receipt: ClipboardWriteReceipt
): SemanticCutAuthorization {
  const state = cutStates.get(preparation)
  if (state === undefined) {
    throw new TypeError('Cut preparation is not authentic')
  }
  if (state.authorized) {
    throw new Error('Cut preparation is already authorized')
  }
  if (receiptBundles.get(receipt) !== state.bundle) {
    throw new TypeError('Clipboard receipt does not match the cut bundle')
  }
  state.authorized = true
  return Object.freeze({
    kind: 'semantic-cut-authorization',
    view: preparation.view,
    selection: preparation.selection,
    semanticHash: preparation.semanticHash
  })
}

export function classifyPasteConsumer(
  revision: DocumentRevision,
  request: PasteConsumerRequest
): PasteConsumerResult {
  assertComplete(revision)
  if (request.view !== 'markup') {
    return Object.freeze({
      kind: 'disabled',
      view: request.view,
      consumer: 'paste',
      reason: 'read-only-view'
    })
  }
  if (
    request.payload.kind === 'private-source' ||
    request.payload.kind === 'markdown'
  ) {
    return Object.freeze({
      kind: 'raw-syntax-import',
      source: request.payload.kind,
      text: request.payload.text
    })
  }
  if (request.payload.kind === 'external-text') {
    return Object.freeze({
      kind: 'semantic-text-edit',
      text: request.payload.text
    })
  }
  consumeTrustedHtml(request.payload.html, 'clipboard')
  return Object.freeze({
    kind: 'semantic-html-edit',
    html: request.payload.html
  })
}

function hitIsEditableVisible(
  revision: CompleteDocumentRevision,
  hit: ReplaceHit
): boolean {
  if (
    !Number.isInteger(hit.start) ||
    !Number.isInteger(hit.end) ||
    hit.start < 0 ||
    hit.end <= hit.start ||
    hit.end > revision.source.text.length
  ) {
    return false
  }
  let visibleRun = false
  for (let ordinal = 0; ordinal < revision.markup.runCount; ordinal += 1) {
    const range = revision.markup.runAt(ordinal).sourceRange
    if (hit.start >= range.start && hit.end <= range.end) {
      visibleRun = true
      break
    }
  }
  if (!visibleRun) {
    return false
  }
  const authentication = replaceAuthentication(revision)
  const firstIndex = lowerBoundCanonicalUnit(
    authentication.canonicalUnits,
    hit.start
  )
  const afterIndex = lowerBoundCanonicalUnit(
    authentication.canonicalUnits,
    hit.end
  )
  const first = authentication.canonicalUnits[firstIndex]
  const last = authentication.canonicalUnits[afterIndex - 1]
  if (
    first === undefined ||
    last === undefined ||
    first.sourceOffset !== hit.start ||
    last.sourceOffset !== hit.end - 1 ||
    afterIndex - firstIndex !== hit.end - hit.start ||
    last.projectedOffset - first.projectedOffset !== hit.end - hit.start - 1
  ) {
    return false
  }
  return editableRangeContains(
    authentication.editableRanges,
    first.projectedOffset,
    last.projectedOffset + 1
  )
}

function replaceAuthentication(
  revision: CompleteDocumentRevision
): Readonly<{
    readonly canonicalUnits: readonly CanonicalProjectionUnit[]
    readonly editableRanges: readonly NumericRange[]
  }> {
  const cached = replaceAuthenticationCache.get(revision)
  if (cached !== undefined) {
    return cached
  }
  const projection = revision.projection('editing')
  const canonicalUnits: CanonicalProjectionUnit[] = []
  let previousSourceOffset = -1
  for (let offset = 0; offset < projection.source.length; offset += 1) {
    const origin = projection.provenance.originAt(offset)
    if (origin.kind !== 'canonical') {
      continue
    }
    if (origin.sourceOffset <= previousSourceOffset) {
      throw new Error(
        'Editing projection provenance is not in strict canonical source order'
      )
    }
    canonicalUnits.push({
      sourceOffset: origin.sourceOffset,
      projectedOffset: offset
    })
    previousSourceOffset = origin.sourceOffset
  }
  const editableRanges: NumericRange[] = []
  collectEditableRanges(
    projection.markdown.source,
    projection.markdown.root,
    false,
    editableRanges
  )
  editableRanges.sort((left, right) => left.start - right.start)
  const authentication = Object.freeze({
    canonicalUnits: Object.freeze(canonicalUnits),
    editableRanges: Object.freeze(editableRanges)
  })
  replaceAuthenticationCache.set(revision, authentication)
  return authentication
}

function collectEditableRanges(
  source: string,
  node: MarkdownNode,
  hidden: boolean,
  ranges: NumericRange[]
): void {
  const childIsHidden = hidden ||
    node.kind === 'image' ||
    node.kind === 'definition' ||
    node.kind === 'front-matter' ||
    node.kind === 'footnote-definition'
  if (node.kind === 'text') {
    if (!childIsHidden) {
      collectLiteralTextRanges(source, node.range, ranges)
    }
    return
  }
  if (node.kind === 'inline-code') {
    if (!childIsHidden) {
      const markerLength = Number(node.attributes['markerLength'] ?? 1)
      const start = node.range.start + markerLength
      const end = node.range.end - markerLength
      if (start < end) {
        ranges.push({ start, end })
      }
    }
    return
  }
  if (node.kind === 'autolink') {
    if (!childIsHidden && node.range.start + 1 < node.range.end - 1) {
      ranges.push({
        start: node.range.start + 1,
        end: node.range.end - 1
      })
    }
    return
  }
  if (node.kind === 'soft-break') {
    if (!childIsHidden) {
      ranges.push(node.range)
    }
    return
  }
  for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
    collectEditableRanges(
      source,
      node.childAt(ordinal),
      childIsHidden,
      ranges
    )
  }
}

function collectLiteralTextRanges(
  source: string,
  range: NumericRange,
  ranges: NumericRange[]
): void {
  let literalStart = range.start
  let offset = range.start
  while (offset < range.end) {
    const transformedEnd = transformedTextTokenEnd(source, offset, range.end)
    if (transformedEnd === undefined) {
      offset += 1
      continue
    }
    if (literalStart < offset) {
      ranges.push({ start: literalStart, end: offset })
    }
    offset = transformedEnd
    literalStart = offset
  }
  if (literalStart < range.end) {
    ranges.push({ start: literalStart, end: range.end })
  }
}

function transformedTextTokenEnd(
  source: string,
  offset: number,
  end: number
): number | undefined {
  if (source.charCodeAt(offset) === 92 && offset + 1 < end) {
    const token = source.slice(offset, offset + 2)
    if (markdownTextValue(token) !== token) {
      return offset + 2
    }
  }
  if (source.charCodeAt(offset) !== 38) {
    return undefined
  }
  const semicolon = source.indexOf(';', offset + 1)
  if (semicolon < 0 || semicolon >= end || semicolon - offset >= 34) {
    return undefined
  }
  const token = source.slice(offset, semicolon + 1)
  return markdownTextValue(token) === token ? undefined : semicolon + 1
}

function editableRangeContains(
  ranges: readonly NumericRange[],
  start: number,
  end: number
): boolean {
  let low = 0
  let high = ranges.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    const range = ranges[middle]
    if (range !== undefined && range.start <= start) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  const candidate = ranges[low - 1]
  return candidate !== undefined &&
    start >= candidate.start &&
    end <= candidate.end
}

export function planReplaceConsumer(
  revision: DocumentRevision,
  request: ReplaceConsumerRequest
): ReplaceConsumerResult {
  assertComplete(revision)
  if (request.view !== 'markup') {
    return Object.freeze({
      kind: 'disabled',
      view: request.view,
      consumer: 'replace',
      reason: 'read-only-view'
    })
  }
  for (const hit of request.hits) {
    if (
      revision.source.text.slice(hit.start, hit.end) !== hit.expected
    ) {
      return Object.freeze({
        kind: 'replace-rejected',
        view: 'markup',
        reason: 'stale-hit',
        edits: Object.freeze([])
      })
    }
    if (!hitIsEditableVisible(revision, hit)) {
      return Object.freeze({
        kind: 'replace-rejected',
        view: 'markup',
        reason: 'non-editable-hit',
        edits: Object.freeze([])
      })
    }
  }
  return Object.freeze({
    kind: 'replace-plan',
    view: 'markup',
    semanticHash: revision.semanticHash,
    edits: Object.freeze(request.hits.map((hit) => Object.freeze({
      start: hit.start,
      end: hit.end,
      text: request.replacement
    })))
  })
}

export function materializeStaticConsumer<
  Consumer extends StaticConsumer
>(
  revision: DocumentRevision,
  request: StaticConsumerRequest<Consumer>
): StaticConsumerResult<Consumer> {
  assertComplete(revision)
  if (
    request.consumer !== 'static-html' &&
    request.consumer !== 'styled-html' &&
    request.consumer !== 'pdf' &&
    request.consumer !== 'print'
  ) {
    throw new RangeError(
      `Unknown static consumer: ${String(request.consumer)}`
    )
  }
  const sink: StaticSink<Consumer> = (
    request.consumer === 'static-html'
      ? 'static'
      : request.consumer === 'styled-html'
        ? 'styled'
        : request.consumer
  ) as StaticSink<Consumer>
  const html = request.view === 'markup'
    ? materializeReviewHtml(revision, {
      view: 'markup',
      sink,
      structure: request.structure
    })
    : materializeCleanHtml(revision, {
      view: request.view,
      sink,
      structure: request.structure
    })
  const kind: StaticKind<Consumer> = (
    request.consumer === 'pdf'
      ? 'pdf-render-input'
      : request.consumer === 'print'
        ? 'print-render-input'
        : request.consumer
  ) as StaticKind<Consumer>
  return Object.freeze({
    kind,
    view: request.view,
    html
  })
}

export async function materializePersistenceConsumer<
  View extends PersistenceView
>(
  lease: CanonicalSourceLease,
  view: View
): Promise<PersistenceConsumerResult<View>> {
  if (!isAuthenticCanonicalSourceLease(lease)) {
    throw new TypeError(
      'Persistence requires an authentic pinned canonical source lease'
    )
  }
  if (
    view !== 'markup' &&
    view !== 'original' &&
    view !== 'revised' &&
    view !== 'source'
  ) {
    throw new TypeError('Persistence view is invalid')
  }
  let expectedOffset = 0
  const parts: string[] = []
  for await (const chunk of lease.readChunks()) {
    if (
      !Number.isInteger(chunk.offset) ||
      chunk.offset !== expectedOffset ||
      typeof chunk.text !== 'string'
    ) {
      throw new Error('Canonical source lease returned unordered chunks')
    }
    parts.push(chunk.text)
    expectedOffset += chunk.text.length
  }
  const text = parts.join('')
  if (
    text.length !== lease.revision.sourceLength ||
    text !== lease.revision.source ||
    sourceHashV1(text) !== lease.sourceHash
  ) {
    throw new Error(
      'Canonical source lease does not match its pinned revision'
    )
  }
  return Object.freeze({
    kind: 'canonical-persistence-source',
    view,
    revision: lease.revision.id,
    sourceHash: lease.sourceHash,
    text
  })
}

export function routeLiveConsumer(
  plan: MarkupLiveRenderPlan
): LiveConsumerRoute {
  if (
    plan === null ||
    typeof plan !== 'object' ||
    plan.view !== 'markup' ||
    plan.editable !== true ||
    !Array.isArray(plan.runs) ||
    typeof plan.selectionAt !== 'function'
  ) {
    throw new TypeError(
      'Live editor consumers require a session MarkupLiveRenderPlan'
    )
  }
  return Object.freeze({
    kind: 'live-render-plan',
    plan
  })
}
