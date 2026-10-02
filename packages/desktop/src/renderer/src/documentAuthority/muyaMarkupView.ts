import {
  paragraphPrefixPosition,
  paragraphImageRange,
  setextUnderlineLeadingLine,
  setextUnderlineStart,
  tableCellContentRange
} from '@marktext/document-core'
import type { TState } from '@muyajs/core'
import type {
  CriticMarkupAnnotation,
  DocumentModelTextPoint,
  DocumentTableCellAddress,
  MarkdownAstNode,
  MarkupMark,
  MarkupProjection,
  ProjectionAffinity,
  SourceRange
} from '@marktext/document-core'

export interface MuyaMarkupSourceSegment {
  readonly text: SourceRange
  readonly source: SourceRange
  /** Coordinates in the Core-owned editing syntax, including generated protection. */
  readonly syntax: SourceRange
}

export type MuyaMarkupPath = readonly (number | string)[]

/**
 * The projected Markup state is TState-shaped JSON; Muya's declarations only
 * lack the desktop's structurally narrower projection type.
 */
export const asMuyaStates = (states: readonly MuyaMarkupState[]): TState[] =>
  states as unknown as TState[]

export interface MuyaMarkupState {
  readonly name: string
  text?: string
  readonly meta?: Readonly<Record<string, string | number | boolean>>
  readonly children?: readonly MuyaMarkupState[]
}

export interface MuyaDocumentEnd {
  readonly offset: number
  readonly trailingLineEndings: string
  readonly lineEnding: string
}

export interface MuyaSourceStructure {
  readonly range: SourceRange
  readonly source: string
  readonly nodes: readonly Readonly<{
    path: MuyaMarkupPath
    kind: string
    range: SourceRange
    lineStarts?: readonly number[]
    delimiterRange?: SourceRange
  }>[]
}

export interface MuyaMarkupBinding {
  readonly path: MuyaMarkupPath
  readonly text: string
  readonly sourceRange: SourceRange
  readonly segments: readonly MuyaMarkupSourceSegment[]
  readonly syntax: MarkdownAstNode
  readonly tableCell?: DocumentTableCellAddress
  readonly tableCellContent?: SourceRange
  /**
   * Spaces between a cell's text and its closing pipe. A space typed after the
   * text stays there, as upstream keeps it in the cell until the table is
   * written again, so the view shows that many of them after the text while
   * the model caret follows them.
   */
  readonly tableCellPadding?: number
  readonly listContinuation?: Readonly<{ prefix: string; lineEnding: string }>
  readonly annotationContext?: true
  readonly outerBlock?: Readonly<{ range: SourceRange; source: string; followingSource?: string }>
  readonly documentEnd?: MuyaDocumentEnd
  readonly sourceStructure?: MuyaSourceStructure
  readonly paragraphPrefixPosition?: number
  readonly containerPrefix?: Readonly<{ range: SourceRange; source: string }>
  readonly editable?: false
  readonly emptyLiteralLineEnding?: string
  /**
   * The caret position on the blank line that a soft break at this paragraph's
   * end creates, after the containers' continuation prefix, or on the empty
   * last line of a setext heading's text before its underline. That line
   * belongs to no block text, so the view shows it as the block's last line
   * only while the model selection is there. Muya holds that line's break as
   * `\n`, as the DOM does, whatever the source line ending.
   */
  readonly trailingLinePosition?: number
  /**
   * The caret position at the end of the blank line, or of the container-only
   * line such as a new list item's `- `, directly before this paragraph's first
   * line within its containers. Enter on an earlier line of a paragraph leaves
   * the caret there, where upstream shows the paragraph's empty first line.
   * The view presents that line only while the model selection is there.
   */
  readonly leadingLinePosition?: number
  /**
   * The spaces on a root paragraph's blank leading line, before its position.
   * Upstream keeps them as the paragraph's text, so the presented line shows
   * them and the caret can stand before them.
   */
  readonly leadingLineText?: string
  /**
   * The spaces after a root empty paragraph on its whitespace-only line, such
   * as the indentation left by deleting indented code's text. Upstream keeps
   * the caret after them, so the view shows them while the caret is there.
   */
  readonly blankLineText?: string
  /**
   * A single-line list or quote holding one paragraph. Upstream keeps a lone
   * marker it was typed as, or text that a thematic break's edit left, as
   * paragraph text. While the model selection is on the marker, or on a lone
   * marker's end, the view shows the container at `statePath` as that
   * paragraph of the line's source text.
   */
  readonly markerLine?: Readonly<{
    start: number
    end: number
    text: string
    content: number
    statePath: MuyaMarkupPath
  }>
  /**
   * Source spans that belong to no block text and have no DOM position of
   * their own: spaces before this block's first text or its trailing or
   * leading line position, which upstream keeps as text, and the container
   * prefix after a line break. The view shows a caret there at `at`.
   */
  readonly caretSnaps?: readonly MuyaCaretSnap[]
}

/** Source positions in `[from, to)` are shown at `at`. */
export interface MuyaCaretSnap {
  readonly from: number
  readonly to: number
  readonly at: number
}

export interface MuyaMarkupDecoration {
  /** Exact caret origin for annotation payload boundaries omitted by block layout. */
  readonly sourcePosition?: number
  /**
   * The annotation's end, after its closer, when `sourcePosition` ends its
   * final arm: a caret after this boundary is outside the annotation.
   */
  readonly exteriorEnd?: number
  readonly path: MuyaMarkupPath
  readonly range: SourceRange
  readonly mark: MarkupMark
}

export interface MuyaMarkupComment {
  readonly annotationRange: SourceRange
  readonly path: MuyaMarkupPath
  readonly offset: number
  /** The Comment's Revised plain text, which names its hidden-payload marker. */
  readonly text?: string
}

export interface MuyaMarkupView {
  readonly kind: 'view'
  /** Display-only compatibility text. Never parse or persist this value. */
  readonly markdown: string
  /** Exact shared-projection runs locating compatibility text in editing syntax. */
  readonly markdownSegments: readonly MuyaMarkdownSegment[]
  /** Blocks are taken from the Core syntax, never recognized from flattened arms. */
  readonly state: readonly MuyaMarkupState[]
  readonly bindings: readonly MuyaMarkupBinding[]
  readonly decorations: readonly MuyaMarkupDecoration[]
  readonly comments: readonly MuyaMarkupComment[]
}

export interface MuyaMarkdownSegment {
  readonly syntax: SourceRange
  readonly text: SourceRange
}

/** Coalesce only coordinate-contiguous runs; no spelling determines their positions. */
export function appendMuyaMarkdownSegment(
  segments: MuyaMarkdownSegment[],
  segment: MuyaMarkdownSegment
): void {
  const last = segments.at(-1)
  if (
    last !== undefined &&
    last.syntax.end === segment.syntax.start &&
    last.text.end === segment.text.start
  ) {
    segments[segments.length - 1] = {
      syntax: { start: last.syntax.start, end: segment.syntax.end },
      text: { start: last.text.start, end: segment.text.end }
    }
  } else segments.push(segment)
}

/** Only an owned text node can explain a non-linear display/source mapping. */
export function isMuyaNormalizedTextSegment(
  binding: { readonly text: string; readonly syntax?: MarkdownAstNode },
  segment: {
    readonly text: SourceRange
    readonly source: SourceRange
    readonly syntax?: SourceRange
  }
): boolean {
  return createMuyaNormalizedTextValidator(binding)(segment)
}

/** Share one syntax traversal across all normalized spans in a presentation. */
export function createMuyaNormalizedTextValidator(binding: {
  readonly text: string
  readonly syntax?: MarkdownAstNode
}) {
  const values = new Map<number, Map<number, string>>()
  const visit = (node: MarkdownAstNode): void => {
    if (node.kind === 'text' && typeof node.attributes.semanticText === 'string') {
      let ends = values.get(node.range.start)
      if (ends === undefined) values.set(node.range.start, (ends = new Map()))
      ends.set(node.range.end, node.attributes.semanticText)
    }
    if (node.kind === 'code-block') {
      for (const spelling of node.semanticTextSegments ?? []) {
        let ends = values.get(spelling.range.start)
        if (ends === undefined) values.set(spelling.range.start, (ends = new Map()))
        ends.set(spelling.range.end, spelling.value)
      }
    }
    node.children.forEach(visit)
  }
  if (binding.syntax !== undefined) visit(binding.syntax)
  return (segment: {
    readonly text: SourceRange
    readonly source: SourceRange
    readonly syntax?: SourceRange
  }): boolean => {
    const range = segment.syntax
    return (
      range !== undefined &&
      segment.source.end - segment.source.start === range.end - range.start &&
      values.get(range.start)?.get(range.end) ===
        binding.text.slice(segment.text.start, segment.text.end)
    )
  }
}

/** Interior positions in normalized text retain their parser-owned address. */
export function mappedMuyaModelPoint(
  binding: MuyaMarkupBinding,
  offset: number,
  affinity: ProjectionAffinity
): DocumentModelTextPoint | undefined {
  const source = mappedMuyaSourceRange(binding, { start: offset, end: offset }, affinity)
  if (source !== undefined) return source.start
  const segment = binding.segments.find(
    (item) =>
      item.text.start < offset &&
      offset < item.text.end &&
      isMuyaNormalizedTextSegment(binding, item)
  )
  return segment === undefined
    ? undefined
    : { text: { ...segment.source }, offset: offset - segment.text.start }
}

/**
 * Maps a text operation only when its selected source is contiguous. Insertions
 * choose the preceding payload at an elided closer, so continued typing remains
 * inside the suggestion. A selection crossing hidden syntax needs a semantic
 * transaction and must not be turned into a destructive raw-source splice.
 */
export function mappedMuyaSourceRange(
  binding: Readonly<{
    text: string
    sourceRange: SourceRange
    segments?: readonly Readonly<{ text: SourceRange; source: SourceRange }>[]
  }>,
  range: SourceRange,
  affinity: ProjectionAffinity = 'previous'
): SourceRange | undefined {
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    range.start < 0 ||
    range.end < range.start ||
    range.end > binding.text.length
  ) {
    return undefined
  }
  const segments = binding.segments ?? [
    {
      text: { start: 0, end: binding.text.length },
      source: binding.sourceRange
    }
  ]
  const sourceOffset = (segment: (typeof segments)[number], offset: number): number | undefined => {
    // Model-reconciled removals keep the pending native domain at one exact
    // source boundary until input queued against that domain is acknowledged.
    if (segment.source.start === segment.source.end) return segment.source.start
    if (offset === segment.text.start) return segment.source.start
    if (offset === segment.text.end) return segment.source.end
    return segment.text.end - segment.text.start === segment.source.end - segment.source.start
      ? segment.source.start + offset - segment.text.start
      : undefined
  }
  if (segments.length === 0 && binding.text.length === 0 && range.start === 0) {
    return { start: binding.sourceRange.end, end: binding.sourceRange.end }
  }
  if (range.start === range.end) {
    const candidates = segments.filter(
      (segment) => segment.text.start <= range.start && segment.text.end >= range.start
    )
    const segment = affinity === 'previous' ? candidates[0] : candidates.at(-1)
    if (segment === undefined) return undefined
    const offset = sourceOffset(segment, range.start)
    return offset === undefined ? undefined : { start: offset, end: offset }
  }
  const selected = segments.filter(
    (segment) => segment.text.start < range.end && segment.text.end > range.start
  )
  if (selected.length === 0) return undefined
  let end: number | undefined
  let start: number | undefined
  for (const segment of selected) {
    const segmentStart = sourceOffset(segment, Math.max(range.start, segment.text.start))
    const segmentEnd = sourceOffset(segment, Math.min(range.end, segment.text.end))
    if (segmentStart === undefined || segmentEnd === undefined) return undefined
    if (end !== undefined && segmentStart !== end) return undefined
    start ??= segmentStart
    end = segmentEnd
  }
  return start === undefined || end === undefined ? undefined : { start, end }
}

/**
 * The first segment, in text order, whose text holds `offset`: from its
 * start to before its end or, when `closing`, from after its start to its
 * end. A binding's segments follow its text, so their ends only grow.
 */
function segmentHolding(
  segments: readonly MuyaMarkupSourceSegment[],
  offset: number,
  closing: boolean
): MuyaMarkupSourceSegment | undefined {
  if (!textOrdered(segments)) {
    return segments.find((segment) => closing
      ? segment.text.start < offset && offset <= segment.text.end
      : segment.text.start <= offset && offset < segment.text.end)
  }
  let low = 0
  let high = segments.length
  while (low < high) {
    const middle = (low + high) >> 1
    const end = segments[middle].text.end
    if (closing ? end < offset : end <= offset) low = middle + 1
    else high = middle
  }
  const segment = segments[low]
  return segment !== undefined && (closing ? segment.text.start < offset : segment.text.start <= offset)
    ? segment
    : undefined
}

const textOrderedSegments = new WeakMap<readonly MuyaMarkupSourceSegment[], boolean>()

function textOrdered(segments: readonly MuyaMarkupSourceSegment[]): boolean {
  let ordered = textOrderedSegments.get(segments)
  if (ordered === undefined) {
    ordered = segments.every((segment, index) => index === 0 || segments[index - 1].text.end <= segment.text.end)
    textOrderedSegments.set(segments, ordered)
  }
  return ordered
}

/** Whether some segment's source holds a position, answered by binary search. */
function sourceCover(segments: readonly MuyaMarkupSourceSegment[]): (position: number) => boolean {
  const ordered = [...segments].sort((left, right) => left.source.start - right.source.start)
  // The furthest source end among the segments starting at or before each one.
  const reach: number[] = []
  for (const segment of ordered) reach.push(Math.max(reach.at(-1) ?? -Infinity, segment.source.end))
  return (position) => {
    let low = 0
    let high = ordered.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (ordered[middle].source.start <= position) low = middle + 1
      else high = middle
    }
    return low > 0 && reach[low - 1] > position
  }
}

/**
 * Detaches Core Markup syntax, source maps and marks for the Muya presentation.
 * A regional projection may bring `precedingEvents`, the unchanged text events
 * before its region, which only positions on the lines before its first block
 * read, and `following`, where the next block starts with the text events up
 * to there, which only the blank text after its last block reads.
 */
export function createMuyaMarkupView(
  projection: MarkupProjection,
  annotations: readonly CriticMarkupAnnotation[] = [],
  canonicalSource?: string,
  commentText?: (comment: CriticMarkupAnnotation) => string,
  precedingEvents: readonly Extract<MarkupProjection['events'][number], { kind: 'text' }>[] = [],
  following?: Readonly<{
    blockStart: number
    events: readonly Extract<MarkupProjection['events'][number], { kind: 'text' }>[]
  }>
): MuyaMarkupView {
  const sourceEvents = projection.events.filter((event) => event.kind === 'text')
  const readableEvents =
    precedingEvents.length === 0 && following === undefined
      ? sourceEvents
      : [...precedingEvents, ...sourceEvents, ...(following?.events ?? [])]
  const markdownSegments: MuyaMarkdownSegment[] = []
  const sourceRuns = projection.syntax.coordinates.sourceSegments ?? []
  let markdownOffset = 0
  let runIndex = 0
  for (const event of sourceEvents) {
    while (
      runIndex < sourceRuns.length &&
      sourceRuns[runIndex].source.end <= event.sourceRange.start
    ) {
      runIndex += 1
    }
    for (let index = runIndex; index < sourceRuns.length; index += 1) {
      const run = sourceRuns[index]
      if (run.source.start >= event.sourceRange.end) break
      const start = Math.max(run.source.start, event.sourceRange.start)
      const end = Math.min(run.source.end, event.sourceRange.end)
      if (start >= end) continue
      appendMuyaMarkdownSegment(markdownSegments, {
        syntax: {
          start: run.projected.start + start - run.source.start,
          end: run.projected.start + end - run.source.start
        },
        text: {
          start: markdownOffset + start - event.sourceRange.start,
          end: markdownOffset + end - event.sourceRange.start
        }
      })
    }
    markdownOffset += event.text.length
  }
  // Text events are in source order, so a range's text starts at the first
  // event ending after it: found by bisection, not by scanning every event.
  // The text a regional view was read with begins at a line start, after a
  // line break it holds no event for. Earlier text stands in as spaces, so
  // offsets into what it returns stay source offsets and that break is seen.
  const readableStart = precedingEvents[0]?.sourceRange.start ?? 0
  const sourceText = (start: number, end: number): string => {
    let text = ''
    if (start < readableStart && readableStart > 0) {
      const to = Math.min(end, readableStart)
      text = ' '.repeat(Math.max(0, to - start - 1)) + (to === readableStart ? '\n' : ' ')
      if (start >= to) text = ''
    }
    let low = 0
    let high = readableEvents.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (readableEvents[middle].sourceRange.end <= start) low = middle + 1
      else high = middle
    }
    for (let index = low; index < readableEvents.length; index += 1) {
      const event = readableEvents[index]
      if (event.sourceRange.start >= end) break
      const from = Math.max(start, event.sourceRange.start)
      const to = Math.min(end, event.sourceRange.end)
      if (from < to) {
        text += event.text.slice(from - event.sourceRange.start, to - event.sourceRange.start)
      }
    }
    return text
  }
  const sourceCharacter = (offset: number): string => sourceText(offset, offset + 1)
  let sourceLineStarts: readonly { source: number; projected: number }[] | undefined
  const lineStartsWithin = (range: SourceRange): readonly number[] => {
    // Each canonical event line is mapped once for this view. Structural leaves
    // share that coordinate index rather than re-scanning the whole document.
    sourceLineStarts ??= sourceEvents.flatMap((event) =>
      [...event.text.matchAll(/\r\n|\r|\n/gu)].map((match) => {
        const source = event.sourceRange.start + match.index + match[0].length
        return { source, projected: projection.syntax.coordinates.toProjected(source, 'next') }
      })
    )
    // Projected line starts rise with the source, so the range's lines are
    // one run, found by bisection.
    const lines = sourceLineStarts
    let low = 0
    let high = lines.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (lines[middle].projected <= range.start) low = middle + 1
      else high = middle
    }
    const starts: number[] = []
    for (let index = low; index < lines.length && lines[index].projected < range.end; index += 1) {
      starts.push(lines[index].source)
    }
    return starts
  }
  const continuations = new Map<string, Readonly<{ prefix: string; lineEnding: string }>>()
  const markerLines = new Map<string, NonNullable<MuyaMarkupBinding['markerLine']>>()
  /** Records a single-line container holding one paragraph, with its marker. */
  const markerLine = (
    container: MarkdownAstNode,
    paragraph: MarkdownAstNode | undefined,
    statePath: MuyaMarkupPath,
    leafPath: MuyaMarkupPath,
    pattern: RegExp
  ) => {
    if (paragraph?.kind !== 'paragraph') return
    const marker = projection.syntax.coordinates.toSource(container.range.start, 'next')
    // Upstream keeps the marker's indentation in the paragraph text that Enter
    // splits off, so a line-start caret before that indentation is in the line.
    let start = marker
    while (start > 0 && [' ', '\t'].includes(sourceCharacter(start - 1))) start -= 1
    if (!['', '\r', '\n'].includes(sourceCharacter(start - 1))) start = marker
    let end = start
    while (!['', '\r', '\n'].includes(sourceCharacter(end))) end += 1
    const text = sourceText(start, end)
    // An empty paragraph's start maps past the delimiter that closes an
    // annotation around its marker; its content begins before that delimiter.
    const content = Math.min(
      projection.syntax.coordinates.toSource(paragraph.range.start, 'next'),
      projection.syntax.coordinates.toSource(paragraph.range.end, 'previous')
    )
    if (
      projection.syntax.coordinates.toSource(paragraph.range.end, 'previous') > end ||
      !pattern.test(text.slice(marker - start))
    ) {
      return
    }
    markerLines.set(JSON.stringify(leafPath), { start, end, text, content, statePath })
  }
  const taskContentStarts = new Map<string, number>()
  const blocks = projection.syntax.ast.root.children
  const builders: Array<{
    syntax: MarkdownAstNode
    range: SourceRange
    path: MuyaMarkupPath
    state: MuyaMarkupState
    text: string
    segments: Array<{
      text: { start: number; end: number }
      source: { start: number; end: number }
      syntax: { start: number; end: number }
    }>
    marks: Map<MarkupMark, { start: number; end: number }>
    emptyLiteralLineEnding?: string
    container?: MarkdownAstNode
  }> = []
  const containers: MarkdownAstNode[] = []
  // Equal empty AST nodes may be shared; each occurrence still owns a distinct cell.
  const tableCells = new Map<string, DocumentTableCellAddress>()
  const orderedItems = new WeakSet<MarkdownAstNode>()
  const sourceNodes: MuyaSourceStructure['nodes'][number][] = []
  const typedState = (syntax: MarkdownAstNode, path: MuyaMarkupPath): MuyaMarkupState => {
    const attrs = syntax.attributes
    if (
      canonicalSource !== undefined &&
      ['table', 'list', 'blockquote'].includes(blocks[Number(path[0])]?.kind)
    ) {
      sourceNodes.push({
        path,
        kind: syntax.kind,
        range: {
          start: projection.syntax.coordinates.toSource(syntax.range.start, 'previous'),
          end: projection.syntax.coordinates.toSource(syntax.range.end, 'next')
        },
        ...(!['paragraph', 'code-block', 'heading', 'math-block', 'html-block', 'diagram'].includes(
          syntax.kind
        )
          ? {}
          : {
            lineStarts: lineStartsWithin(syntax.range)
          }),
        ...(syntax.kind !== 'table'
          ? {}
          : {
            delimiterRange: {
              start: projection.syntax.coordinates.toSource(
                Number(attrs.delimiterStart),
                'previous'
              ),
              end: projection.syntax.coordinates.toSource(Number(attrs.delimiterEnd), 'next')
            }
          })
      })
    }
    const children = (): readonly MuyaMarkupState[] => {
      const childNodes = syntax.children
      if (syntax.kind === 'list-item' && childNodes[0]?.kind === 'paragraph') {
        const start = projection.syntax.coordinates.toSource(syntax.range.start, 'next')
        const contentStart = childNodes[0].children[0]?.range.start ?? childNodes[0].range.start
        let end = projection.syntax.coordinates.toSource(contentStart, 'next')
        const first = childNodes[0]
        if (
          syntax.attributes.task === true &&
          orderedItems.has(syntax) &&
          first.range.start === first.range.end
        ) {
          // Upstream reads an ordered item's task marker without text as
          // the item's paragraph text.
          taskContentStarts.set(
            JSON.stringify([...path, 'children', 0]),
            Number(syntax.attributes.taskMarkerStart)
          )
        } else if (
          syntax.attributes.task === true &&
          (sourceCharacter(end) === ' ' || sourceCharacter(end) === '\t')
        ) {
          end += 1
          taskContentStarts.set(
            JSON.stringify([...path, 'children', 0]),
            projection.syntax.coordinates.toProjected(end, 'next')
          )
        }
        let lineStart = start
        while (
          lineStart > 0 &&
          sourceCharacter(lineStart - 1) !== '\n' &&
          sourceCharacter(lineStart - 1) !== '\r'
        ) {
          lineStart -= 1
        }
        let sourceEnd = projection.syntax.coordinates.toSource(syntax.range.end, 'previous')
        while (sourceCharacter(sourceEnd) === ' ' || sourceCharacter(sourceEnd) === '\t') {
          sourceEnd += 1
        }
        const lineEnding =
          sourceCharacter(sourceEnd) === '\r' && sourceCharacter(sourceEnd + 1) === '\n'
            ? '\r\n'
            : '\n'
        let prefix = sourceText(lineStart, end)
        if (syntax.attributes.task === true) {
          const markerStart = projection.syntax.coordinates.toSource(
            Number(syntax.attributes.taskMarkerStart),
            'next'
          )
          const markerEnd = projection.syntax.coordinates.toSource(
            Number(syntax.attributes.taskMarkerEnd),
            'previous'
          )
          prefix =
            prefix.slice(0, markerStart - lineStart) + '[ ]' + prefix.slice(markerEnd - lineStart)
        }
        continuations.set(JSON.stringify([...path, 'children', 0, 'text']), {
          prefix,
          lineEnding
        })
      }
      const container = ['list-item', 'blockquote', 'footnote-definition'].includes(syntax.kind)
      if (container) containers.push(syntax)
      try {
        return childNodes.map((child, index) => typedState(child, [...path, 'children', index]))
      } finally {
        if (container) containers.pop()
      }
    }
    const leaf = (
      name: string,
      meta?: MuyaMarkupState['meta'],
      range = syntax.range
    ): MuyaMarkupState => {
      const taskStart = taskContentStarts.get(JSON.stringify(path))
      if (taskStart !== undefined) range = { ...range, start: taskStart }
      const state: MuyaMarkupState = { name, text: '', ...(meta === undefined ? {} : { meta }) }
      builders.push({
        syntax,
        range,
        path: [...path, 'text'],
        state,
        text: '',
        segments: [],
        marks: new Map(),
        ...(containers.length === 0 ? {} : { container: containers.at(-1) })
      })
      return state
    }
    const contentRange = (): SourceRange => ({
      start: Number(attrs.contentStart),
      end: Number(attrs.contentEnd)
    })
    switch (syntax.kind) {
      case 'paragraph':
        return leaf('paragraph')
      case 'definition': {
        // A definition's range includes its line ending, which is no text.
        const end = projection.syntax.coordinates.toSource(syntax.range.end, 'previous')
        const ending = sourceText(Math.max(0, end - 2), end).match(/(?:\r\n|\r|\n)$/u)?.[0]
        return ending === undefined
          ? leaf('paragraph')
          : leaf('paragraph', undefined, {
            start: syntax.range.start,
            end: projection.syntax.coordinates.toProjected(end - ending.length, 'previous')
          })
      }
      case 'thematic-break':
        return leaf('thematic-break')
      case 'html-block': {
        const image = paragraphImageRange(syntax)
        return image === undefined
          ? leaf('html-block', undefined, contentRange())
          : leaf('paragraph', undefined, image)
      }
      case 'front-matter':
        return leaf('frontmatter', { lang: attrs.lang, style: attrs.style }, contentRange())
      case 'diagram':
        return leaf(
          'diagram',
          {
            type: String(attrs.language),
            lang: attrs.language === 'vega-lite' ? 'json' : 'yaml'
          },
          contentRange()
        )
      case 'footnote-definition':
        return {
          name: 'footnote',
          meta: { identifier: String(attrs.label) },
          children: children()
        }
      case 'heading':
        return attrs.style === 'setext'
          ? leaf(
            'setext-heading',
            { level: Number(attrs.level), underline: attrs.level === 1 ? '===' : '---' },
            {
              start: syntax.children[0]?.range.start ?? syntax.range.start,
              end: syntax.children.at(-1)?.range.end ?? syntax.range.end
            }
          )
          : leaf('atx-heading', { level: Number(attrs.level) })
      case 'blockquote':
        if (syntax.children.length === 1) {
          markerLine(syntax, syntax.children[0], path, [...path, 'children', 0, 'text'], /^>/u)
        }
        return { name: 'block-quote', children: children() }
      case 'list':
        if (
          syntax.children.length === 1 &&
          syntax.children[0].children.length === 1 &&
          syntax.children[0].attributes.task !== true
        ) {
          markerLine(
            syntax.children[0],
            syntax.children[0].children[0],
            path,
            [...path, 'children', 0, 'children', 0, 'text'],
            /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/u
          )
        }
        // Upstream renders only bullet task items with checkboxes; an ordered
        // item's task marker stays source syntax before its paragraph text.
        if (attrs.ordered) for (const item of syntax.children) orderedItems.add(item)
        return {
          name: attrs.ordered ? 'order-list' : attrs.taskList ? 'task-list' : 'bullet-list',
          meta: attrs.ordered
            ? { start: Number(attrs.start ?? 1), loose: !attrs.tight, delimiter: '.' }
            : { marker: '-', loose: !attrs.tight },
          children: children()
        }
      case 'list-item': {
        const task = attrs.task === true && !orderedItems.has(syntax)
        return {
          name: task ? 'task-list-item' : 'list-item',
          ...(task ? { meta: { checked: Boolean(attrs.checked) } } : {}),
          children: children()
        }
      }
      case 'table': {
        const table = {
          start: projection.syntax.coordinates.toSource(syntax.range.start, 'previous'),
          end: projection.syntax.coordinates.toSource(syntax.range.end, 'next')
        }
        syntax.children.forEach((row, rowIndex) =>
          row.children.forEach((_cell, column) => {
            tableCells.set(
              JSON.stringify([...path, 'children', rowIndex, 'children', column, 'text']),
              { table, row: rowIndex, column }
            )
          })
        )
        return { name: 'table', children: children() }
      }
      case 'table-row':
        return { name: 'table.row', children: children() }
      case 'table-cell':
        return leaf('table.cell', { align: String(attrs.alignment ?? 'none') })
      case 'math-block':
        return leaf(
          'math-block',
          { mathStyle: attrs.syntax === 'gitlab' ? 'gitlab' : '' },
          contentRange()
        )
      case 'code-block': {
        // An opener-only fence is still being authored on its opening line.
        // Keep that line reachable until the owned syntax has a body or closer.
        if (attrs.provider === 'fenced-code' && Number(attrs.contentStart) === syntax.range.end) {
          return leaf('paragraph', undefined, {
            start: syntax.range.start,
            end: Number(attrs.infoEnd)
          })
        }
        return leaf(
          'code-block',
          {
            type: attrs.provider === 'fenced-code' ? 'fenced' : 'indented',
            lang: String(attrs.infoInputValue ?? attrs.semanticInfo ?? attrs.info ?? '')
          },
          contentRange()
        )
      }
      default:
        throw new Error(`Core Markup view requires a typed adapter for ${syntax.kind}`)
    }
  }
  const state = blocks.map((block, index) => typedState(block, [index]))
  const activeMarks: MarkupMark[] = []
  const marksInOrder: MarkupMark[] = []
  let blockIndex = 0
  for (const event of projection.events) {
    if (event.kind === 'enter') {
      activeMarks.push(event.mark)
      marksInOrder.push(event.mark)
      continue
    }
    if (event.kind === 'exit') {
      if (activeMarks.pop() !== event.mark) throw new Error('Unbalanced Core Markup events')
      continue
    }
    for (let offset = 0; offset < event.text.length; offset += 1) {
      const source = event.sourceRange.start + offset
      const syntax = projection.syntax.coordinates.toProjected(source, 'next')
      while (blockIndex < builders.length && syntax >= builders[blockIndex].range.end) {
        blockIndex += 1
      }
      const builder = builders[blockIndex]
      if (builder === undefined || syntax < builder.range.start) continue
      // Container prefixes between a paragraph's or setext heading's lines
      // are not its text.
      if (
        (builder.syntax.kind === 'paragraph' ||
          (builder.syntax.kind === 'heading' && builder.syntax.attributes.style === 'setext')) &&
        builder.syntax.children.length > 0 &&
        !builder.syntax.children.some(
          (child) => child.range.start <= syntax && syntax < child.range.end
        )
      ) {
        continue
      }
      const text = builder.text.length
      builder.text += event.text[offset]
      const last = builder.segments.at(-1)
      if (last !== undefined && last.source.end === source && last.syntax.end === syntax) {
        last.text.end += 1
        last.source.end += 1
        last.syntax.end += 1
      } else {
        builder.segments.push({
          text: { start: text, end: text + 1 },
          source: { start: source, end: source + 1 },
          syntax: { start: syntax, end: syntax + 1 }
        })
      }
      for (const mark of activeMarks) {
        const range = builder.marks.get(mark)
        if (range === undefined) builder.marks.set(mark, { start: text, end: text + 1 })
        else range.end = text + 1
      }
    }
  }
  for (const builder of builders) {
    if (
      builder.state.name === 'paragraph' ||
      !['code-block', 'math-block', 'diagram', 'html-block', 'front-matter'].includes(
        builder.syntax.kind
      )
    ) {
      continue
    }
    let desired = ''
    const retained: Array<SourceRange & {
      normalizedText?: string
      /** Text the projection generates, as between an indented code block's arms. */
      generated?: Readonly<{ source: number; syntax: SourceRange }>
    }> = []
    let emptyPosition: number | undefined
    // Literal payload spelling and indentation belong to the common parser.
    // Adapt its literal children to the existing widget's source segments.
    if (builder.syntax.children.length === 0) {
      throw new Error('Core literal payload nodes are missing')
    }
    for (const child of builder.syntax.children) {
      if (child.kind !== 'text' && child.kind !== 'soft-break') {
        throw new Error('Core literal payload must be literal text')
      }
      const text = child.kind === 'soft-break' ? '\n' : child.attributes.semanticText
      if (typeof text !== 'string') throw new Error('Core literal text value is missing')
      desired += text
      if (child.range.start === child.range.end) {
        emptyPosition = child.range.start
        continue
      }
      const first = builder.segments.find(
        (segment) =>
          segment.syntax.start <= child.range.start && child.range.start < segment.syntax.end
      )
      const last = builder.segments.find(
        (segment) => segment.syntax.start < child.range.end && child.range.end <= segment.syntax.end
      )
      if ((first === undefined || last === undefined) &&
          !builder.segments.some((segment) =>
            segment.syntax.start < child.range.end && child.range.start < segment.syntax.end)) {
        // Text the projection generates, such as an indented code block's line
        // break between a Substitution's arms, reads at the source where the
        // text before it ends.
        const after = builder.segments.find((segment) => segment.syntax.start >= child.range.end)
        let before: (typeof builder.segments)[number] | undefined
        for (const segment of builder.segments) if (segment.syntax.end <= child.range.start) before = segment
        const at = after?.text.start ?? before?.text.end
        const source = before?.source.end ?? after?.source.start
        if (at === undefined || source === undefined) throw new Error('Core literal payload source mapping is incomplete')
        retained.push({ start: at, end: at, normalizedText: text, generated: { source, syntax: child.range } })
        continue
      }
      if (first === undefined || last === undefined) {
        throw new Error('Core literal payload source mapping is incomplete')
      }
      const start = first.text.start + child.range.start - first.syntax.start
      const end = last.text.end - last.syntax.end + child.range.end
      retained.push({
        start,
        end,
        ...(text.length === end - start ? {} : { normalizedText: text })
      })
    }
    const segments: typeof builder.segments = []
    let textOffset = 0
    for (const range of retained) {
      if (range.generated !== undefined && range.normalizedText !== undefined) {
        segments.push({
          text: { start: textOffset, end: textOffset + range.normalizedText.length },
          source: { start: range.generated.source, end: range.generated.source },
          syntax: { ...range.generated.syntax }
        })
        textOffset += range.normalizedText.length
        continue
      }
      if (range.normalizedText !== undefined) {
        const first = builder.segments.find(
          (segment) => segment.text.start <= range.start && segment.text.end > range.start
        )
        const last = builder.segments.find(
          (segment) => segment.text.start < range.end && segment.text.end >= range.end
        )
        if (first === undefined || last === undefined) {
          throw new Error('Core literal normalized source mapping is incomplete')
        }
        segments.push({
          text: { start: textOffset, end: textOffset + range.normalizedText.length },
          source: {
            start: first.source.start + range.start - first.text.start,
            end: last.source.end - last.text.end + range.end
          },
          syntax: {
            start: first.syntax.start + range.start - first.text.start,
            end: last.syntax.end - last.text.end + range.end
          }
        })
        textOffset += range.normalizedText.length
        continue
      }
      for (const segment of builder.segments) {
        const start = Math.max(range.start, segment.text.start)
        const end = Math.min(range.end, segment.text.end)
        if (start >= end) continue
        const delta = start - segment.text.start
        segments.push({
          text: { start: textOffset, end: textOffset + end - start },
          source: {
            start: segment.source.start + delta,
            end: segment.source.start + delta + end - start
          },
          syntax: {
            start: segment.syntax.start + delta,
            end: segment.syntax.start + delta + end - start
          }
        })
        textOffset += end - start
      }
    }
    const marks = new Map<MarkupMark, { start: number; end: number }>()
    let retainedOffset = 0
    for (const range of retained) {
      for (const [mark, marked] of builder.marks) {
        const start = Math.max(range.start, marked.start)
        const end = Math.min(range.end, marked.end)
        if (start >= end) continue
        const mapped = {
          start: retainedOffset + (range.normalizedText !== undefined ? 0 : start - range.start),
          end:
            retainedOffset +
            (range.normalizedText !== undefined ? range.normalizedText.length : end - range.start)
        }
        const previous = marks.get(mark)
        if (previous === undefined) marks.set(mark, mapped)
        else previous.end = mapped.end
      }
      retainedOffset +=
        range.normalizedText !== undefined ? range.normalizedText.length : range.end - range.start
    }
    builder.text = desired
    builder.segments = segments
    builder.marks = marks
    if (desired.length === 0) {
      if (
        builder.range.start === builder.range.end &&
        builder.range.end < builder.syntax.range.end
      ) {
        const source = projection.syntax.coordinates.toSource(builder.range.start, 'next')
        builder.emptyLiteralLineEnding = sourceText(Math.max(0, source - 2), source).match(
          /(?:\r\n|\r|\n)$/u
        )?.[0]
      }
      // The native body omits its final EOL; an empty caret stays before it.
      const position = emptyPosition ?? builder.range.start + retained[0].start
      builder.range = { start: position, end: position }
    }
  }
  const documentEndOffset = projection.syntax.coordinates.toSource(
    projection.syntax.ast.root.range.end,
    'next'
  )
  let parents: Map<MarkdownAstNode, MarkdownAstNode> | undefined
  const blockAncestors = (target: MarkdownAstNode): readonly MarkdownAstNode[] => {
    if (parents === undefined) {
      const map = new Map<MarkdownAstNode, MarkdownAstNode>()
      const stack = [projection.syntax.ast.root]
      for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
        for (const child of node.children) {
          map.set(child, node)
          stack.push(child)
        }
      }
      parents = map
    }
    const path: MarkdownAstNode[] = []
    for (let node: MarkdownAstNode | undefined = target; node !== undefined; node = parents.get(node)) {
      path.unshift(node)
    }
    return path[0] === projection.syntax.ast.root ? path : []
  }
  /**
   * Whether the parser gives the source line only to the block's own
   * containers — their quote and list markers — and to no other block.
   */
  const ownContainerLine = (start: number, end: number, block: MarkdownAstNode): boolean => {
    const from = projection.syntax.coordinates.toProjected(start, 'next')
    const to = projection.syntax.coordinates.toProjected(end, 'previous')
    const ancestors = new Set(blockAncestors(block))
    const onLine = (node: MarkdownAstNode) =>
      node.range.start <= to &&
      (node.range.end > from || (node.range.start === node.range.end && node.range.start >= from))
    const occupiedByOther = (node: MarkdownAstNode): boolean => {
      if (!ancestors.has(node)) return onLine(node)
      // Children are in source order; an empty child at `from` ends there.
      for (let index = firstNodeEndingAfter(node.children, from - 1); index < node.children.length; index += 1) {
        const child = node.children[index]
        if (child.range.start > to) break
        if (occupiedByOther(child)) return true
      }
      return false
    }
    return ancestors.size > 0 && !occupiedByOther(projection.syntax.ast.root)
  }
  const trailingLinePosition = (builder: (typeof builders)[number]): number | undefined => {
    if (builder.state.name === 'setext-heading') {
      return setextUnderlineStart(projection.syntax, builder.syntax, sourceText)
    }
    // Enter at the end of an HTML block or indented code adds its empty last
    // line, which ends the block in source until text is typed there.
    const literal =
      builder.state.name === 'html-block' ||
      (builder.state.name === 'code-block' &&
        builder.syntax.attributes.provider === 'indented-code')
    if (
      !literal &&
      (builder.state.name !== 'paragraph' ||
        !['paragraph', 'definition'].includes(builder.syntax.kind))
    ) {
      return undefined
    }
    let end = projection.syntax.coordinates.toSource(
      literal || builder.syntax.kind === 'definition'
        ? builder.range.end
        : builder.syntax.range.end,
      'next'
    )
    // A literal body's range includes its last line's ending.
    if (literal && sourceCharacter(end - 1) === '\n') {
      end -= sourceCharacter(end - 2) === '\r' ? 2 : 1
    } else if (literal && sourceCharacter(end - 1) === '\r') end -= 1
    const lineEnding = sourceText(end, end + 2).match(/^(?:\r\n|\r|\n)/u)?.[0]
    if (lineEnding === undefined) return undefined
    const lineStart = end + lineEnding.length
    let position = lineStart
    while (!['', '\r', '\n'].includes(sourceCharacter(position))) position += 1
    // A regional projection ends at its region; its owner decides whether
    // that is the document end.
    const lineEnded =
      sourceCharacter(position) !== '' ||
      (position === documentEndOffset &&
        (canonicalSource === undefined || position === canonicalSource.length))
    // The line is blank within the block's containers: the parser gives it
    // only to their quote markers and indentation.
    const blank =
      lineEnded &&
      (/^[ \t]*$/u.test(sourceText(lineStart, position)) ||
        ownContainerLine(lineStart, position, builder.syntax))
    return blank ? position : undefined
  }
  const trailingLines = builders.map(trailingLinePosition)
  const lineStartOf = (offset: number): number | undefined => {
    let start = offset
    for (;;) {
      if (start === 0) return 0
      const previous = sourceCharacter(start - 1)
      // A regional projection cannot see lines before its region.
      if (previous === '') return undefined
      if (previous === '\n' || previous === '\r') return start
      start -= 1
    }
  }
  const leadingLinePosition = (builder: (typeof builders)[number]): number | undefined => {
    if (builder.state.name === 'thematic-break') {
      return setextUnderlineLeadingLine(projection.syntax, builder.syntax, sourceText)
    }
    if (
      builder.state.name !== 'setext-heading' &&
      (builder.state.name !== 'paragraph' || builder.syntax.kind !== 'paragraph')
    ) {
      return undefined
    }
    // An empty paragraph's added line is its trailing line.
    if (builder.text === '' || builder.container?.kind === 'footnote-definition') return undefined
    const lineStart = lineStartOf(
      projection.syntax.coordinates.toSource(builder.syntax.range.start, 'previous')
    )
    if (lineStart === undefined || lineStart === 0) return undefined
    const end = lineStart - (sourceText(lineStart - 2, lineStart) === '\r\n' ? 2 : 1)
    const previousStart = lineStartOf(end)
    if (previousStart === undefined) return undefined
    const line = sourceText(previousStart, end)
    if (builder.container === undefined) return /^[ \t]*$/u.test(line) ? end : undefined
    // The line belongs to the paragraph's own innermost container: its quote
    // markers, or the marker line of the list item that holds the paragraph.
    const containerLine = lineStartOf(
      projection.syntax.coordinates.toSource(builder.container.range.start, 'next')
    )
    if (
      containerLine === undefined ||
      containerLine > previousStart ||
      !ownContainerLine(previousStart, end, builder.syntax)
    ) {
      return undefined
    }
    // An item's first paragraph after blank lines begins on the item's empty
    // marker line, where deleting the item's text leaves the caret.
    if (
      builder.container.kind === 'list-item' &&
      builder.container.children[0] === builder.syntax
    ) {
      let lineEnd = end
      let lineStart = previousStart
      while (lineStart > containerLine && ownContainerLine(lineStart, lineEnd, builder.syntax)) {
        lineEnd = lineStart - (sourceText(lineStart - 2, lineStart) === '\r\n' ? 2 : 1)
        const start = lineStartOf(lineEnd)
        if (start === undefined) return undefined
        lineStart = start
      }
      if (lineStart === containerLine && ownContainerLine(lineStart, lineEnd, builder.syntax)) {
        return lineEnd
      }
    }
    return end
  }
  const leadingLines = builders.map(leadingLinePosition)
  const blankLineText = (builder: (typeof builders)[number]): { blankLineText?: string } => {
    if (
      builder.text !== '' ||
      builder.container !== undefined ||
      builder.syntax.kind !== 'paragraph'
    ) {
      return {}
    }
    const start = projection.syntax.coordinates.toSource(builder.syntax.range.start, 'next')
    let end = start
    while (sourceCharacter(end) === ' ' || sourceCharacter(end) === '\t') end += 1
    return end > start && ['', '\r', '\n'].includes(sourceCharacter(end))
      ? { blankLineText: sourceText(start, end) }
      : {}
  }
  const leadingLineText = (
    builder: (typeof builders)[number],
    position: number
  ): { leadingLineText?: string } => {
    if (
      builder.syntax.kind !== 'paragraph' ||
      (builder.container !== undefined && builder.container.kind !== 'blockquote')
    ) {
      return {}
    }
    const start = lineStartOf(position)
    const first = projection.syntax.coordinates.toSource(builder.syntax.range.start, 'previous')
    const firstLine = lineStartOf(first)
    if (start === undefined || firstLine === undefined) return {}
    // The quote markers that begin the paragraph's first line also begin this one.
    const prefix = sourceText(firstLine, first)
    const line = sourceText(start, position)
    const text = line.startsWith(prefix) ? line.slice(prefix.length) : ''
    return /^[ \t]+$/u.test(text) ? { leadingLineText: text } : {}
  }
  const cellPadding = (cell: MarkdownAstNode): { tableCellPadding?: number } => {
    const { start, end } = tableCellContentRange(projection.syntax, cell)
    if (start === end || typeof cell.attributes.cellEnd !== 'number') return {}
    const padding = sourceText(
      end,
      projection.syntax.coordinates.toSource(cell.attributes.cellEnd, 'next')
    )
    return /^ +$/u.test(padding) ? { tableCellPadding: padding.length } : {}
  }
  const unsnappedBindings = builders.map(
    (builder, index): MuyaMarkupBinding => ({
      path: builder.path,
      text: builder.text,
      segments: builder.segments,
      syntax: builder.syntax,
      ...(tableCells.has(JSON.stringify(builder.path))
        ? {
          tableCell: tableCells.get(JSON.stringify(builder.path)),
          tableCellContent: tableCellContentRange(projection.syntax, builder.syntax),
          ...cellPadding(builder.syntax)
        }
        : {}),
      ...(builder.emptyLiteralLineEnding === undefined
        ? {}
        : { emptyLiteralLineEnding: builder.emptyLiteralLineEnding }),
      ...(continuations.has(JSON.stringify(builder.path))
        ? { listContinuation: continuations.get(JSON.stringify(builder.path)) }
        : {}),
      ...blankLineText(builder),
      ...(markerLines.has(JSON.stringify(builder.path))
        ? { markerLine: markerLines.get(JSON.stringify(builder.path)) }
        : {}),
      ...(trailingLines[index] === undefined ? {} : { trailingLinePosition: trailingLines[index] }),
      ...(leadingLines[index] === undefined
        ? {}
        : {
          leadingLinePosition: leadingLines[index],
          ...leadingLineText(builder, leadingLines[index])
        }),
      sourceRange: {
        start:
          builder.segments[0]?.source.start ??
          projection.syntax.coordinates.toSource(builder.range.start, 'next'),
        end:
          builder.segments.at(-1)?.source.end ??
          projection.syntax.coordinates.toSource(builder.range.end, 'next')
      }
    })
  )
  const leavesOf = new Map<MarkdownAstNode, readonly MarkdownAstNode[]>()
  const bindings = unsnappedBindings.map((binding): MuyaMarkupBinding => {
    const snaps = muyaCaretSnaps(binding, sourceCharacter, projection.syntax.coordinates, leavesOf)
    return snaps.length === 0 ? binding : { ...binding, caretSnaps: snaps }
  })
  // Each editable widget field is a typed binding to its parser-owned value.
  // Retain the existing body bindings and add the fence's distinct info field.
  const infoBindings = new Map<MuyaMarkupPath, MuyaMarkupBinding>()
  for (const builder of builders) {
    const { infoStart, infoEnd, infoInputValue } = builder.syntax.attributes
    if (
      builder.state.name !== 'code-block' ||
      builder.syntax.attributes.provider !== 'fenced-code' ||
      typeof infoStart !== 'number' ||
      typeof infoEnd !== 'number' ||
      typeof infoInputValue !== 'string'
    ) {
      continue
    }
    const segments: MuyaMarkupSourceSegment[] = []
    let syntaxOffset = infoStart
    let textOffset = 0
    const append = (end: number, value?: string) => {
      const length = value?.length ?? end - syntaxOffset
      segments.push({
        text: { start: textOffset, end: textOffset + length },
        syntax: { start: syntaxOffset, end },
        source: {
          start: projection.syntax.coordinates.toSource(syntaxOffset, 'next'),
          end: projection.syntax.coordinates.toSource(end, 'previous')
        }
      })
      textOffset += length
      syntaxOffset = end
    }
    for (const spelling of builder.syntax.semanticTextSegments ?? []) {
      if (syntaxOffset < spelling.range.start) append(spelling.range.start)
      append(spelling.range.end, spelling.value)
    }
    if (syntaxOffset < infoEnd || segments.length === 0) append(infoEnd)
    infoBindings.set(builder.path, {
      path: [...builder.path.slice(0, -1), 'meta', 'lang'],
      syntax: builder.syntax,
      text: infoInputValue,
      segments,
      sourceRange: {
        start: projection.syntax.coordinates.toSource(infoStart, 'next'),
        end: projection.syntax.coordinates.toSource(infoEnd, 'previous')
      }
    })
  }
  const visibleAnnotations: CriticMarkupAnnotation[] = []
  const annotationQueue = [...annotations].reverse()
  while (annotationQueue.length > 0) {
    const annotation = annotationQueue.pop()
    if (annotation === undefined) break
    visibleAnnotations.push(annotation)
    if (annotation.kind !== 'comment') {
      for (const arm of annotation.arms) annotationQueue.push(...[...arm.annotations].reverse())
    }
  }
  const visiblePoint = (source: number): { binding: MuyaMarkupBinding; offset: number } => {
    const position = projection.syntax.coordinates.toProjected(source, 'previous')
    let index = builders.findIndex((builder) => position <= builder.range.end)
    if (index === -1) index = builders.length - 1
    const binding = bindings[index]
    let offset = 0
    for (const segment of binding.segments) {
      if (segment.source.start >= source) break
      offset =
        segment.text.start +
        Math.min(segment.text.end - segment.text.start, source - segment.source.start)
    }
    return { binding, offset }
  }
  const decorations: MuyaMarkupDecoration[] = marksInOrder.flatMap((mark) => {
    const ranges = builders.flatMap((builder) => {
      const range = builder.marks.get(mark)
      return range === undefined ? [] : [{ path: builder.path, range, mark }]
    })
    const annotation = visibleAnnotations.find(
      (item) =>
        item.kind === mark.kind &&
        item.range.start === mark.annotationRange.start &&
        item.range.end === mark.annotationRange.end
    )
    const arm = annotation?.arms.find(
      (item) => item.name === (mark.kind === 'substitution' ? mark.arm : 'content')
    )
    if (arm === undefined) return ranges
    // A wholly empty rendered structure has no marked text span to expose
    // its annotation's exterior edges. Retain those owned boundaries too.
    const positions =
      ranges.length === 0 && arm.range.start < arm.range.end
        ? [mark.annotationRange.start, arm.range.start, arm.range.end, mark.annotationRange.end]
        : [arm.range.start, arm.range.end]
    const boundaries = [...new Set(positions)].flatMap((sourcePosition) => {
      if (
        bindings.some((binding) =>
          binding.segments.some(
            (segment) =>
              segment.source.start <= sourcePosition && sourcePosition <= segment.source.end
          )
        )
      ) {
        return []
      }
      const { binding, offset } = visiblePoint(sourcePosition)
      const final =
        sourcePosition === arm.range.end &&
        annotation?.arms.every((other) => other.range.end <= arm.range.end) === true
      return [{
        path: binding.path,
        range: { start: offset, end: offset },
        mark,
        sourcePosition,
        ...(final ? { exteriorEnd: mark.annotationRange.end } : {})
      }]
    })
    return [...ranges, ...boundaries]
  })
  const comments: MuyaMarkupComment[] = []
  for (const annotation of visibleAnnotations) {
    if (annotation.kind !== 'comment') continue
    const { binding, offset } = visiblePoint(annotation.range.start)
    const text = commentText?.(annotation)
    comments.push({
      annotationRange: annotation.range,
      path: binding.path,
      offset,
      ...(text === undefined ? {} : { text })
    })
  }
  for (const builder of builders) builder.state.text = builder.text
  const annotationPaths = new Set([
    ...decorations.map((item) => JSON.stringify(item.path)),
    ...comments.map((item) => JSON.stringify(item.path))
  ])
  const outerBlocks = new Map<
    number,
    Readonly<{ range: SourceRange; source: string; followingSource?: string }>
  >()
  const paragraphPrefixes = new Map<number, number>()
  const containerPrefixes = new Map<number, Readonly<{ range: SourceRange; source: string }>>()
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    const range = {
      start: projection.syntax.coordinates.toSource(block.range.start, 'next'),
      end: projection.syntax.coordinates.toSource(block.range.end, 'previous')
    }
    if (block.kind === 'blockquote' || block.kind === 'list') {
      const leaves = builders.filter((builder) => builder.path[0] === index)
      const leaf = leaves[0]
      if (leaves.length === 1 && leaf.syntax.kind === 'paragraph') {
        const prefixRange = {
          start: range.start,
          end: projection.syntax.coordinates.toSource(leaf.range.start, 'previous')
        }
        const prefix = sourceText(prefixRange.start, prefixRange.end)
        if (
          prefix.length > 0 &&
          prefix.length === prefixRange.end - prefixRange.start &&
          !/[\r\n]/u.test(prefix)
        ) {
          containerPrefixes.set(index, { range: prefixRange, source: prefix })
        }
      }
    }
    if (block.kind === 'paragraph') {
      const position = paragraphPrefixPosition(annotations, range)
      if (position !== undefined) paragraphPrefixes.set(index, position)
    }
    if (
      visibleAnnotations.some(
        (annotation) => annotation.range.start < range.end && annotation.range.end > range.start
      )
    ) {
      continue
    }
    const source = sourceText(range.start, range.end)
    if (source.length === range.end - range.start) {
      const followingEnd =
        blocks[index + 1] === undefined && following !== undefined
          ? following.blockStart
          : projection.syntax.coordinates.toSource(
            blocks[index + 1]?.range.start ?? projection.syntax.ast.root.range.end,
            'previous'
          )
      const followingSource = sourceText(range.end, followingEnd)
      outerBlocks.set(index, {
        range,
        source,
        ...(followingSource.length === followingEnd - range.end &&
        /^[\t \r\n]*$/u.test(followingSource)
          ? { followingSource }
          : {})
      })
    }
  }
  const endOffset = documentEndOffset
  let suffixStart = endOffset
  while (suffixStart > 0 && /[\r\n]/u.test(sourceCharacter(suffixStart - 1))) suffixStart -= 1
  const trailingLineEndings = sourceText(suffixStart, endOffset)
  const lineEnding =
    [...sourceEvents]
      .reverse()
      .find((event) => /[\r\n]/u.test(event.text))
      ?.text.match(/\r\n|\r|\n/gu)
      ?.at(-1) ?? '\n'
  const documentEnd = { offset: endOffset, trailingLineEndings, lineEnding }
  const sourceStructures = new Map<number, MuyaSourceStructure>()
  if (canonicalSource !== undefined) {
    for (const [index, block] of blocks.entries()) {
      if (!['table', 'list', 'blockquote'].includes(block.kind)) continue
      const nodes = sourceNodes.filter((node) => node.path[0] === index)
      const range = nodes[0].range
      sourceStructures.set(index, {
        range,
        source: canonicalSource.slice(range.start, range.end),
        nodes
      })
    }
  }
  const orderedBindings = builders.flatMap((builder, index) => {
    const body = bindings[index]
    const info = infoBindings.get(builder.path)
    return info === undefined ? [body] : [body, info]
  })
  const structuralOwners = new Set<number>()
  return {
    kind: 'view',
    markdown: projection.events
      .flatMap((event) => (event.kind === 'text' ? [event.text] : []))
      .join(''),
    markdownSegments,
    state,
    bindings: orderedBindings.map((binding, bindingIndex) => {
      const index = binding.path[0] as number
      const outerBlock = structuralOwners.has(index) ? undefined : outerBlocks.get(index)
      const sourceStructure = structuralOwners.has(index) ? undefined : sourceStructures.get(index)
      structuralOwners.add(index)
      return {
        ...binding,
        ...(bindingIndex === orderedBindings.length - 1 ? { documentEnd } : {}),
        ...(paragraphPrefixes.has(index)
          ? { paragraphPrefixPosition: paragraphPrefixes.get(index) }
          : {}),
        ...(containerPrefixes.has(index) ? { containerPrefix: containerPrefixes.get(index) } : {}),
        ...(annotationPaths.has(JSON.stringify(binding.path))
          ? { annotationContext: true as const }
          : {}),
        ...(outerBlock === undefined ? {} : { outerBlock }),
        ...(sourceStructure === undefined ? {} : { sourceStructure })
      }
    }),
    decorations,
    comments
  }
}

/** The first of `nodes`, in source order, that ends after `position`. */
function firstNodeEndingAfter(nodes: readonly MarkdownAstNode[], position: number): number {
  let low = 0
  let high = nodes.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (nodes[middle].range.end > position) high = middle
    else low = middle + 1
  }
  return low
}

/**
 * A binding's caret snaps (see `MuyaMarkupBinding.caretSnaps`), read from the
 * source by `sourceCharacter`. With `lineStarts`, only the lines starting at
 * those text offsets are read, which is all a patch of some lines of a
 * literal block needs; `leavesOf` caches each block's leaves.
 */
export function muyaCaretSnaps(
  binding: MuyaMarkupBinding,
  sourceCharacter: (offset: number) => string,
  coordinates: MarkupProjection['syntax']['coordinates'],
  leavesOf: Map<MarkdownAstNode, readonly MarkdownAstNode[]>,
  lineStartsWithin?: SourceRange
): MuyaCaretSnap[] {
  const whitespaceBefore = (position: number): MuyaCaretSnap | undefined => {
    let from = position
    while (from > 0 && (sourceCharacter(from - 1) === ' ' || sourceCharacter(from - 1) === '\t')) {
      from -= 1
    }
    return from < position ? { from, to: position, at: position } : undefined
  }
  /**
   * A later line's container prefix, shown at that line's start: the source
   * the parser leaves between the line break and the block's next inline node.
   */
  const prefixAfter = (block: MarkdownAstNode, lineStart: number): MuyaCaretSnap | undefined => {
    let leaves = leavesOf.get(block)
    if (leaves === undefined) {
      const collected: MarkdownAstNode[] = []
      const collect = (node: MarkdownAstNode) => {
        if (node.children.length === 0) collected.push(node)
        else node.children.forEach(collect)
      }
      block.children.forEach(collect)
      leaves = collected
      leavesOf.set(block, leaves)
    }
    const projected = coordinates.toProjected(lineStart, 'next')
    // An empty text node marks where an empty line's text would begin.
    let index = firstNodeEndingAfter(leaves, projected - 1)
    while (index < leaves.length && leaves[index].range.start < projected && leaves[index].range.end === projected) {
      index += 1
    }
    const next = leaves[index]
    const textStart = Math.min(next?.range.start ?? block.range.end, block.range.end)
    let end = coordinates.toSource(Math.max(projected, textStart), 'previous')
    // A prefix never continues past its own line.
    for (let position = lineStart; position < end; position += 1) {
      if (sourceCharacter(position) === '\n' || sourceCharacter(position) === '\r') end = position
    }
    return end > lineStart ? { from: lineStart + 1, to: end + 1, at: lineStart } : undefined
  }
  const lineBreaks = [...binding.text.matchAll(/\r\n|\r|\n/gu)].filter((match) => lineStartsWithin === undefined ||
    match.index + match[0].length >= lineStartsWithin.start && match.index + match[0].length < lineStartsWithin.end)
  // Each later line's text starts after its container continuation.
  const lineStarts = lineBreaks.flatMap((match) => {
    const offset = match.index + match[0].length
    const segment = segmentHolding(binding.segments, offset, false)
    return segment === undefined ? [] : [segment.source.start + offset - segment.text.start]
  })
  // The source just after each line break, before that line's prefix.
  const lineBreakEnds = lineBreaks.flatMap((match) => {
    const offset = match.index + match[0].length
    const segment = segmentHolding(binding.segments, offset, true)
    return segment === undefined ||
      segment.source.end - segment.source.start !== segment.text.end - segment.text.start
      ? []
      : [segment.source.start + offset - segment.text.start]
  })
  const inSegment = sourceCover(binding.segments)
  const bounds = lineStartsWithin === undefined
    ? [binding.sourceRange.start, ...lineStarts, binding.trailingLinePosition, binding.leadingLinePosition]
    : lineStartsWithin.start === 0 ? [binding.sourceRange.start, ...lineStarts] : lineStarts
  return [
    ...bounds.flatMap((position) => (position === undefined ? [] : [whitespaceBefore(position)])),
    ...lineBreakEnds
      .filter((position) => !inSegment(position))
      .map((position) => prefixAfter(binding.syntax, position))
  ].filter((snap): snap is MuyaCaretSnap => snap !== undefined)
}
