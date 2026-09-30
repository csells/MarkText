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
  type MuyaMarkupDecoration,
  type MuyaMarkupState,
  type MuyaMarkupView,
  type MuyaSourceStructure
} from './muyaMarkupView'
import {
  createMuyaMarkupRootRun,
  createRunMuyaMarkupView,
  muyaMarkupRootsFor,
  placedMuyaMarkupBinding,
  placedMuyaMarkupDecoration,
  placedMuyaMarkupItemBinding,
  placedMuyaMarkupItemDecoration,
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
    // Hidden delimiters before the first run are source the region starts
    // with: a position there reached from before maps to the region's start.
    if (
      low === 0 &&
      from === 'projected' &&
      affinity === 'previous' &&
      next !== undefined &&
      offset === next.projected.start &&
      next.source.start > replacement.next.source.start
    ) {
      return replacement.next.source.start
    }
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
  /** For one list root patched in place, the items replaced in it, as in Muya's reconcile region. */
  readonly items?: Readonly<{ start: number; previousEnd: number; nextEnd: number }>
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
 * The canonical source of a region whose text events are its whole source, at
 * its document offsets, for the blocks whose view keeps their source text (a
 * table, list or quote). A region with suggestions spells delimiters its
 * events leave out, so it has none.
 */
const regionSource = (replacement: MarkupRegionReplacement): string | undefined => {
  if (replacement.annotations.length > 0) return undefined
  let text = ''
  let cursor = replacement.next.source.start
  for (const event of replacement.events) {
    if (event.kind !== 'text' || event.sourceRange.start !== cursor) return undefined
    text += event.text
    cursor = event.sourceRange.end
  }
  return cursor === replacement.next.source.end
    ? ' '.repeat(replacement.next.source.start) + text
    : undefined
}

const listStates = new Set(['bullet-list', 'order-list', 'task-list'])

/** The item a binding of a list root belongs to, by its place in the root. */
const itemOf = (binding: MuyaMarkupBinding): number | undefined =>
  binding.path[1] === 'children' && typeof binding.path[2] === 'number' ? binding.path[2] : undefined

/**
 * A list root with items `[itemsBefore, itemsBefore + previousItems)` replaced
 * by the region's items, whose bindings stand at root `root` of the previous
 * view. The list keeps its reading and its items outside the region, so only
 * the region's items are built; the root's first binding carries the whole
 * list's source again. Items with suggestions stay on the whole-view path.
 */
function listItemsPatch(
  previous: MuyaMarkupView,
  roots: MuyaMarkupRoots,
  replacement: MarkupRegionReplacement
): Readonly<{
  root: number
  state: MuyaMarkupState
  bindings: readonly MuyaMarkupBinding[]
  decorations: readonly MuyaMarkupDecoration[]
  local: MuyaMarkupView
}> | undefined {
  const items = replacement.listItems
  const first = replacement.syntaxBlocks[0]
  const last = replacement.syntaxBlocks.at(-1)
  if (items === undefined || first === undefined || last === undefined) return undefined
  const root = firstBindingReaching(roots, replacement.previous.syntax.start)?.path[0]
  if (typeof root !== 'number') return undefined
  const listState = previous.state[root]
  const children = listState?.children
  const rootItems = roots.items(root)
  if (
    listState === undefined || children === undefined || !listStates.has(listState.name) ||
    items.itemsBefore + items.previousItems > children.length ||
    rootItems.comments.length > 0
  ) {
    return undefined
  }
  // A suggestion reaching past the region's bounds reads with text the
  // region's view does not hold.
  for (const boundary of [replacement.previous.source.start, replacement.previous.source.end]) {
    if (rootItems.decorations.some(({ mark: { annotationRange: range } }) => range.start < boundary && range.end > boundary)) {
      return undefined
    }
  }
  const canonicalSource = ' '.repeat(replacement.next.source.start) + items.source
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
          children: [{
            ...items.list,
            range: { start: first.range.start, end: last.range.end },
            children: replacement.syntaxBlocks
          }]
        }
      },
      coordinates: markupRegionCoordinates(replacement)
    }
  }, replacement.annotations, canonicalSource, undefined, replacement.precedingEvents, replacement.following)
  const localItems = local.state[0]?.children
  if (
    local.state.length !== 1 || localItems === undefined || localItems.length !== replacement.syntaxBlocks.length ||
    local.comments.length > 0
  ) {
    return undefined
  }
  const sourceDelta = replacement.next.source.end - replacement.previous.source.end
  const syntaxDelta = replacement.next.syntax.end - replacement.previous.syntax.end
  const itemDelta = localItems.length - items.previousItems
  const after = items.itemsBefore + items.previousItems
  const atLastItem = after === children.length
  const atDocumentEnd = atLastItem && root === previous.state.length - 1
  // A suggestion ending past its last text is shown on the next block's
  // start, which the whole view reaches and the region's view does not.
  if (!atDocumentEnd && local.decorations.some((decoration) => decoration.exteriorEnd !== undefined)) return undefined
  const decorations: MuyaMarkupDecoration[] = []
  for (const decoration of rootItems.decorations) {
    const item = decoration.path[1] === 'children' && typeof decoration.path[2] === 'number' ? decoration.path[2] : undefined
    if (item === undefined) return undefined
    if (item < items.itemsBefore) decorations.push(decoration)
  }
  decorations.push(...local.decorations.map((decoration) =>
    placedMuyaMarkupItemDecoration(decoration, root, items.itemsBefore, 0)))
  for (const decoration of rootItems.decorations) {
    const item = decoration.path[2]
    if (typeof item === 'number' && item >= items.itemsBefore + items.previousItems) {
      decorations.push(placedMuyaMarkupItemDecoration(decoration, 0, localItems.length - items.previousItems,
        replacement.next.source.end - replacement.previous.source.end))
    }
  }
  const before: MuyaMarkupBinding[] = []
  const later: MuyaMarkupBinding[] = []
  for (const binding of rootItems.bindings) {
    const item = itemOf(binding)
    if (item === undefined) return undefined
    if (item < items.itemsBefore) before.push(binding)
    else if (item >= after) later.push(placedMuyaMarkupItemBinding(binding, 0, itemDelta, sourceDelta, syntaxDelta))
    else if (
      binding.syntax.range.start < replacement.previous.syntax.start ||
      binding.syntax.range.end > replacement.previous.syntax.end
    ) {
      return undefined
    }
  }
  // The region's own view reads its items as a list of their own: a lone
  // item's marker line and prefix, the list's outer block and source, and
  // a region end that is not the document's are the whole list's to give.
  const placed = local.bindings.map((binding) => {
    const {
      outerBlock: _outerBlock,
      sourceStructure: _sourceStructure,
      containerPrefix: _containerPrefix,
      documentEnd,
      markerLine,
      trailingLinePosition,
      ...rest
    } = placedMuyaMarkupItemBinding(binding, root, items.itemsBefore, 0, 0)
    return {
      ...rest,
      ...(markerLine === undefined || markerLine.statePath.length === 1 ? {} : { markerLine }),
      ...(atDocumentEnd && documentEnd !== undefined ? { documentEnd } : {}),
      ...(trailingLinePosition === undefined ||
      (!atDocumentEnd && trailingLinePosition === replacement.next.source.end)
        ? {}
        : { trailingLinePosition })
    }
  })
  const bindings = [...before, ...placed, ...later]
  // The list's first binding carries its outer block and source structure.
  const owner = rootItems.bindings[0]
  const ownerIndex = bindings.findIndex((binding) => itemOf(binding) !== undefined)
  if (owner === undefined || ownerIndex !== 0) return undefined
  const text = (start: number, end: number, whole: Readonly<{ range: SourceRange; source: string }>): string | undefined => {
    let result = ''
    for (let offset = start; offset < end;) {
      if (offset < replacement.next.source.start) {
        const to = Math.min(end, replacement.next.source.start)
        if (offset < whole.range.start || to > whole.range.end) return undefined
        result += whole.source.slice(offset - whole.range.start, to - whole.range.start)
        offset = to
      } else if (offset < replacement.next.source.end) {
        const to = Math.min(end, replacement.next.source.end)
        result += canonicalSource.slice(offset, to)
        offset = to
      } else {
        const from = offset - sourceDelta
        const to = end - sourceDelta
        if (from < whole.range.start || to > whole.range.end) return undefined
        result += whole.source.slice(from - whole.range.start, to - whole.range.start)
        offset = end
      }
    }
    return result
  }
  const localOwner = local.bindings[0]
  const range = (previousRange: SourceRange, localRange: SourceRange | undefined): SourceRange | undefined => {
    const start = items.itemsBefore === 0 ? localRange?.start : previousRange.start
    const end = atLastItem ? localRange?.end : previousRange.end + sourceDelta
    return start === undefined || end === undefined ? undefined : { start, end }
  }
  const ownerPatch: { outerBlock?: MuyaMarkupBinding['outerBlock']; sourceStructure?: MuyaSourceStructure } = {}
  // The whole view gives a root its outer block only while no suggestion
  // shows in it; one whose last suggestion went has it again, whole.
  if (owner.outerBlock === undefined && decorations.length === 0 && rootItems.decorations.length > 0) return undefined
  if (owner.outerBlock !== undefined && decorations.length === 0) {
    const next = range(owner.outerBlock.range, localOwner?.outerBlock?.range)
    const source = next === undefined ? undefined : text(next.start, next.end, owner.outerBlock)
    if (next === undefined || source === undefined) return undefined
    const followingSource = atLastItem ? localOwner?.outerBlock?.followingSource : owner.outerBlock.followingSource
    ownerPatch.outerBlock = { range: next, source, ...(followingSource === undefined ? {} : { followingSource }) }
  }
  if (owner.sourceStructure !== undefined) {
    const structure = owner.sourceStructure
    const next = range(structure.range, localOwner?.sourceStructure?.range)
    const source = next === undefined ? undefined : text(next.start, next.end, structure)
    const localNodes = localOwner?.sourceStructure?.nodes
    if (next === undefined || source === undefined || localNodes === undefined) return undefined
    const shift = (value: SourceRange): SourceRange => ({ start: value.start + sourceDelta, end: value.end + sourceDelta })
    const nodeItem = (path: readonly (string | number)[]): number | undefined =>
      path[1] === 'children' && typeof path[2] === 'number' ? path[2] : undefined
    const nodes: MuyaSourceStructure['nodes'][number][] = []
    for (const node of structure.nodes) {
      const item = nodeItem(node.path)
      if (item === undefined) nodes.push({ ...node, range: next })
      else if (item < items.itemsBefore) nodes.push(node)
    }
    for (const node of localNodes) {
      const item = nodeItem(node.path)
      if (item !== undefined) nodes.push({ ...node, path: [root, 'children', item + items.itemsBefore, ...node.path.slice(3)] })
    }
    for (const node of structure.nodes) {
      const item = nodeItem(node.path)
      if (item === undefined || item < after) continue
      nodes.push({
        ...node,
        path: [node.path[0], 'children', item + itemDelta, ...node.path.slice(3)],
        range: shift(node.range),
        ...(node.lineStarts === undefined ? {} : { lineStarts: node.lineStarts.map((offset) => offset + sourceDelta) }),
        ...(node.delimiterRange === undefined ? {} : { delimiterRange: shift(node.delimiterRange) })
      })
    }
    ownerPatch.sourceStructure = { range: next, source, nodes }
  }
  const {
    outerBlock: _ownerOuter,
    sourceStructure: _ownerStructure,
    ...ownerRest
  } = bindings[0] as MuyaMarkupBinding
  bindings[0] = { ...ownerRest, ...ownerPatch }
  return {
    root,
    state: {
      ...listState,
      children: [...children.slice(0, items.itemsBefore), ...localItems, ...children.slice(after)]
    },
    bindings,
    decorations,
    local
  }
}

/**
 * Consume portable Core regions replacing top-level blocks. Untouched block shapes
 * retain their native state and mapped leaves. Missing comment inventory, a
 * replaced block without text, or ambiguous ranges request the full-view fallback.
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
  let replacedItems: MuyaMarkupViewPatch['items']
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
      replacement.syntaxBlocks.length === 0 ||
      !validCoordinates(replacement.coordinates) ||
      !completeSourceCoverage(replacement)
    ) {
      return undefined
    }
    if (replacement.listItems !== undefined) {
      const patched = listItemsPatch(previous, roots, replacement)
      if (patched === undefined || patched.root < previousIndex) return undefined
      const from = offset(replacement.previous.syntax.start)
      const to = offset(replacement.previous.syntax.end)
      if (from === undefined || to === undefined || from < markdownIndex) return undefined
      retainUntil(patched.root)
      const base = state.length
      state.push(patched.state)
      const region = createMuyaMarkupRootRun(
        {
          bindings: patched.bindings.map((binding) => placedMuyaMarkupBinding(binding, base - patched.root)),
          decorations: patched.decorations.map((decoration) => placedMuyaMarkupDecoration(decoration, base - patched.root)),
          comments: []
        },
        base,
        1
      )
      if (region === undefined) return undefined
      runs.push(region)
      appendMarkdown(previous, markdownIndex, from, syntaxDelta)
      appendMarkdown(patched.local, 0, patched.local.markdown.length, 0)
      markdownIndex = to
      replacedItems = replacedStart === undefined && replacement.listItems !== undefined
        ? {
          start: replacement.listItems.itemsBefore,
          previousEnd: replacement.listItems.itemsBefore + replacement.listItems.previousItems,
          nextEnd: replacement.listItems.itemsBefore + replacement.syntaxBlocks.length
        }
        : undefined
      replacedStart ??= patched.root
      replacedEnd = patched.root + 1
      previousIndex = patched.root + 1
      sourceDelta = replacement.next.source.end - replacement.previous.source.end
      syntaxDelta = replacement.next.syntax.end - replacement.previous.syntax.end
      continue
    }
    const structural = replacement.syntaxBlocks.some((node) =>
      ['table', 'list', 'blockquote'].includes(node.kind))
    const canonicalSource = structural ? regionSource(replacement) : undefined
    if (structural && canonicalSource === undefined) return undefined
    const firstBinding = firstBindingReaching(roots, replacement.previous.syntax.start)
    const start = firstBinding?.path[0]
    if (
      typeof start !== 'number' ||
      firstBinding === undefined ||
      firstBinding.syntax.range.start < replacement.previous.syntax.start
    ) {
      return undefined
    }
    if (start < previousIndex || start < 0) return undefined
    // The root before the region ends before it, so the region's first
    // block is this root's, not a later part of that root's.
    if (
      start > 0 &&
      roots.items(start - 1).bindings.some(
        (binding) => binding.syntax.range.end > replacement.previous.syntax.start
      )
    ) {
      return undefined
    }
    let end = start
    while (end < previous.state.length) {
      // Only the first binding of the root after the region is read, so a
      // long list there is not moved to learn that it lies outside.
      const binding = roots.bindingAt(end, 0)
      // A root without text cannot be placed against the region's blocks.
      if (binding === undefined) return undefined
      if (
        !(
          binding.syntax.range.start < replacement.previous.syntax.end ||
          (binding.text.length === 0 &&
            binding.syntax.range.start === replacement.previous.syntax.end)
        )
      ) {
        break
      }
      if (
        roots.items(end).bindings.some(
          (item) =>
            item.syntax.range.start < replacement.previous.syntax.start ||
            item.syntax.range.end > replacement.previous.syntax.end ||
            item.sourceRange.start < replacement.previous.source.start ||
            item.sourceRange.end > replacement.previous.source.end
        )
      ) {
        return undefined
      }
      end += 1
    }
    if (end === start) return undefined
    // Blocks other than paragraphs read the suggestions around them from
    // their containers and neighbours; the region's view does so only for
    // text without suggestions.
    if (replacement.syntaxBlocks.some((node) => node.kind !== 'paragraph')) {
      if (replacement.annotations.length > 0) return undefined
      for (let root = start; root < end; root += 1) {
        if (roots.items(root).decorations.length > 0) return undefined
      }
    }
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
    // The root before the region keeps the text up to the next block's
    // start as its outer block's following source, which moves with that
    // start; the region's view cannot give it again.
    const outer = start > 0 ? roots.items(start - 1).bindings[0]?.outerBlock : undefined
    const firstBlock = replacement.syntaxBlocks[0]
    if (outer?.followingSource !== undefined && firstBlock !== undefined &&
        markupRegionCoordinates(replacement).toSource(firstBlock.range.start, 'previous') !==
          outer.range.end + outer.followingSource.length) {
      return undefined
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
    }, replacement.annotations, canonicalSource, undefined, replacement.precedingEvents, replacement.following)
    const localLength =
      end === previous.state.length ? local.state.length : replacement.syntaxBlocks.length
    if (local.state.length < localLength) return undefined
    // A suggestion ending past its last text is shown on the next block's
    // start, which the whole view reaches and the region's view does not.
    if (
      end < previous.state.length &&
      local.decorations.some(
        (decoration) => decoration.exteriorEnd !== undefined && Number(decoration.path[0]) === localLength - 1
      )
    ) {
      return undefined
    }
    const base = state.length
    state.push(...local.state.slice(0, localLength))
    const expectedEnd = end === previous.state.length ? lastBinding(roots)?.documentEnd : undefined
    if (
      expectedEnd !== undefined &&
      local.bindings.at(-1)?.documentEnd?.offset !==
        expectedEnd.offset + replacement.next.source.end - replacement.previous.source.end
    ) {
      return undefined
    }
    // The line before the region is unchanged. Without its text, the region's
    // first paragraph keeps the leading line its predecessor had there.
    const outsideLeading =
      replacement.precedingEvents === undefined &&
      previous.state[start]?.name === 'paragraph' &&
      local.state[0]?.name === 'paragraph'
        ? roots.items(start).bindings[0]?.leadingLinePosition
        : undefined
    const region = createMuyaMarkupRootRun(
      {
        bindings: local.bindings
          .filter((binding) => Number(binding.path[0]) < localLength)
          .map((binding, index) => {
            const { documentEnd, trailingLinePosition, ...rest } = placedMuyaMarkupBinding(binding, base)
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
              // The region's end is a line only the document end can leave empty.
              ...(trailingLinePosition === undefined ||
              (!atDocumentEnd && trailingLinePosition === replacement.next.source.end)
                ? {}
                : { trailingLinePosition })
            }
          }),
        decorations: local.decorations
          .filter((decoration) => Number(decoration.path[0]) < localLength)
          .map((decoration) => placedMuyaMarkupDecoration(decoration, base)),
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
    const single = replacedItems !== undefined && replacements.length === 1
    patches.set(view, { previous, start: replacedStart, previousEnd: replacedEnd, nextEnd, ...(single ? { items: replacedItems } : {}) })
  }
  return view
}
