import { createHeadingIdAllocator } from '@muyajs/core'
import {
  tocEntryOf,
  type DocumentConsumerProjection
} from '../documentConsumers/documentProjectionConsumers'
import {
  projectedHeadingNodes,
  type ProjectedHeadingNode
} from '../documentConsumers/projectedHeadings'
import type { MuyaMarkupView } from './muyaMarkupView'

/** Join outline semantics to native identity through canonical source, not ordinal position. */
export const createCoreHeadingToc = (
  projection: DocumentConsumerProjection,
  view?: MuyaMarkupView
) => coreHeadingToc(projectedHeadingNodes(projection), view)

/** The outline of a document's headings in projection order. */
export const coreHeadingToc = (
  headingNodes: readonly ProjectedHeadingNode[],
  view?: MuyaMarkupView
) => {
  const headings = view?.bindings.filter((binding) => binding.syntax.kind === 'heading') ?? []
  const allocateId = createHeadingIdAllocator()
  return headingNodes.map((heading, index) => {
    const entry = tocEntryOf(heading)
    const ranges = heading.sourceRanges
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
