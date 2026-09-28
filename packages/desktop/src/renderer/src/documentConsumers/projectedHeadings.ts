import type {
  MarkdownAst,
  MarkdownAstNode,
  MarkupCoordinateSegment,
  SourceRange
} from '@marktext/document-core'

/** A heading of a Markdown projection, located in that projection and in canonical source. */
export interface ProjectedHeadingNode {
  /** The heading's syntax; its positions are in the projection it came from. */
  readonly node: MarkdownAstNode
  /** An ATX heading's text as the projection's Markdown spells it, inline syntax included. */
  readonly source?: string
  /** The canonical source the heading's projected text is retained from. */
  readonly sourceRanges: readonly SourceRange[]
}

/**
 * The headings of a projection in projection order, or of those that start in
 * `span`. `sourceDelta` moves their source ranges, for a projection of an
 * earlier revision whose text has since moved.
 */
export function projectedHeadingNodes(
  projection: Readonly<{
    readonly markdown: string
    readonly ast: MarkdownAst
    readonly sourceSegments?: readonly MarkupCoordinateSegment[]
  }>,
  span?: SourceRange,
  sourceDelta = 0
): ProjectedHeadingNode[] {
  const segments = projection.sourceSegments ?? []
  const sourceRangesOf = (range: SourceRange): SourceRange[] => {
    // Segments are in projection order; start at the first that ends after the node starts.
    let low = 0
    let high = segments.length
    while (low < high) {
      const middle = (low + high) >> 1
      if ((segments[middle]?.projected.end ?? 0) <= range.start) low = middle + 1
      else high = middle
    }
    const ranges: SourceRange[] = []
    for (let segment = segments[low]; segment !== undefined; segment = segments[++low]) {
      if (segment.projected.start >= range.end) break
      const start = Math.max(segment.projected.start, range.start)
      const end = Math.min(segment.projected.end, range.end)
      if (start < end) {
        ranges.push(Object.freeze({
          start: segment.source.start + start - segment.projected.start + sourceDelta,
          end: segment.source.start + end - segment.projected.start + sourceDelta
        }))
      }
    }
    return ranges
  }
  const headings: ProjectedHeadingNode[] = []
  const visit = (node: MarkdownAstNode): void => {
    if (node.kind === 'heading') {
      const { contentStart, contentEnd, style } = node.attributes
      const source =
        style !== 'setext' && typeof contentStart === 'number' && typeof contentEnd === 'number'
          ? projection.markdown.slice(contentStart, contentEnd).trim()
          : ''
      headings.push(Object.freeze({
        node,
        ...(source === '' ? {} : { source }),
        sourceRanges: Object.freeze(sourceRangesOf(node.range))
      }))
    }
    for (const child of node.children) visit(child)
  }
  const roots = projection.ast.root.children
  if (span === undefined) {
    roots.forEach(visit)
    return headings
  }
  let low = 0
  let high = roots.length
  while (low < high) {
    const middle = (low + high) >> 1
    if ((roots[middle]?.range.start ?? 0) < span.start) low = middle + 1
    else high = middle
  }
  for (let root = roots[low]; root !== undefined && root.range.start < span.end; root = roots[++low]) {
    visit(root)
  }
  return headings
}
