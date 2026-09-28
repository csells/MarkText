import type {
  MarkdownAstNode,
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
  type MuyaMarkupComment,
  type MuyaMarkupDecoration,
  type MuyaMarkupView
} from './muyaMarkupView'
import {
  muyaItemsAtRoot,
  muyaItemsInRootOrder,
  muyaItemsInRoots,
  rememberMuyaItemsInRootOrder
} from './muyaMarkupViewLookup'

const shiftRange = (range: SourceRange, delta: number): SourceRange => ({
  start: range.start + delta,
  end: range.end + delta
})

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

const positionKeys = new Map<string, boolean>()
const isPositionKey = (key: string): boolean => {
  let position = positionKeys.get(key)
  if (position === undefined) {
    position = /(?:Start|End)$/u.test(key)
    positionKeys.set(key, position)
  }
  return position
}

const shiftAttributes = (
  attributes: MarkdownAstNode['attributes'],
  delta: number
): MarkdownAstNode['attributes'] => {
  let shifted: Record<string, unknown> | undefined
  for (const key in attributes) {
    const value = attributes[key]
    if (typeof value !== 'number' || !isPositionKey(key)) continue
    shifted ??= { ...attributes }
    shifted[key] = value + delta
  }
  return (shifted ?? attributes) as MarkdownAstNode['attributes']
}

const shiftSyntax = (node: MarkdownAstNode, delta: number): MarkdownAstNode =>
  delta === 0
    ? node
    : {
      ...node,
      range: shiftRange(node.range, delta),
      attributes: shiftAttributes(node.attributes, delta),
      ...(node.semanticTextSegments === undefined
        ? {}
        : {
          semanticTextSegments: node.semanticTextSegments.map((segment) => ({
            ...segment,
            range: shiftRange(segment.range, delta)
          }))
        }),
      children: node.children.length === 0 ? node.children : node.children.map((child) => shiftSyntax(child, delta))
    }

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] }

const shiftedRange = (range: SourceRange, delta: number): SourceRange =>
  delta === 0 ? range : shiftRange(range, delta)

/**
 * `binding` once the text before it changed length by `sourceDelta` source
 * units (`syntaxDelta` in editing syntax) and its root index by `pathDelta`.
 * Parts that hold no position are shared with `binding`, as the decoration
 * and comment helpers below share theirs.
 */
function movedBinding(
  binding: MuyaMarkupBinding,
  pathDelta: number,
  sourceDelta: number,
  syntaxDelta: number
): MuyaMarkupBinding {
  const moved: Mutable<MuyaMarkupBinding> = { ...binding }
  const root = Number(binding.path[0]) + pathDelta
  if (pathDelta !== 0) moved.path = [root, ...binding.path.slice(1)]
  if (syntaxDelta !== 0) moved.syntax = shiftSyntax(binding.syntax, syntaxDelta)
  if (sourceDelta !== 0 || syntaxDelta !== 0) {
    moved.segments = binding.segments.map((segment) => ({
      ...segment,
      source: shiftedRange(segment.source, sourceDelta),
      syntax: shiftedRange(segment.syntax, syntaxDelta)
    }))
  }
  if (pathDelta === 0 && sourceDelta === 0) return moved
  if (binding.markerLine !== undefined) {
    moved.markerLine = {
      ...binding.markerLine,
      start: binding.markerLine.start + sourceDelta,
      end: binding.markerLine.end + sourceDelta,
      content: binding.markerLine.content + sourceDelta,
      statePath: [root, ...binding.markerLine.statePath.slice(1)]
    }
  }
  if (binding.sourceStructure !== undefined) {
    moved.sourceStructure = {
      ...binding.sourceStructure,
      range: shiftedRange(binding.sourceStructure.range, sourceDelta),
      nodes: binding.sourceStructure.nodes.map((node) => {
        const movedNode: Mutable<typeof node> = {
          ...node,
          path: [Number(node.path[0]) + pathDelta, ...node.path.slice(1)],
          range: shiftedRange(node.range, sourceDelta)
        }
        if (node.lineStarts !== undefined && sourceDelta !== 0) {
          movedNode.lineStarts = node.lineStarts.map((offset) => offset + sourceDelta)
        }
        if (node.delimiterRange !== undefined) {
          movedNode.delimiterRange = shiftedRange(node.delimiterRange, sourceDelta)
        }
        return movedNode
      })
    }
  }
  if (sourceDelta === 0) return moved
  moved.sourceRange = shiftRange(binding.sourceRange, sourceDelta)
  if (binding.tableCell !== undefined) {
    moved.tableCell = { ...binding.tableCell, table: shiftRange(binding.tableCell.table, sourceDelta) }
  }
  if (binding.tableCellContent !== undefined) {
    moved.tableCellContent = shiftRange(binding.tableCellContent, sourceDelta)
  }
  if (binding.documentEnd !== undefined) {
    moved.documentEnd = { ...binding.documentEnd, offset: binding.documentEnd.offset + sourceDelta }
  }
  if (binding.containerPrefix !== undefined) {
    moved.containerPrefix = {
      ...binding.containerPrefix,
      range: shiftRange(binding.containerPrefix.range, sourceDelta)
    }
  }
  if (binding.paragraphPrefixPosition !== undefined) {
    moved.paragraphPrefixPosition = binding.paragraphPrefixPosition + sourceDelta
  }
  if (binding.trailingLinePosition !== undefined) {
    moved.trailingLinePosition = binding.trailingLinePosition + sourceDelta
  }
  if (binding.leadingLinePosition !== undefined) {
    moved.leadingLinePosition = binding.leadingLinePosition + sourceDelta
  }
  if (binding.caretSnaps !== undefined) {
    moved.caretSnaps = binding.caretSnaps.map((snap) => ({
      from: snap.from + sourceDelta,
      to: snap.to + sourceDelta,
      at: snap.at + sourceDelta
    }))
  }
  if (binding.outerBlock !== undefined) {
    moved.outerBlock = {
      ...binding.outerBlock,
      range: shiftRange(binding.outerBlock.range, sourceDelta)
    }
  }
  return moved
}

function movedDecoration(
  decoration: MuyaMarkupDecoration,
  pathDelta: number,
  sourceDelta: number
): MuyaMarkupDecoration {
  const moved: Mutable<MuyaMarkupDecoration> = { ...decoration }
  if (pathDelta !== 0) {
    moved.path = [Number(decoration.path[0]) + pathDelta, ...decoration.path.slice(1)]
  }
  if (sourceDelta === 0) return moved
  if (decoration.sourcePosition !== undefined) {
    moved.sourcePosition = decoration.sourcePosition + sourceDelta
  }
  if (decoration.exteriorEnd !== undefined) moved.exteriorEnd = decoration.exteriorEnd + sourceDelta
  moved.mark = {
    ...decoration.mark,
    annotationRange: shiftRange(decoration.mark.annotationRange, sourceDelta)
  }
  return moved
}

function movedComment(
  comment: MuyaMarkupComment,
  pathDelta: number,
  sourceDelta: number
): MuyaMarkupComment {
  return {
    ...comment,
    ...(pathDelta === 0
      ? {}
      : { path: [Number(comment.path[0]) + pathDelta, ...comment.path.slice(1)] }),
    annotationRange: shiftedRange(comment.annotationRange, sourceDelta)
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

const bindingPatches = new WeakMap<
  readonly MuyaMarkupBinding[],
  Readonly<{ previous: readonly MuyaMarkupBinding[]; start: number; nextEnd: number }>
>()

/**
 * The bindings a regional change made anew: those of roots `[start, nextEnd)`.
 * Every other binding is one of `previous`'s, moved with its root.
 */
export const muyaMarkupBindingsPatch = (bindings: readonly MuyaMarkupBinding[]) =>
  bindingPatches.get(bindings)

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

/** Views whose every binding belongs to one of their root blocks. */
const rootedViews = new WeakMap<MuyaMarkupView, boolean>()
const hasRootedBindings = (view: MuyaMarkupView): boolean => {
  let rooted = rootedViews.get(view)
  if (rooted === undefined) {
    rooted = view.bindings.every((binding) => {
      const root = binding.path[0]
      return (
        typeof root === 'number' &&
        Number.isSafeInteger(root) &&
        root >= 0 &&
        root < view.state.length
      )
    })
    rootedViews.set(view, rooted)
  }
  return rooted
}

/**
 * Consume portable Core regions replacing top-level paragraphs. Untouched block shapes
 * retain their native state and mapped leaves. Changed structural blocks,
 * missing comment inventory, or ambiguous ranges request the full-view fallback.
 * Retained state objects are reused; only changed regions visit the view builder.
 */
export function applyMuyaMarkupChanges(
  previous: MuyaMarkupView,
  change: MarkupRegionProjectionChange
): MuyaMarkupView | undefined {
  if (change.replacements.length === 0) return previous
  if (!hasRootedBindings(previous)) return undefined
  const offset = markdownOffsets(previous)
  if (offset === undefined) return undefined
  const replacements = [...change.replacements].sort(
    (left, right) => left.previous.syntax.start - right.previous.syntax.start
  )
  const state: MuyaMarkupView['state'][number][] = []
  const bindings: MuyaMarkupBinding[] = []
  const decorations: MuyaMarkupView['decorations'][number][] = []
  const comments: MuyaMarkupView['comments'][number][] = []
  const markdown: string[] = []
  const markdownSegments: MuyaMarkdownSegment[] = []
  let previousIndex = 0
  let replacedStart: number | undefined
  let replacedEnd = 0
  let markdownIndex = 0
  let sourceDelta = 0
  let syntaxDelta = 0
  let markdownLength = 0
  // Retained runs and replaced regions follow one another in root order, so
  // the new lists keep the order of the lists they are taken from.
  let bindingsOrdered = muyaItemsInRootOrder(previous.bindings)
  let decorationsOrdered = muyaItemsInRootOrder(previous.decorations)
  const commentsOrdered = muyaItemsInRootOrder(previous.comments)
  // Retained roots stay roots of the view; each region's roots are checked.
  let regionRootEnd = 0
  let regionRooted = true
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
    const start = previousIndex
    const pathDelta = state.length - start
    for (; previousIndex < end; previousIndex += 1) state.push(previous.state[previousIndex])
    const moved = sourceDelta !== 0 || syntaxDelta !== 0 || pathDelta !== 0
    for (const binding of muyaItemsInRoots(previous.bindings, start, end)) {
      bindings.push(moved ? movedBinding(binding, pathDelta, sourceDelta, syntaxDelta) : binding)
    }
    const annotationsMoved = sourceDelta !== 0 || pathDelta !== 0
    for (const decoration of muyaItemsInRoots(previous.decorations, start, end)) {
      decorations.push(
        annotationsMoved ? movedDecoration(decoration, pathDelta, sourceDelta) : decoration
      )
    }
    for (const comment of muyaItemsInRoots(previous.comments, start, end)) {
      comments.push(annotationsMoved ? movedComment(comment, pathDelta, sourceDelta) : comment)
    }
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
    const firstBinding = previous.bindings.find(
      (binding) =>
        binding.syntax.range.end > replacement.previous.syntax.start ||
        (binding.text.length === 0 &&
          binding.syntax.range.start >= replacement.previous.syntax.start)
    )
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
      const group = muyaItemsAtRoot(previous.bindings, end)
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
    if (
      previous.comments.some((comment) => {
        const index = Number(comment.path[0])
        return (
          (index >= start && index < end) ||
          (comment.annotationRange.start < replacement.previous.source.end &&
            comment.annotationRange.end > replacement.previous.source.start)
        )
      })
    ) {
      return undefined
    }
    // Multi-paragraph annotation owners and reference dependencies require a
    // complete inventory, which this first paragraph slice deliberately lacks.
    for (const decoration of previous.decorations) {
      const range = decoration.mark.annotationRange
      if (
        (range.start < replacement.previous.source.start &&
          range.end > replacement.previous.source.start) ||
        (range.start < replacement.previous.source.end &&
          range.end > replacement.previous.source.end)
      ) {
        return undefined
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
    bindingsOrdered &&= muyaItemsInRootOrder(local.bindings)
    decorationsOrdered &&= muyaItemsInRootOrder(local.decorations)
    const base = state.length
    state.push(...local.state.slice(0, localLength))
    const expectedEnd = previous.bindings.at(-1)?.documentEnd
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
    const outsideLeading = muyaItemsAtRoot(previous.bindings, start)[0]?.leadingLinePosition
    bindings.push(
      ...local.bindings.slice(0, localLength).map((binding, index) => {
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
      })
    )
    for (const binding of local.bindings.slice(0, localLength)) {
      const root = Number(binding.path[0]) + base
      regionRooted &&= Number.isSafeInteger(root) && root >= 0
      regionRootEnd = Math.max(regionRootEnd, root + 1)
    }
    decorations.push(
      ...local.decorations
        .filter((decoration) => Number(decoration.path[0]) < localLength)
        .map((decoration) => ({ ...decoration, path: [Number(decoration.path[0]) + base, 'text'] }))
    )
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
  const view: MuyaMarkupView = {
    kind: 'view',
    markdown: markdown.join(''),
    markdownSegments,
    state,
    bindings,
    decorations,
    comments
  }
  if (regionRooted && regionRootEnd <= state.length) rootedViews.set(view, true)
  if (bindingsOrdered) rememberMuyaItemsInRootOrder(bindings)
  if (decorationsOrdered) rememberMuyaItemsInRootOrder(decorations)
  if (commentsOrdered) rememberMuyaItemsInRootOrder(comments)
  if (replacedStart !== undefined) {
    const nextEnd = replacedEnd + state.length - previous.state.length
    patches.set(view, { previous, start: replacedStart, previousEnd: replacedEnd, nextEnd })
    bindingPatches.set(bindings, { previous: previous.bindings, start: replacedStart, nextEnd })
  }
  return view
}
