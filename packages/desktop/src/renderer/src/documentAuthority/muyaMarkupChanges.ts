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
  isMuyaSplitListRoot,
  muyaCaretSnaps,
  muyaDecorationAfterLastBlock,
  muyaRootsOfBlocks,
  type MuyaCaretSnap,
  type MuyaMarkdownSegment,
  type MuyaMarkupBinding,
  type MuyaMarkupDecoration,
  type MuyaMarkupSourceSegment,
  type MuyaMarkupState,
  type MuyaMarkupView,
  type MuyaSourceStructure
} from './muyaMarkupView'
import {
  createListItemBindings,
  groupListItems,
  listedItemGroups,
  createMuyaMarkupListRootRun,
  createMuyaMarkupRetouchedRootRun,
  createMuyaMarkupRootRun,
  createRunMuyaMarkupView,
  muyaMarkupItemGroups,
  muyaMarkupItemsExtent,
  patchedListItemBindings,
  patchedListItemGroups,
  placedMuyaMarkupItemGroups,
  muyaMarkupRootsFor,
  placedMuyaMarkupBinding,
  placedMuyaMarkupDecoration,
  placedMuyaMarkupItemBinding,
  placedMuyaMarkupItemDecoration,
  shiftSyntax,
  type MuyaMarkupItemBindings,
  type MuyaMarkupItemGroups,
  type MuyaMarkupRootExtent,
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
  const segments = view.markdownSegments
  if (segments.length === 0) return undefined
  return (syntax) => {
    // The first segment that does not end before `syntax`; segments are in order.
    let low = 0
    let high = segments.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (segments[middle].syntax.end < syntax) low = middle + 1
      else high = middle
    }
    const next = segments[low]
    if (next === undefined) return undefined
    if (syntax < next.syntax.start) {
      return segments[low - 1]?.text.end === next.text.start ? next.text.start : undefined
    }
    return next.text.start + syntax - next.syntax.start
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
  const reaches = (item: MuyaMarkupBinding): boolean =>
    item.syntax.range.end > position ||
    (item.text.length === 0 && item.syntax.range.start >= position)
  for (const root of roots.syntaxRoots(position, Infinity)) {
    const items = roots.items(root)
    const groups = muyaMarkupItemGroups(items)
    // Bindings in list order reach ever later positions, so a long list's
    // items are searched rather than read in turn.
    const binding = groups === undefined ? items.bindings.find(reaches) : groups.first(reaches)
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

type StructureNode = MuyaSourceStructure['nodes'][number]

const itemOfPath = (path: readonly (string | number)[]): number | undefined =>
  path[1] === 'children' && typeof path[2] === 'number' ? path[2] : undefined

/** A list's source structure nodes: the list's own, then its items' by item. */
interface StructureItems {
  readonly rootNodes: readonly StructureNode[]
  readonly groups: MuyaMarkupItemGroups<StructureNode>
}

const structureItems = new WeakMap<MuyaSourceStructure, StructureItems>()

/** `structure`'s nodes by item; undefined unless the list's own nodes come first. */
function groupStructureItems(structure: MuyaSourceStructure): StructureItems | undefined {
  const nodes = structure.nodes
  let first = 0
  while (first < nodes.length && itemOfPath(nodes[first].path) === undefined) first += 1
  const groups = groupListItems(nodes.slice(first))
  return groups === undefined ? undefined : { rootNodes: nodes.slice(0, first), groups }
}

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
  itemGroups: MuyaMarkupItemBindings
  extent: MuyaMarkupRootExtent
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
    isMuyaSplitListRoot(listState) ||
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
  // Items of another kind than the list's would split it into a list per run.
  const tasks = listState.name === 'task-list'
  if (
    local.state.length !== 1 || localItems === undefined || localItems.length !== replacement.syntaxBlocks.length ||
    localItems.some((item) => (item.name === 'task-list-item') !== tasks) ||
    local.comments.length > 0
  ) {
    return undefined
  }
  const sourceDelta = replacement.next.source.end - replacement.previous.source.end
  const syntaxDelta = replacement.next.syntax.end - replacement.previous.syntax.end
  const after = items.itemsBefore + items.previousItems
  const atLastItem = after === children.length
  const atDocumentEnd = atLastItem && root === previous.state.length - 1
  // The document's end reads where the whole view reads it, which a
  // suggestion closing after the region's last text moves past that text.
  const expectedEnd = atDocumentEnd ? lastBinding(roots)?.documentEnd : undefined
  const localEnd = local.bindings.at(-1)?.documentEnd
  if (expectedEnd !== undefined && (localEnd?.offset !== expectedEnd.offset + replacement.next.source.end -
    replacement.previous.source.end || localEnd.trailingLineEndings !== expectedEnd.trailingLineEndings)) return undefined
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
  // Only the replaced items are read: the others keep their bindings, and
  // the later ones move when first read.
  const groups = muyaMarkupItemGroups(rootItems) ?? createListItemBindings(rootItems.bindings)
  if (groups === undefined || groups.count !== children.length) return undefined
  for (let item = items.itemsBefore; item < after; item += 1) {
    for (const binding of groups.group(item)) {
      if (
        binding.syntax.range.start < replacement.previous.syntax.start ||
        binding.syntax.range.end > replacement.previous.syntax.end
      ) {
        return undefined
      }
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
  const placedGroups: MuyaMarkupBinding[][] = localItems.map(() => [])
  for (const binding of placed) {
    const item = itemOf(binding)
    if (item === undefined || item < items.itemsBefore || item >= items.itemsBefore + localItems.length) return undefined
    placedGroups[item - items.itemsBefore].push(binding)
  }
  // The list's first binding carries its outer block and source structure.
  const firstItem = (item: number): MuyaMarkupBinding | undefined =>
    item < items.itemsBefore ? groups.group(item)[0] : placedGroups[item - items.itemsBefore]?.[0]
  const owner = groups.group(0)[0]
  const nextOwner = firstItem(0)
  if (owner === undefined || nextOwner === undefined) return undefined
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
    const held = structureItems.get(structure) ?? groupStructureItems(structure)
    if (held === undefined) return undefined
    const localGroups: StructureNode[][] = localItems.map(() => [])
    for (const node of localNodes) {
      const item = itemOfPath(node.path)
      if (item === undefined) continue
      const group = localGroups[item]
      if (group === undefined) return undefined
      group.push({ ...node, path: [root, 'children', item + items.itemsBefore, ...node.path.slice(3)] })
    }
    // Later items' nodes move when the list's nodes are first read.
    const shifted = (value: SourceRange, delta: number): SourceRange => ({ start: value.start + delta, end: value.end + delta })
    const groups = patchedListItemGroups(held.groups, items.itemsBefore, after, localGroups, { source: sourceDelta, syntax: 0 },
      (node, shift) => ({
        ...node,
        path: [node.path[0], 'children', Number(node.path[2]) + shift.items, ...node.path.slice(3)],
        range: shifted(node.range, shift.source),
        ...(node.lineStarts === undefined ? {} : { lineStarts: node.lineStarts.map((offset) => offset + shift.source) }),
        ...(node.delimiterRange === undefined ? {} : { delimiterRange: shifted(node.delimiterRange, shift.source) })
      }))
    const rootNodes = held.rootNodes.map((node) => ({ ...node, range: next }))
    let nodes: readonly StructureNode[] | undefined
    const nextStructure: MuyaSourceStructure = {
      range: next,
      source,
      get nodes() {
        nodes ??= [...rootNodes, ...listedItemGroups(groups)]
        return nodes
      }
    }
    structureItems.set(nextStructure, { rootNodes, groups })
    ownerPatch.sourceStructure = nextStructure
  }
  const {
    outerBlock: _ownerOuter,
    sourceStructure: _ownerStructure,
    ...ownerRest
  } = nextOwner
  const nextOwnerBinding: MuyaMarkupBinding = { ...ownerRest, ...ownerPatch }
  const itemGroups = patchedListItemBindings(groups, items.itemsBefore, after, placedGroups, sourceDelta, syntaxDelta,
    (group) => [nextOwnerBinding, ...group.slice(1)])
  // The list's positions are the unchanged items', the later items' moved,
  // and the region's: a bound that may be wider than the items reach.
  const previousExtent = roots.extent(root)
  const regionExtent = muyaMarkupItemsExtent({
    bindings: [...placed, nextOwnerBinding],
    decorations,
    comments: []
  })
  let replacedEditable = 0
  for (let item = items.itemsBefore; item < after; item += 1) {
    for (const binding of groups.group(item)) if (binding.editable !== false) replacedEditable += 1
  }
  const hull = (
    before: readonly [number, number],
    delta: number,
    region: readonly [number, number]
  ): [number, number] => [
    Math.min(before[0], before[0] + delta, region[0]),
    Math.max(before[1], before[1] + delta, region[1])
  ]
  const placedEditable = placed.filter((binding) => binding.editable !== false).length
  return {
    root,
    state: {
      ...listState,
      children: [...children.slice(0, items.itemsBefore), ...localItems, ...children.slice(after)]
    },
    itemGroups,
    extent: {
      source: hull(previousExtent.source, sourceDelta, regionExtent.source),
      syntax: hull(previousExtent.syntax, syntaxDelta, regionExtent.syntax),
      editable: previousExtent.editable - replacedEditable + placedEditable
    },
    decorations,
    local
  }
}

/**
 * The compatibility text of a region's events and its runs located in
 * editing syntax, as the whole view reads them (see `createMuyaMarkupView`).
 */
function regionMarkdown(replacement: MarkupRegionReplacement): Pick<MuyaMarkupView, 'markdown' | 'markdownSegments'> {
  const markdownSegments: MuyaMarkdownSegment[] = []
  let markdown = ''
  let run = 0
  const runs = replacement.coordinates
  for (const event of replacement.events) {
    if (event.kind !== 'text') continue
    while (run < runs.length && runs[run].source.end <= event.sourceRange.start) run += 1
    for (let index = run; index < runs.length; index += 1) {
      const segment = runs[index]
      if (segment.source.start >= event.sourceRange.end) break
      const start = Math.max(segment.source.start, event.sourceRange.start)
      const end = Math.min(segment.source.end, event.sourceRange.end)
      if (start >= end) continue
      appendMuyaMarkdownSegment(markdownSegments, {
        syntax: {
          start: segment.projected.start + start - segment.source.start,
          end: segment.projected.start + end - segment.source.start
        },
        text: {
          start: markdown.length + start - event.sourceRange.start,
          end: markdown.length + end - event.sourceRange.start
        }
      })
    }
    markdown += event.text
  }
  return { markdown, markdownSegments }
}

const literalStates = new Set(['code-block', 'math-block', 'html-block', 'diagram'])

/**
 * A source position of the previous view once a suggestion arm's lines
 * (see `replacedLines`) changed length: one at or after them moves, one at
 * or before their start stays, and one inside them has no place.
 */
const armSourcePosition = (replacement: MarkupRegionReplacement) => {
  const { start, end } = replacedLines(replacement)
  const delta = replacement.next.source.end - replacement.previous.source.end
  return (position: number): number | undefined =>
    position >= end ? position + delta : position <= start ? position : undefined
}

/**
 * The previous source of a literal lines replacement's lines: its region,
 * or the lines inside the suggestion arm's text event it replaces.
 */
function replacedLines(replacement: MarkupRegionReplacement): SourceRange {
  const lines = replacement.literalLines
  if (lines?.sourceStart === undefined) return replacement.previous.source
  const delta = replacement.next.source.end - replacement.previous.source.end
  return { start: lines.sourceStart, end: lines.sourceStart + lines.source.length - delta }
}

/**
 * A mark of the previous view once a suggestion arm's lines changed length,
 * placed at root `placed`: the annotations holding the lines
 * keep their starts and move their ends. `text` maps the root's text offsets
 * where its text changed too.
 */
function armDecoration(
  decoration: MuyaMarkupDecoration,
  placed: number,
  source: (position: number) => number | undefined,
  text?: (offset: number) => number | undefined
): MuyaMarkupDecoration | undefined {
  const { annotationRange } = decoration.mark
  const annotationStart = source(annotationRange.start)
  const annotationEnd = source(annotationRange.end)
  const sourcePosition = decoration.sourcePosition === undefined ? undefined : source(decoration.sourcePosition)
  const exteriorEnd = decoration.exteriorEnd === undefined ? undefined : source(decoration.exteriorEnd)
  const rangeStart = text === undefined ? decoration.range.start : text(decoration.range.start)
  const rangeEnd = text === undefined ? decoration.range.end : text(decoration.range.end)
  if (annotationStart === undefined || annotationEnd === undefined || rangeStart === undefined || rangeEnd === undefined ||
      (decoration.sourcePosition !== undefined && sourcePosition === undefined) ||
      (decoration.exteriorEnd !== undefined && exteriorEnd === undefined)) return undefined
  return {
    ...decoration,
    path: [placed, ...decoration.path.slice(1)],
    range: rangeStart === decoration.range.start && rangeEnd === decoration.range.end
      ? decoration.range
      : { start: rangeStart, end: rangeEnd },
    mark: annotationStart === annotationRange.start && annotationEnd === annotationRange.end
      ? decoration.mark
      : { ...decoration.mark, annotationRange: { start: annotationStart, end: annotationEnd } },
    ...(sourcePosition === undefined ? {} : { sourcePosition }),
    ...(exteriorEnd === undefined ? {} : { exteriorEnd })
  }
}

/** A literal block child's text in its binding: a line's text, or the break ending it. */
export const literalChildText = (child: MarkdownAstNode): string =>
  child.kind === 'soft-break' ? '\n' : String(child.attributes.semanticText ?? '')

/**
 * A literal block root with lines `[linesBefore, linesBefore + previousLines)`
 * replaced by the region's lines, whose binding stands at root `root` of the
 * previous view. The block keeps its reading and its other lines, so only
 * the region's lines are read: its text, segments and children are the
 * previous ones with the region's spliced in, later ones moved by the edit.
 * Lines holding the block's first or last line, or suggestions, stay on the
 * whole-view path.
 */
function literalLinesPatch(
  previous: MuyaMarkupView,
  roots: MuyaMarkupRoots,
  replacement: MarkupRegionReplacement
): Readonly<{
  root: number
  state: MuyaMarkupState
  bindings: readonly MuyaMarkupBinding[]
  decorations: readonly MuyaMarkupDecoration[]
}> | undefined {
  const lines = replacement.literalLines
  if (lines === undefined || replacement.annotations.length > 0) return undefined
  const root = firstBindingReaching(roots, replacement.previous.syntax.start)?.path[0]
  if (typeof root !== 'number') return undefined
  const rootState = previous.state[root]
  const rootItems = roots.items(root)
  // Lines of a suggestion's arm carry its marks along.
  if (rootState === undefined || !literalStates.has(rootState.name) || typeof rootState.text !== 'string' ||
      (replacement.enclosing === undefined && rootItems.decorations.length > 0) || rootItems.comments.length > 0) return undefined
  const content = rootItems.bindings.find((binding) => binding.path.length === 2 && binding.path[1] === 'text')
  const block = content?.syntax
  if (content === undefined || block === undefined || block.kind !== lines.block.kind || content.text !== rootState.text ||
      content.sourceStructure !== undefined || content.markerLine !== undefined || content.containerPrefix !== undefined ||
      content.paragraphPrefixPosition !== undefined) return undefined
  const { contentStart, contentEnd } = block.attributes
  const span = replacedLines(replacement)
  const children = block.children
  const replacedEnd = lines.childrenBefore + lines.previousChildren
  // The region may hold the block's opener or closer, which stay, and the
  // empty lines after it, which reach no later block.
  const nextBlock = root + 1 < previous.state.length ? roots.items(root + 1).bindings[0]?.syntax : undefined
  if (typeof contentStart !== 'number' || typeof contentEnd !== 'number' || typeof block.attributes.content !== 'string' ||
      replacedEnd > children.length || replacement.previous.syntax.start < block.range.start ||
      (nextBlock !== undefined && replacement.previous.syntax.end > nextBlock.range.start) ||
      content.emptyLiteralLineEnding !== undefined ||
      (content.trailingLinePosition !== undefined && content.trailingLinePosition < span.end) ||
      content.leadingLinePosition !== undefined ||
      // The document's trailing line endings are read with its last block.
      rootItems.bindings.some((binding) => binding.documentEnd !== undefined && span.end >=
        binding.documentEnd.offset - binding.documentEnd.trailingLineEndings.length) ||
      (content.outerBlock !== undefined && (span.start < content.outerBlock.range.start ||
        span.end > content.outerBlock.range.end))) return undefined
  const sourceDelta = replacement.next.source.end - replacement.previous.source.end
  const syntaxDelta = replacement.next.syntax.end - replacement.previous.syntax.end
  let textStart = 0
  for (let child = 0; child < lines.childrenBefore; child += 1) textStart += literalChildText(children[child]).length
  let textEnd = textStart
  for (let child = lines.childrenBefore; child < replacedEnd; child += 1) textEnd += literalChildText(children[child]).length
  const inserted = replacement.syntaxBlocks.map(literalChildText).join('')
  const text = content.text.slice(0, textStart) + inserted + content.text.slice(textEnd)
  const textDelta = inserted.length - (textEnd - textStart)
  if (text.length === 0) return undefined
  // Each nonempty child is one segment, its text mapped to its source.
  const coordinates = markupRegionCoordinates(replacement)
  const segments: MuyaMarkupSourceSegment[] = content.segments.filter((segment) => segment.text.end <= textStart)
  let offset = textStart
  for (const child of replacement.syntaxBlocks) {
    const length = literalChildText(child).length
    if (child.range.start !== child.range.end) {
      segments.push({
        text: { start: offset, end: offset + length },
        source: {
          start: coordinates.toSource(child.range.start, 'next'),
          end: coordinates.toSource(child.range.end, 'previous')
        },
        syntax: { start: child.range.start, end: child.range.end }
      })
    }
    offset += length
  }
  for (const segment of content.segments) {
    if (segment.text.start < textEnd) continue
    segments.push({
      text: { start: segment.text.start + textDelta, end: segment.text.end + textDelta },
      source: { start: segment.source.start + sourceDelta, end: segment.source.end + sourceDelta },
      syntax: { start: segment.syntax.start + syntaxDelta, end: segment.syntax.end + syntaxDelta }
    })
  }
  // The block's content reads its lines as its text does, tabs expanded.
  const contentText = block.attributes.content
  if (!contentText.startsWith(content.text)) return undefined
  // The content spans its lines, which move where the region's do.
  const firstChild = lines.childrenBefore === 0 ? replacement.syntaxBlocks[0] : children[0]
  const lastChild = replacedEnd === children.length ? replacement.syntaxBlocks.at(-1) : children.at(-1)
  if (firstChild === undefined || lastChild === undefined || children.length === 0) return undefined
  const lastChildEnd = replacedEnd === children.length ? lastChild.range.end : lastChild.range.end + syntaxDelta
  const syntax: MarkdownAstNode = {
    ...block,
    range: { start: block.range.start, end: block.range.end + syntaxDelta },
    attributes: {
      ...block.attributes,
      contentStart: contentStart + firstChild.range.start - children[0].range.start,
      contentEnd: contentEnd + lastChildEnd - children[children.length - 1].range.end,
      content: text + contentText.slice(content.text.length)
    },
    children: [
      ...children.slice(0, lines.childrenBefore),
      ...replacement.syntaxBlocks,
      ...children.slice(replacedEnd).map((child) => shiftSyntax(child, syntaxDelta))
    ]
  }
  const after = (position: number): number => position >= span.end ? position + sourceDelta : position
  // A moved root's bindings hold copies of their block, not the one node.
  const sameNode = (node: MarkdownAstNode, other: MarkdownAstNode): boolean => node === other ||
    node.kind === other.kind && node.range.start === other.range.start && node.range.end === other.range.end
  const bindings = rootItems.bindings.map((binding): MuyaMarkupBinding => {
    if (binding !== content) {
      // The fence's info field holds no line; it keeps its place, and the
      // document end it may carry moves with the edit.
      return {
        ...binding,
        ...(sameNode(binding.syntax, block) ? { syntax } : {}),
        ...(binding.documentEnd === undefined
          ? {}
          : { documentEnd: { ...binding.documentEnd, offset: after(binding.documentEnd.offset) } })
      }
    }
    const patched: MuyaMarkupBinding = {
      ...binding,
      text,
      segments,
      syntax,
      sourceRange: {
        start: lines.childrenBefore === 0 ? segments[0]?.source.start ?? binding.sourceRange.start : binding.sourceRange.start,
        end: replacedEnd === children.length ? segments.at(-1)?.source.end ?? after(binding.sourceRange.end) : after(binding.sourceRange.end)
      },
      ...(binding.trailingLinePosition === undefined ? {} : { trailingLinePosition: after(binding.trailingLinePosition) }),
      ...(binding.leadingLinePosition === undefined ? {} : { leadingLinePosition: after(binding.leadingLinePosition) }),
      ...(binding.documentEnd === undefined
        ? {}
        : { documentEnd: { ...binding.documentEnd, offset: after(binding.documentEnd.offset) } }),
      ...(binding.outerBlock === undefined
        ? {}
        : {
          outerBlock: {
            ...binding.outerBlock,
            range: { start: binding.outerBlock.range.start, end: after(binding.outerBlock.range.end) },
            source: binding.outerBlock.source.slice(0, span.start - binding.outerBlock.range.start) +
              lines.source + binding.outerBlock.source.slice(span.end - binding.outerBlock.range.start)
          }
        })
    }
    // The region's lines' snaps are read from its source; the others move.
    // Whitespace before a line's text comes before every container prefix.
    const regionStart = span.start
    const character = (position: number): string => lines.source.charAt(position - regionStart)
    const { caretSnaps: _previousSnaps, ...unsnapped } = patched
    const snaps = muyaCaretSnaps(unsnapped, character, coordinates, new Map(), {
      start: textStart,
      end: textStart + inserted.length
    })
    // A suggestion arm's first line starts before its text, after the
    // arm's opener, so the region reads that line's snap again.
    const read = new Set(snaps.map((snap) => `${snap.at}:${snap.from}:${snap.to}`))
    const kept = (binding.caretSnaps ?? [])
      .filter((snap) => snap.at < span.start || snap.at >= span.end)
      .map((snap) => ({ from: after(snap.from), to: after(snap.to), at: after(snap.at) }))
      .filter((snap) => !read.has(`${snap.at}:${snap.from}:${snap.to}`))
    const whitespace = (snap: MuyaCaretSnap): boolean => snap.at === snap.to
    const ordered = [false, true].flatMap((prefix) => {
      const keptOnes = kept.filter((snap) => whitespace(snap) !== prefix)
      const before = keptOnes.filter((snap) => snap.at < regionStart)
      return [...before, ...snaps.filter((snap) => whitespace(snap) !== prefix), ...keptOnes.slice(before.length)]
    })
    return ordered.length === 0 ? unsnapped : { ...unsnapped, caretSnaps: ordered }
  })
  // The marks on the block's text keep their offsets before the region's
  // lines and move with the text after them.
  const source = armSourcePosition(replacement)
  const textOffset = (offset: number): number | undefined =>
    offset <= textStart ? offset : offset >= textEnd ? offset + textDelta : undefined
  const decorations: MuyaMarkupDecoration[] = []
  for (const decoration of rootItems.decorations) {
    const moved = armDecoration(decoration, root, source,
      decoration.path.length === 2 && decoration.path[1] === 'text' ? textOffset : undefined)
    if (moved === undefined) return undefined
    decorations.push(moved)
  }
  return { root, state: { ...rootState, text }, bindings, decorations }
}

/**
 * The roots around root `root`, which holds a suggestion arm's lines, that
 * mark the suggestions holding those lines: the other arm's root and the
 * root after the suggestion, which shows its end. Undefined when they reach
 * a root before `from`, or more roots than a suggestion of two literal
 * blocks has.
 */
function enclosingRoots(
  roots: MuyaMarkupRoots,
  root: number,
  from: number,
  enclosing: readonly SourceRange[]
): Readonly<{ first: number; last: number }> | undefined {
  let first = root
  let last = root
  for (const held of enclosing) {
    for (const index of roots.sourceRoots(held.start, held.end)) {
      if (!roots.items(index).decorations.some(({ mark: { annotationRange: range } }) =>
        range.start === held.start && range.end === held.end)) continue
      first = Math.min(first, index)
      last = Math.max(last, index)
    }
  }
  if (first < from || last - first > 4) return undefined
  // Each of these roots is listed anew on its own, so none may share its
  // place in the view's list of marks with another.
  for (let index = first; index <= last; index += 1) if (roots.interleaved(index)) return undefined
  return { first, last }
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
    view: Pick<MuyaMarkupView, 'markdown' | 'markdownSegments'>,
    start: number,
    end: number,
    shift: number
  ): void => {
    markdown.push(view.markdown.slice(start, end))
    const segments = view.markdownSegments
    // The first segment that ends after `start`; segments are in text order.
    let first = 0
    let high = segments.length
    while (first < high) {
      const middle = (first + high) >>> 1
      if (segments[middle].text.end <= start) first = middle + 1
      else high = middle
    }
    for (let index = first; index < segments.length && segments[index].text.start < end; index += 1) {
      const segment = segments[index]
      const from = Math.max(start, segment.text.start)
      const to = Math.min(end, segment.text.end)
      if (from >= to) continue
      // A segment kept whole at its place is kept as it is.
      if (shift === 0 && markdownLength === start && from === segment.text.start && to === segment.text.end) {
        appendMuyaMarkdownSegment(markdownSegments, segment)
        continue
      }
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
    if (replacement.literalLines !== undefined) {
      const patched = literalLinesPatch(previous, roots, replacement)
      const from = offset(replacement.previous.syntax.start)
      const to = offset(replacement.previous.syntax.end)
      if (patched === undefined || patched.root < previousIndex || from === undefined || to === undefined ||
          from < markdownIndex) return undefined
      // The suggestion holding an arm's lines also marks the roots of its
      // other arm and the root after it, whose marks move their ends.
      const neighbours = replacement.enclosing === undefined
        ? { first: patched.root, last: patched.root }
        : enclosingRoots(roots, patched.root, previousIndex, replacement.enclosing)
      if (neighbours === undefined || (replacement.enclosing !== undefined && (sourceDelta !== 0 || syntaxDelta !== 0))) {
        return undefined
      }
      const source = armSourcePosition(replacement)
      const retouched = (root: number, nextSource: number, nextSyntax: number): boolean => {
        const placed = state.length
        const decorations: MuyaMarkupDecoration[] = []
        for (const decoration of roots.items(root).decorations) {
          const moved = armDecoration(decoration, placed, source)
          if (moved === undefined) return false
          decorations.push(moved)
        }
        runs.push(createMuyaMarkupRetouchedRootRun(roots, root, placed, nextSource, nextSyntax, decorations))
        state.push(previous.state[root])
        return true
      }
      retainUntil(neighbours.first)
      for (let root = neighbours.first; root < patched.root; root += 1) {
        if (!retouched(root, sourceDelta, syntaxDelta)) return undefined
      }
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
      const local = regionMarkdown(replacement)
      appendMarkdown(local, 0, local.markdown.length, 0)
      markdownIndex = to
      replacedItems = undefined
      sourceDelta = replacement.next.source.end - replacement.previous.source.end
      syntaxDelta = replacement.next.syntax.end - replacement.previous.syntax.end
      for (let root = patched.root + 1; root <= neighbours.last; root += 1) {
        if (!retouched(root, sourceDelta, syntaxDelta)) return undefined
      }
      replacedStart ??= neighbours.first
      replacedEnd = neighbours.last + 1
      previousIndex = neighbours.last + 1
      continue
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
      runs.push(createMuyaMarkupListRootRun(
        placedMuyaMarkupItemGroups(patched.itemGroups, base - patched.root),
        patched.decorations.map((decoration) => placedMuyaMarkupDecoration(decoration, base - patched.root)),
        base,
        patched.extent
      ))
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
      end === previous.state.length
        ? local.state.length
        : muyaRootsOfBlocks(local, replacement.syntaxBlocks.length) ?? replacement.syntaxBlocks.length
    if (local.state.length < localLength) return undefined
    // A suggestion ending past the region's last block is shown on the next
    // block's start, which the whole view reaches and the region's view does
    // not. One ending inside that block is shown there by both.
    if (
      end < previous.state.length &&
      local.decorations.some(
        (decoration) => decoration.exteriorEnd !== undefined && Number(decoration.path[0]) === localLength - 1 &&
          muyaDecorationAfterLastBlock(decoration)
      )
    ) {
      return undefined
    }
    // A suggestion before the region ending past its last text is shown at
    // the region's first block start, which the region's view does not reach;
    // that mark stays where it was.
    const carried: MuyaMarkupDecoration[] = []
    for (let root = start; root < end; root += 1) {
      for (const decoration of roots.items(root).decorations) {
        if (decoration.mark.annotationRange.end > source.start) continue
        if (root !== start || decoration.exteriorEnd === undefined || decoration.range.start !== 0 ||
            decoration.range.end !== 0 || !local.bindings.some((binding) => Number(binding.path[0]) === 0 &&
              binding.path.length === decoration.path.length &&
              binding.path.every((part, index) => index === 0 || part === decoration.path[index]))) return undefined
        carried.push(decoration)
      }
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
            const marked = Number(binding.path[0]) === 0 && carried.some((decoration) =>
              decoration.path.length === binding.path.length &&
              decoration.path.every((part, at) => at === 0 || part === binding.path[at]))
            return {
              ...rest,
              ...(marked ? { annotationContext: true as const } : {}),
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
        decorations: [
          ...carried.map((decoration) => placedMuyaMarkupDecoration(decoration, base - start)),
          ...local.decorations
            .filter((decoration) => Number(decoration.path[0]) < localLength)
            .map((decoration) => placedMuyaMarkupDecoration(decoration, base))
        ],
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
