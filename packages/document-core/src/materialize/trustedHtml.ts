import type {
  CompleteDocumentRevision,
  CriticMarkupNode,
  DocumentRevision,
  MarkupMark,
  ViewRange
} from '../revision.js'
import {
  renderMarkdownHtml,
  renderMarkdownReviewHtml,
  type MarkdownStaticStructurePlan,
  type MarkdownReviewAnnotation,
  type MarkdownReviewElement,
  type MarkdownReviewRun
} from './htmlRender.js'
import { parserHeadingAnchors } from './headingOutline.js'

declare const trustedHtmlBrand: unique symbol

export type HtmlSink =
  | 'live-dom'
  | 'review'
  | 'clipboard'
  | 'static'
  | 'styled'
  | 'pdf'
  | 'print'

export type MaterializedHtmlSink = Exclude<HtmlSink, 'live-dom'>

export interface StaticHtmlStructure {
  readonly headingAnchors: 'github-slug-v1'
  readonly tableOfContents: Readonly<{
    readonly title: string
    readonly includeTopHeading: boolean
  }>
}

export interface TrustedHtml<Sink extends HtmlSink> {
  readonly kind: 'trusted-html'
  readonly sink: Sink
  readonly view: 'markup' | 'original' | 'revised'
  readonly [trustedHtmlBrand]: Sink
}

export interface CleanHtmlRequest<Sink extends MaterializedHtmlSink> {
  readonly view: 'original' | 'revised'
  readonly sink: Sink
  readonly structure?: StaticHtmlStructure
  readonly range?: ViewRange
}

export interface ReviewHtmlRequest<Sink extends MaterializedHtmlSink> {
  readonly view: 'markup'
  readonly sink: Sink
  readonly structure?: StaticHtmlStructure
  readonly range?: ViewRange
}

const trustedText = new WeakMap<object, string>()
const EMPTY_REVIEW_ELEMENTS: readonly MarkdownReviewElement[] = Object.freeze([])
const editingSourcePositions = new WeakMap<
  CompleteDocumentRevision,
  readonly Readonly<{
    readonly sourcePosition: number
    readonly editingPosition: number
  }>[]
>()

function exportFrontMatter(
  sink: MaterializedHtmlSink
): 'render' | 'omit' {
  return (
    sink === 'static' ||
    sink === 'styled' ||
    sink === 'pdf' ||
    sink === 'print'
  )
    ? 'render'
    : 'omit'
}

function isStructuredStaticSink(
  sink: MaterializedHtmlSink
): boolean {
  return (
    sink === 'static' ||
    sink === 'styled' ||
    sink === 'pdf' ||
    sink === 'print'
  )
}

function closedKeys(
  value: object,
  keys: readonly string[],
  label: string
): void {
  const actual = Reflect.ownKeys(value)
  if (
    actual.some(key => typeof key !== 'string') ||
    actual.length !== keys.length ||
    actual.some(key => !keys.includes(key as string))
  ) {
    throw new TypeError(`${label} must be a closed record`)
  }
}

function validateStaticHtmlStructure(
  sink: MaterializedHtmlSink,
  value: StaticHtmlStructure | undefined
): StaticHtmlStructure | undefined {
  if (!isStructuredStaticSink(sink)) {
    if (value !== undefined) {
      throw new TypeError(`${sink} HTML cannot carry static structure options`)
    }
    return undefined
  }
  if (value === undefined || value === null || typeof value !== 'object') {
    throw new TypeError(`${sink} HTML requires static structure options`)
  }
  closedKeys(value, [
    'headingAnchors',
    'tableOfContents'
  ], 'Static HTML structure')
  if (value.headingAnchors !== 'github-slug-v1') {
    throw new TypeError('Unknown static heading-anchor policy')
  }
  const toc = value.tableOfContents
  if (toc === null || typeof toc !== 'object') {
    throw new TypeError('Static table of contents must be a record')
  }
  closedKeys(toc, [
    'title',
    'includeTopHeading'
  ], 'Static table of contents')
  if (
    typeof toc.title !== 'string' ||
    toc.title.length > 4_096 ||
    typeof toc.includeTopHeading !== 'boolean'
  ) {
    throw new TypeError('Invalid static table-of-contents options')
  }
  return Object.freeze({
    headingAnchors: 'github-slug-v1',
    tableOfContents: Object.freeze({
      title: toc.title,
      includeTopHeading: toc.includeTopHeading
    })
  })
}

function parserStaticStructure(
  revision: CompleteDocumentRevision,
  view: TrustedHtml<MaterializedHtmlSink>['view'],
  structure: StaticHtmlStructure
): MarkdownStaticStructurePlan {
  const anchors = parserHeadingAnchors(revision, view)
  return Object.freeze({
    anchors,
    anchorsByNodeId: new Map(anchors.map(anchor => [
      anchor.nodeId,
      anchor
    ])),
    tableOfContents: structure.tableOfContents
  })
}

function assertComplete(
  revision: DocumentRevision
): asserts revision is CompleteDocumentRevision {
  if (revision.kind !== 'complete') {
    throw new Error(
      'SourceOnly revision has no semantic HTML materializer; persist its exact source instead'
    )
  }
}

/**
 * Produce clean Original/Revised HTML for one named sink.
 *
 * Construction and the retained string stay in this module. The value is both
 * statically branded and runtime-authenticated; a structurally similar object
 * is not a capability.
 */
export function materializeCleanHtml<Sink extends MaterializedHtmlSink>(
  revision: DocumentRevision,
  request: CleanHtmlRequest<Sink>
): TrustedHtml<Sink> {
  assertComplete(revision)
  assertMaterializedSink(request.sink)
  if (
    request.view !== 'original' &&
    request.view !== 'revised'
  ) {
    throw new RangeError(`Clean HTML has no view ${String(request.view)}`)
  }
  const structure = validateStaticHtmlStructure(
    request.sink,
    request.structure
  )
  const html = renderMarkdownHtml(
    revision.projection(request.view).markdown,
    {
      rawHtml: 'escape',
      unsafeUrls: 'drop',
      frontMatter: exportFrontMatter(request.sink),
      ...(structure === undefined
        ? {}
        : {
          staticStructure: parserStaticStructure(
            revision,
            request.view,
            structure
          )
        }),
      ...(request.range === undefined ? {} : { range: request.range })
    }
  )
  return createTrustedHtml(
    request.sink,
    request.view,
    formatForSink(html, request.sink)
  )
}

/**
 * Produce Markup Review HTML from the editing Markdown tree and the Markup
 * projection's parser-emitted mark ranges. Comment payloads never enter prose:
 * each visible Comment contributes one inert reference and one separately
 * sanitized Revised note.
 */
export function materializeReviewHtml<Sink extends MaterializedHtmlSink>(
  revision: DocumentRevision,
  request: ReviewHtmlRequest<Sink>
): TrustedHtml<Sink> {
  assertComplete(revision)
  assertMaterializedSink(request.sink)
  if (request.view !== 'markup') {
    throw new RangeError(`Review HTML has no view ${String(request.view)}`)
  }
  const editing = revision.projection('editing')
  const runs = reviewRuns(revision)
  const structure = validateStaticHtmlStructure(
    request.sink,
    request.structure
  )
  const allComments = visibleComments(revision)
  const range = request.range
  const comments = range === undefined
    ? allComments
    : allComments.filter((comment) => {
      const position = editingPositionAt(revision, comment.range.start)
      return position >= range.start && position <= range.end
    })
  const annotations: readonly MarkdownReviewAnnotation[] = Object.freeze(
    comments.map((comment, index) => Object.freeze({
      position: editingPositionAt(revision, comment.range.start),
      reference: `[${String(index + 1)}]`,
      noteId: `review-note-${String(index + 1)}`
    }))
  )
  const prose = renderMarkdownReviewHtml(editing.markdown, {
    runs,
    annotations,
    frontMatter: exportFrontMatter(request.sink),
    ...(structure === undefined
      ? {}
      : {
        staticStructure: parserStaticStructure(
          revision,
          request.view,
          structure
        )
      }),
    ...(request.range === undefined ? {} : { range: request.range })
  })
  const notes = comments.length === 0
    ? ''
    : '<section aria-label="Review notes">\n' +
      comments.map((comment, index) => {
        const note = renderMarkdownHtml(
          revision.commentDisplay(comment).markdown,
          { rawHtml: 'escape', unsafeUrls: 'drop' }
        )
        return `<aside role="note" id="review-note-${String(index + 1)}">` +
          `${note}</aside>\n`
      }).join('') +
      '</section>\n'
  return createTrustedHtml(
    request.sink,
    'markup',
    formatForSink(prose + notes, request.sink)
  )
}

/**
 * The insertion/adapter boundary. It rejects forged values and cross-sink
 * reuse before exposing the retained inert string to that sink.
 */
export function consumeTrustedHtml<Sink extends HtmlSink>(
  capability: TrustedHtml<Sink>,
  sink: Sink
): string {
  const html = trustedText.get(capability)
  if (html === undefined) {
    throw new TypeError('TrustedHtml capability is not authentic')
  }
  if (capability.sink !== sink) {
    throw new TypeError(
      `TrustedHtml sink mismatch: ${capability.sink} cannot enter ${sink}`
    )
  }
  return html
}

function createTrustedHtml<Sink extends HtmlSink>(
  sink: Sink,
  view: TrustedHtml<Sink>['view'],
  html: string
): TrustedHtml<Sink> {
  const capability = Object.freeze({
    kind: 'trusted-html' as const,
    sink,
    view
  }) as TrustedHtml<Sink>
  trustedText.set(capability, html)
  return capability
}

function assertMaterializedSink(
  sink: HtmlSink
): asserts sink is MaterializedHtmlSink {
  if (sink === 'live-dom') {
    throw new TypeError(
      'Live DOM consumes the session LiveRenderPlan, not static HTML'
    )
  }
  if (
    sink !== 'review' &&
    sink !== 'clipboard' &&
    sink !== 'static' &&
    sink !== 'styled' &&
    sink !== 'pdf' &&
    sink !== 'print'
  ) {
    throw new TypeError(`Unknown materialized HTML sink: ${String(sink)}`)
  }
}

const EXPORT_STYLE = [
  'body{font-family:system-ui,sans-serif;line-height:1.5;margin:2rem;}',
  'ins{background:#e6ffed;text-decoration:none;}',
  'del{background:#ffeef0;}',
  'mark{background:#fff3bf;}',
  '[role="note"]{border-left:3px solid #8b949e;padding-left:1rem;}'
].join('')

function formatForSink(html: string, sink: HtmlSink): string {
  if (sink !== 'styled' && sink !== 'pdf' && sink !== 'print') {
    return html
  }
  return '<!doctype html>\n' +
    '<html><head><meta charset="utf-8">' +
    `<style data-marktext-export>${EXPORT_STYLE}</style>` +
    `</head><body>${html}</body></html>\n`
}

function reviewElements(
  marks: readonly MarkupMark[]
): readonly MarkdownReviewElement[] {
  return Object.freeze(marks.map((mark) => {
    if (mark.kind === 'addition') {
      return 'ins'
    }
    if (mark.kind === 'deletion') {
      return 'del'
    }
    if (mark.kind === 'substitution') {
      return mark.arm === 'old' ? 'del' : 'ins'
    }
    return 'mark'
  }))
}

function reviewRuns(
  revision: CompleteDocumentRevision
): readonly MarkdownReviewRun[] {
  const editing = revision.projection('editing')
  const sourceRuns = Array.from(
    { length: revision.markup.runCount },
    (_, ordinal) => {
      const run = revision.markup.runAt(ordinal)
      return Object.freeze({
        start: Number(run.sourceRange.start),
        end: Number(run.sourceRange.end),
        elements: reviewElements(run.marks)
      })
    }
  )
  const runs: MarkdownReviewRun[] = []
  let sourceRunOrdinal = 0
  let rangeStart = 0
  let previousElements: readonly MarkdownReviewElement[] | undefined
  for (let offset = 0; offset < editing.source.length; offset += 1) {
    const origin = editing.provenance.originAt(offset)
    const sourcePosition = origin.kind === 'canonical'
      ? Number(origin.sourceOffset)
      : Number(origin.sourcePosition)
    while (
      sourceRuns[sourceRunOrdinal] !== undefined &&
      (sourceRuns[sourceRunOrdinal]?.end ?? 0) <= sourcePosition
    ) {
      sourceRunOrdinal += 1
    }
    const current = sourceRuns[sourceRunOrdinal]
    const previous = sourceRuns[sourceRunOrdinal - 1]
    const owner = origin.kind === 'canonical' || origin.affinity === 'next'
      ? current
      : current !== undefined &&
          current.start < sourcePosition &&
          sourcePosition <= current.end
        ? current
        : previous
    const elements = owner?.elements ?? EMPTY_REVIEW_ELEMENTS
    if (
      previousElements !== undefined &&
      !sameReviewElements(previousElements, elements)
    ) {
      runs.push(Object.freeze({
        start: rangeStart,
        end: offset,
        elements: previousElements
      }))
      rangeStart = offset
    }
    previousElements = elements
  }
  if (previousElements !== undefined) {
    runs.push(Object.freeze({
      start: rangeStart,
      end: editing.source.length,
      elements: previousElements
    }))
  }
  return Object.freeze(runs)
}

function sameReviewElements(
  left: readonly MarkdownReviewElement[],
  right: readonly MarkdownReviewElement[]
): boolean {
  return left.length === right.length &&
    left.every((element, index) => element === right[index])
}

function visibleComments(
  revision: CompleteDocumentRevision
): readonly Extract<CriticMarkupNode, { readonly kind: 'comment' }>[] {
  const comments: Array<
    Extract<CriticMarkupNode, { readonly kind: 'comment' }>
  > = []
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
    if (node.kind === 'comment') {
      comments.push(node)
      continue
    }
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
  return Object.freeze(comments)
}

function editingPositionAt(
  revision: CompleteDocumentRevision,
  sourcePosition: number
): number {
  let positions = editingSourcePositions.get(revision)
  if (positions === undefined) {
    const collected: Array<{
      readonly sourcePosition: number
      readonly editingPosition: number
    }> = []
    const editing = revision.projection('editing')
    for (let offset = 0; offset < editing.source.length; offset += 1) {
      const origin = editing.provenance.originAt(offset)
      collected.push(Object.freeze({
        sourcePosition: origin.kind === 'canonical'
          ? Number(origin.sourceOffset)
          : Number(origin.sourcePosition),
        editingPosition: offset
      }))
    }
    positions = Object.freeze(collected)
    editingSourcePositions.set(revision, positions)
  }
  let low = 0
  let high = positions.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    const position = positions[middle]
    if (
      position !== undefined &&
      position.sourcePosition < sourcePosition
    ) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return positions[low]?.editingPosition ??
    revision.projection('editing').source.length
}
