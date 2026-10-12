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
  // Bindings before `skipped` end before every range of the headings that
  // follow in source order, so no later heading can match them.
  let skipped = 0
  let previousStart = 0
  const bindingOf = (ranges: ProjectedHeadingNode['sourceRanges']) => {
    if (ranges.length === 0) return undefined
    const start = Math.min(...ranges.map((range) => range.start))
    if (start < previousStart) skipped = 0
    previousStart = start
    while (skipped < headings.length && headings[skipped].sourceRange.end <= start) skipped += 1
    for (let index = skipped; index < headings.length; index += 1) {
      const candidate = headings[index]
      if (
        ranges.some(
          (range) =>
            range.start < candidate.sourceRange.end && range.end > candidate.sourceRange.start
        )
      ) {
        return candidate
      }
    }
    return undefined
  }
  return headingNodes.map((heading, index) => {
    const entry = tocEntryOf(heading)
    const ranges = heading.sourceRanges
    const binding = bindingOf(ranges)
    return {
      ...entry,
      sourceOffset: ranges[0]?.start,
      githubSlug: allocateId(entry.content),
      slug: `core-heading-${ranges[0]?.start ?? index}`,
      ...(binding === undefined ? {} : { nativePath: binding.path.slice(0, -1) })
    }
  })
}
