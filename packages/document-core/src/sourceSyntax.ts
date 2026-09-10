import type {
  CommentProjection,
  CriticMarkupAnnotation,
  CriticMarkupKind,
  MarkdownAstNode,
  MarkdownNodeKind,
  MarkupProjection,
  MarkupCoordinateSegment,
  ProjectionCoordinateMap,
  SourceRange
} from './documentCore.js'

/** A source presentation span, derived from the revision's owned language syntax. */
export interface DocumentSourceSyntaxSpan {
  readonly kind: MarkdownNodeKind | CriticMarkupKind
  readonly range: SourceRange
  /** Parser-owned heading depth; syntax coordinates remain canonical ranges above. */
  readonly headingLevel?: number
  /** Exact owned literal payload; embedded-language coloring never recognizes Markdown. */
  readonly literal?: Readonly<{ readonly language: string; readonly range: SourceRange }>
}

/** Translate only retained source runs, coalescing adjacent pieces of one syntax node. */
function mappedRanges(range: SourceRange, segments: readonly MarkupCoordinateSegment[]): readonly SourceRange[] {
  let low = 0
  let high: number = segments.length
  while (low < high) {
    const middle = (low + high) >>> 1
    const segment = segments[middle]
    if (segment === undefined) throw new Error('Source syntax coordinate index is invalid')
    if (segment.projected.end <= range.start) low = middle + 1
    else high = middle
  }
  const ranges: SourceRange[] = []
  for (let index = low; index < segments.length; index += 1) {
    const segment = segments[index]
    if (segment === undefined || segment.projected.start >= range.end) break
    const start = segment.source.start + Math.max(range.start, segment.projected.start) - segment.projected.start
    const end = segment.source.start + Math.min(range.end, segment.projected.end) - segment.projected.start
    const previous = ranges.at(-1)
    if (previous?.end === start) ranges[ranges.length - 1] = Object.freeze({ start: previous.start, end })
    else if (end > start) ranges.push(Object.freeze({ start, end }))
  }
  return ranges
}

/** Maps existing syntax; it never recognizes authored text or generates syntax. */
export function sourceSyntaxSpans(
  markup: MarkupProjection,
  annotations: readonly CriticMarkupAnnotation[],
  commentProjection: (comment: CriticMarkupAnnotation) => CommentProjection
): readonly DocumentSourceSyntaxSpan[] {
  const spans: DocumentSourceSyntaxSpan[] = []
  const append = (kind: DocumentSourceSyntaxSpan['kind'], range: SourceRange, headingLevel?: number, literal?: DocumentSourceSyntaxSpan['literal']) => {
    if (range.end > range.start) spans.push(Object.freeze({ kind, range: Object.freeze(range), ...(headingLevel === undefined ? {} : { headingLevel }), ...(literal === undefined ? {} : { literal }) }))
  }
  const syntax = (root: MarkdownAstNode, coordinates: ProjectionCoordinateMap) => {
    const segments = coordinates.sourceSegments
    if (segments === undefined) throw new Error('Source syntax requires owned coordinate runs')
    const pending = [root]
    while (pending.length > 0) {
      const node = pending.pop()
      if (node === undefined) break
      if (!['document', 'paragraph', 'text', 'soft-break', 'hard-break', 'table-row', 'table-cell'].includes(node.kind)) {
        const contentStart = node.attributes.contentStart
        const contentEnd = node.attributes.contentEnd
        const math = node.kind === 'inline-math' || node.kind === 'math-block'
        const info = node.attributes.semanticInfo ?? node.attributes.info
        const language = math ? 'stex' : node.kind === 'code-block' && typeof info === 'string' ? info.trim().split(/\s+/u)[0] : undefined
        const bodies = language && typeof contentStart === 'number' && typeof contentEnd === 'number'
          ? mappedRanges({ start: contentStart, end: contentEnd }, segments)
          : []
        for (const range of mappedRanges(node.range, segments)) {
          const body = bodies.find(body => body.start >= range.start && body.end <= range.end)
          const literal = language && body ? Object.freeze({ language, range: body }) : undefined
          append(node.kind, range, typeof node.attributes.level === 'number' ? node.attributes.level : undefined, literal)
        }
      }
      for (const child of [...node.children].reverse()) pending.push(child)
    }
  }
  syntax(markup.syntax.ast.root, markup.syntax.coordinates)
  const pending = [...annotations].reverse()
  while (pending.length > 0) {
    const annotation = pending.pop()
    if (annotation === undefined) break
    append(annotation.kind, annotation.range)
    if (annotation.kind === 'comment') {
      const projection = commentProjection(annotation)
      syntax(projection.ast.root, projection.coordinates)
    }
    for (const arm of [...annotation.arms].reverse()) {
      for (const child of [...arm.annotations].reverse()) pending.push(child)
    }
  }
  return Object.freeze(spans.sort((a, b) => a.range.start - b.range.start || b.range.end - a.range.end))
}
