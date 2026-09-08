import type { MarkdownAstNode } from '@marktext/document-core'
import { createHeadingIdAllocator } from '@muyajs/core'
import {
  tocProjectedDocument,
  type DocumentConsumerProjection
} from '../documentConsumers/documentProjectionConsumers'
import type { MuyaMarkupView } from './muyaMarkupView'

/** Join outline semantics to native identity through canonical source, not ordinal position. */
export const createCoreHeadingToc = (
  projection: DocumentConsumerProjection,
  view?: MuyaMarkupView
) => {
  const nodes: MarkdownAstNode[] = []
  const visit = (node: MarkdownAstNode): void => {
    if (node.kind === 'heading') nodes.push(node)
    node.children.forEach(visit)
  }
  visit(projection.ast.root)
  const headings = view?.bindings.filter((binding) => binding.syntax.kind === 'heading') ?? []
  const allocateId = createHeadingIdAllocator()
  return tocProjectedDocument(projection).map((entry, index) => {
    const node = nodes[index]
    const ranges = (projection.sourceSegments ?? []).flatMap((segment) => {
      const start = Math.max(segment.projected.start, node.range.start)
      const end = Math.min(segment.projected.end, node.range.end)
      return start < end
        ? [
          {
            start: segment.source.start + start - segment.projected.start,
            end: segment.source.start + end - segment.projected.start
          }
        ]
        : []
    })
    const binding = headings.find((candidate) =>
      ranges.some(
        (range) =>
          range.start < candidate.sourceRange.end && range.end > candidate.sourceRange.start
      )
    )
    return {
      ...entry,
      sourceOffset: ranges[0]?.start,
      githubSlug: allocateId(entry.content),
      slug: `core-heading-${ranges[0]?.start ?? index}`,
      ...(binding === undefined ? {} : { nativePath: binding.path.slice(0, -1) })
    }
  })
}
