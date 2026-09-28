import type {
  MarkupCoordinateSegment,
  MarkupRegionProjectionChange,
  MarkupRegionReplacement,
  ProjectionAffinity,
  ProjectionCoordinateMap,
  SourceRange
} from '@marktext/document-core'
import {
  appendMuyaMarkdownSegment,
  createMuyaMarkupView,
  type MuyaMarkdownSegment,
  type MuyaMarkupBinding,
  type MuyaMarkupView
} from './muyaMarkupView'
import {
  createMuyaMarkupRootRun,
  createRunMuyaMarkupView,
  muyaMarkupRootsFor,
  type MuyaMarkupRootRun,
  type MuyaMarkupRoots
} from './muyaMarkupViewRoots'

/** A regional reply carries only canonical runs; gaps are omitted/generated text. */
export const markupRegionCoordinates = (replacement: MarkupRegionReplacement): ProjectionCoordinateMap => {
  const runs = replacement.coordinates
  const position = (
    offset: number,
    from: 'source' | 'projected',
    affinity: ProjectionAffinity
  ): number => {
    const to = from === 'source' ? 'projected' : 'source'
    let low = 0
    let high = runs.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (
        runs[middle][from].end < offset ||
        (affinity === 'next' && runs[middle][from].end === offset)
      ) {
        low = middle + 1
      } else high = middle
    }
    const next = runs[low]
    if (next !== undefined && next[from].start <= offset) {
      return next[to].start + offset - next[from].start
    }
    const previous = runs[low - 1]
    if (affinity === 'previous') {
      return (
        previous?.[to].end ??
        next?.[to].start ??
        replacement.next[to === 'source' ? 'source' : 'syntax'].start
      )
    }
    return (
      next?.[to].start ??
      previous?.[to].end ??
      replacement.next[to === 'source' ? 'source' : 'syntax'].end
    )
  }
  return {
    sourceSegments: runs,
    toSource: (offset, affinity) => position(offset, 'projected', affinity),
    toProjected: (offset, affinity) => position(offset, 'source', affinity),
    intersectsSource: (range) =>
      range.start < range.end &&
      runs.some((run) => run.source.start < range.end && run.source.end > range.start),
    originAt: (offset) => {
      const run = runs.find((run) => run.projected.start <= offset && run.projected.end > offset)
      return run === undefined
        ? {
          kind: 'generated',
          sourcePosition: position(offset, 'projected', 'next'),
          affinity: 'next'
        }
        : { kind: 'source', sourceOffset: run.source.start + offset - run.projected.start }
    }
  }
}

// Refuse missing Comment content rather than silently dropping its anchor.
// Text plus the delimiters of balanced visible marks must cover the source.
const completeSourceCoverage = (replacement: MarkupRegionReplacement): boolean => {
  const covered: SourceRange[] = []
  const active: Array<{
    mark: Extract<MarkupRegionReplacement['events'][number], { kind: 'enter' }>['mark']
    end: number
  }> = []
  for (const event of replacement.events) {
    if (event.kind === 'text') {
      if (event.text.length !== event.sourceRange.end - event.sourceRange.start) return false
      covered.push(event.sourceRange)
      for (const owner of active) owner.end = event.sourceRange.end
    } else if (event.kind === 'enter') {
      const range = event.mark.annotationRange
      covered.push(
        { start: range.start, end: range.start + 3 },
        { start: range.end - 3, end: range.end }
      )
      active.push({ mark: event.mark, end: range.start + 3 })
    } else {
      const owner = active.pop()
      if (owner?.mark !== event.mark || owner.end === owner.mark.annotationRange.start + 3) {
        return false
      }
      if (event.mark.kind === 'substitution' && event.mark.arm === 'old') {
        covered.push({ start: owner.end, end: owner.end + 2 })
      }
      for (const parent of active) parent.end = event.mark.annotationRange.end
    }
  }
  if (active.length > 0) return false
  covered.sort((left, right) => left.start - right.start)
  let cursor = replacement.next.source.start
  for (const range of covered) {
    if (range.start > cursor) return false
    cursor = Math.max(cursor, range.end)
  }
  return cursor === replacement.next.source.end
}

/** Read paragraph positions from the detached common projection coordinates. */
const markdownOffsets = (
  view: MuyaMarkupView
): ((syntax: number) => number | undefined) | undefined => {
  if (view.markdownSegments.length === 0) return undefined
  return (syntax) => {
    let previous: MuyaMarkdownSegment | undefined
    for (const next of view.markdownSegments) {
      if (syntax < next.syntax.start) {
        return previous?.text.end === next.text.start ? next.text.start : undefined
      }
      if (syntax <= next.syntax.end) return next.text.start + syntax - next.syntax.start
      previous = next
    }
    return undefined
  }
}

/** Root ranges an applied change replaced, for consumers that update in place. */
export interface MuyaMarkupViewPatch {
  readonly previous: MuyaMarkupView
  /** Roots `[start, previousEnd)` of `previous` are roots `[start, nextEnd)` of the view. */
  readonly start: number
  readonly previousEnd: number
  readonly nextEnd: number
}
const patches = new WeakMap<MuyaMarkupView, MuyaMarkupViewPatch>()

/** The roots a regional change replaced to make `view`, if it was made that way. */
export const muyaMarkupViewPatch = (view: MuyaMarkupView): MuyaMarkupViewPatch | undefined =>
  patches.get(view)

const validCoordinates = (coordinates: readonly MarkupCoordinateSegment[]): boolean =>
  coordinates.length > 0 &&
  coordinates.every(
    (segment, index) =>
      segment.projected.end - segment.projected.start ===
        segment.source.end - segment.source.start &&
      segment.projected.end >= segment.projected.start &&
      (index === 0 ||
        (segment.projected.start >= coordinates[index - 1].projected.end &&
          segment.source.start >= coordinates[index - 1].source.end))
  )

/**
 * The first binding, in view order, that ends after editing-syntax position
 * `position` or is empty at or after it.
 */
function firstBindingReaching(
  roots: MuyaMarkupRoots,
  position: number
): MuyaMarkupBinding | undefined {
  // A binding found here ends at or after `position`, so its root's syntax
  // reaches it.
  for (const root of roots.syntaxRoots(position, Infinity)) {
    const binding = roots
      .items(root)
      .bindings.find(
        (item) =>
          item.syntax.range.end > position ||
          (item.text.length === 0 && item.syntax.range.start >= position)
      )
    if (binding !== undefined) return binding
  }
  return undefined
}

function lastBinding(roots: MuyaMarkupRoots): MuyaMarkupBinding | undefined {
  for (let root = roots.count - 1; root >= 0; root -= 1) {
    const binding = roots.items(root).bindings.at(-1)
    if (binding !== undefined) return binding
  }
  return undefined
}

/**
 * Consume portable Core regions replacing top-level paragraphs. Untouched block shapes
 * retain their native state and mapped leaves. Changed structural blocks,
 * missing comment inventory, or ambiguous ranges request the full-view fallback.
 * Retained state objects are reused; only changed regions visit the view builder.
 * Retained roots keep their items unmoved until read (see `muyaMarkupViewRoots`),
 * so apart from copying the root state list the work follows the regions.
 */
export function applyMuyaMarkupChanges(
  previous: MuyaMarkupView,
  change: MarkupRegionProjectionChange
): MuyaMarkupView | undefined {
  if (change.replacements.length === 0) return previous
  const roots = muyaMarkupRootsFor(previous)
  if (roots === undefined) return undefined
  const offset = markdownOffsets(previous)
  if (offset === undefined) return undefined
  const replacements = [...change.replacements].sort(
    (left, right) => left.previous.syntax.start - right.previous.syntax.start
  )
  const state: MuyaMarkupView['state'][number][] = []
  const runs: MuyaMarkupRootRun[] = []
  const markdown: string[] = []
  const markdownSegments: MuyaMarkdownSegment[] = []
  let previousIndex = 0
  let replacedStart: number | undefined
  let replacedEnd = 0
  let markdownIndex = 0
  let sourceDelta = 0
  let syntaxDelta = 0
  let markdownLength = 0
  const appendMarkdown = (
    view: MuyaMarkupView,
    start: number,
    end: number,
    shift: number
  ): void => {
    markdown.push(view.markdown.slice(start, end))
    for (const segment of view.markdownSegments) {
      const from = Math.max(start, segment.text.start)
      const to = Math.min(end, segment.text.end)
      if (from >= to) continue
      appendMuyaMarkdownSegment(markdownSegments, {
        syntax: {
          start: segment.syntax.start + from - segment.text.start + shift,
          end: segment.syntax.start + to - segment.text.start + shift
        },
        text: { start: markdownLength + from - start, end: markdownLength + to - start }
      })
    }
    markdownLength += end - start
  }
  const retainUntil = (end: number): void => {
    runs.push(...roots.moved(previousIndex, end, state.length, sourceDelta, syntaxDelta))
    for (; previousIndex < end; previousIndex += 1) state.push(previous.state[previousIndex])
  }
  for (const replacement of replacements) {
    if (
      replacement.next.source.start !== replacement.previous.source.start + sourceDelta ||
      replacement.next.syntax.start !== replacement.previous.syntax.start + syntaxDelta
    ) {
      return undefined
    }
    if (
      replacement.syntaxBlocks.some((node) => node.kind !== 'paragraph') ||
      replacement.syntaxBlocks.length === 0 ||
      !validCoordinates(replacement.coordinates) ||
      !completeSourceCoverage(replacement)
    ) {
      return undefined
    }
    const firstBinding = firstBindingReaching(roots, replacement.previous.syntax.start)
    const start = firstBinding?.path[0]
    if (
      typeof start !== 'number' ||
      firstBinding?.syntax.range.start !== replacement.previous.syntax.start
    ) {
      return undefined
    }
    if (start < previousIndex || start < 0) return undefined
    let end = start
    while (end < previous.state.length) {
      const group = roots.items(end).bindings
      const binding = group[0]
      if (
        binding === undefined ||
        !(
          binding.syntax.range.start < replacement.previous.syntax.end ||
          (binding.text.length === 0 &&
            binding.syntax.range.start === replacement.previous.syntax.end)
        )
      ) {
        break
      }
      if (
        group.length !== 1 ||
        previous.state[end].name !== 'paragraph' ||
        binding.syntax.kind !== 'paragraph' ||
        binding.path.length !== 2 ||
        binding.path[1] !== 'text' ||
        binding.syntax.range.start < replacement.previous.syntax.start ||
        binding.syntax.range.end > replacement.previous.syntax.end ||
        binding.sourceRange.start < replacement.previous.source.start ||
        binding.sourceRange.end > replacement.previous.source.end
      ) {
        return undefined
      }
      end += 1
    }
    if (end === start) return undefined
    const from = offset(replacement.previous.syntax.start)
    const to = offset(replacement.previous.syntax.end)
    if (from === undefined || to === undefined || from < markdownIndex) return undefined
    const source = replacement.previous.source
    for (let root = start; root < end; root += 1) {
      if (roots.items(root).comments.length > 0) return undefined
    }
    for (const root of roots.sourceRoots(source.start, source.end)) {
      if (
        roots
          .items(root)
          .comments.some(
            (comment) =>
              comment.annotationRange.start < source.end && comment.annotationRange.end > source.start
          )
      ) {
        return undefined
      }
    }
    // Multi-paragraph annotation owners and reference dependencies require a
    // complete inventory, which this first paragraph slice deliberately lacks.
    for (const boundary of [source.start, source.end]) {
      for (const root of roots.sourceRoots(boundary, boundary)) {
        if (
          roots.items(root).decorations.some(
            ({ mark: { annotationRange: range } }) =>
              range.start < boundary && range.end > boundary
          )
        ) {
          return undefined
        }
      }
    }
    retainUntil(start)
    const local = createMuyaMarkupView({
      kind: 'markup',
      name: 'markup',
      events: replacement.events,
      syntax: {
        ast: {
          root: {
            kind: 'document',
            range: replacement.next.syntax,
            attributes: {},
            children: replacement.syntaxBlocks
          }
        },
        coordinates: markupRegionCoordinates(replacement)
      }
    }, replacement.annotations)
    const localLength =
      end === previous.state.length ? local.bindings.length : replacement.syntaxBlocks.length
    const base = state.length
    state.push(...local.state.slice(0, localLength))
    const expectedEnd = lastBinding(roots)?.documentEnd
    if (
      end === previous.state.length &&
      expectedEnd !== undefined &&
      local.bindings.at(-1)?.documentEnd?.offset !==
        expectedEnd.offset + replacement.next.source.end - replacement.previous.source.end
    ) {
      return undefined
    }
    // The line before the region is unchanged. A region cannot see it, so its
    // first paragraph keeps the leading line its predecessor had there.
    const outsideLeading = roots.items(start).bindings[0]?.leadingLinePosition
    const region = createMuyaMarkupRootRun(
      {
        bindings: local.bindings.slice(0, localLength).map((binding, index) => {
          const { documentEnd, trailingLinePosition, ...rest } = binding
          const atDocumentEnd = end === previous.state.length
          return {
            ...rest,
            ...(index === 0 &&
            binding.leadingLinePosition === undefined &&
            binding.text !== '' &&
            outsideLeading !== undefined &&
            outsideLeading < replacement.next.source.start
              ? { leadingLinePosition: outsideLeading }
              : {}),
            ...(atDocumentEnd && documentEnd !== undefined ? { documentEnd } : {}),
            ...(binding.markerLine === undefined
              ? {}
              : {
                markerLine: {
                  ...binding.markerLine,
                  statePath: [
                    Number(binding.markerLine.statePath[0]) + base,
                    ...binding.markerLine.statePath.slice(1)
                  ]
                }
              }),
            // The region's end is a line only the document end can leave empty.
            ...(trailingLinePosition === undefined ||
            (!atDocumentEnd && trailingLinePosition === replacement.next.source.end)
              ? {}
              : { trailingLinePosition }),
            path: [Number(binding.path[0]) + base, 'text']
          }
        }),
        decorations: local.decorations
          .filter((decoration) => Number(decoration.path[0]) < localLength)
          .map((decoration) => ({ ...decoration, path: [Number(decoration.path[0]) + base, 'text'] })),
        comments: []
      },
      base,
      state.length - base
    )
    if (region === undefined) return undefined
    runs.push(region)
    appendMarkdown(previous, markdownIndex, from, syntaxDelta)
    appendMarkdown(local, 0, local.markdown.length, 0)
    markdownIndex = to
    replacedStart ??= start
    replacedEnd = end
    previousIndex = end
    sourceDelta = replacement.next.source.end - replacement.previous.source.end
    syntaxDelta = replacement.next.syntax.end - replacement.previous.syntax.end
  }
  retainUntil(previous.state.length)
  appendMarkdown(previous, markdownIndex, previous.markdown.length, syntaxDelta)
  const view = createRunMuyaMarkupView(
    { markdown: markdown.join(''), markdownSegments, state },
    runs
  )
  if (replacedStart !== undefined) {
    const nextEnd = replacedEnd + state.length - previous.state.length
    patches.set(view, { previous, start: replacedStart, previousEnd: replacedEnd, nextEnd })
  }
  return view
}
