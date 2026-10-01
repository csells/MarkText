import type { MarkdownAstNode, SourceRange } from '@marktext/document-core'
import type {
  MuyaMarkdownSegment,
  MuyaMarkupBinding,
  MuyaMarkupComment,
  MuyaMarkupDecoration,
  MuyaMarkupState,
  MuyaMarkupView
} from './muyaMarkupView'

/*
 * A regional change replaces a few root blocks of a Markup view and moves
 * every later root by the length the change added. Rather than copy the
 * later roots' items, a view made by such a change holds its roots as runs:
 * each run is a range of roots of an earlier, fully listed view (its base),
 * moved by a source, syntax and root delta. A root's items are moved when
 * first read and kept with their run, which the next view shares unless the
 * run moves again. The view lists all its items only when a reader asks
 * for a whole list; the editor's per-key paths read roots through
 * `muyaMarkupViewLookup`, whose position queries search each base's
 * per-root position hulls instead of every item.
 */

const shiftRange = (range: SourceRange, delta: number): SourceRange => ({
  start: range.start + delta,
  end: range.end + delta
})

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

/** `node` with its offsets and its descendants' moved by `delta`. */
export const shiftSyntax = (node: MarkdownAstNode, delta: number): MarkdownAstNode =>
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

/** One root block's items, in the view's order. */
export interface MuyaMarkupRootItems {
  readonly bindings: readonly MuyaMarkupBinding[]
  readonly decorations: readonly MuyaMarkupDecoration[]
  readonly comments: readonly MuyaMarkupComment[]
}

const itemGroupsByRoot = new WeakMap<MuyaMarkupRootItems, MuyaMarkupItemBindings>()

/**
 * For a list root patched item by item, its bindings read one item at a
 * time; its `bindings` list the same objects.
 */
export const muyaMarkupItemGroups = (items: MuyaMarkupRootItems): MuyaMarkupItemBindings | undefined =>
  itemGroupsByRoot.get(items)

/** A list root's items of one kind by item, read an item at a time. */
export interface MuyaMarkupItemGroups<Item> {
  readonly count: number
  /** Item `item`'s entries, in list order. */
  group(item: number): readonly Item[]
  /** How many item patches lie between these groups and fully listed ones. */
  readonly depth: number
}

/**
 * A list root's bindings by item: group `item` holds, in list order, the
 * bindings under that item (path `[root, 'children', item, ...]`).
 */
export interface MuyaMarkupItemBindings extends MuyaMarkupItemGroups<MuyaMarkupBinding> {
  /**
   * The first binding, in list order, that `reaches` accepts, given that
   * once it accepts a binding it accepts every later one.
   */
  first(reaches: (binding: MuyaMarkupBinding) => boolean): MuyaMarkupBinding | undefined
}

const itemOfPath = (path: readonly (number | string)[]): number | undefined =>
  path[1] === 'children' && typeof path[2] === 'number' ? path[2] : undefined

/** How far later items of a list moved: items later, and source and syntax units. */
export interface MuyaMarkupItemShift {
  readonly items: number
  readonly source: number
  readonly syntax: number
}

/** One item patch: what `patchedListItemGroups` made the groups of from `previous`. */
interface ItemLayer<Item> {
  readonly previous: HeldItemGroups<Item>
  readonly itemsBefore: number
  readonly placed: readonly (readonly Item[])[]
  /** How far the items after the placed ones moved in this patch. */
  readonly shift: MuyaMarkupItemShift
  readonly replacesFirst: boolean
}

interface HeldItemGroups<Item> extends MuyaMarkupItemGroups<Item> {
  /** A group already read, if any. */
  peek(item: number): readonly Item[] | undefined
  readonly layer?: ItemLayer<Item>
}

/** Groups read by `read` when first asked for, then kept. */
function itemGroups<Item>(
  count: number,
  depth: number,
  read: (item: number) => readonly Item[],
  layer?: ItemLayer<Item>
): HeldItemGroups<Item> {
  const made = new Map<number, readonly Item[]>()
  return {
    count,
    depth,
    ...(layer === undefined ? {} : { layer }),
    peek: (item) => made.get(item),
    group(item) {
      if (!Number.isSafeInteger(item) || item < 0 || item >= count) return []
      let entries = made.get(item)
      if (entries === undefined) {
        entries = read(item)
        made.set(item, entries)
      }
      return entries
    }
  }
}

/** `groups` of bindings with `first` found by a search over each item's last binding. */
function itemBindings(groups: MuyaMarkupItemGroups<MuyaMarkupBinding>): MuyaMarkupItemBindings {
  const { count, group } = groups
  return {
    ...groups,
    first(reaches) {
      // The first item whose last binding is accepted holds the answer.
      let low = 0
      let high = count
      while (low < high) {
        const middle = (low + high) >>> 1
        const last = group(middle).at(-1)
        // An item without bindings says nothing; search the rest in order.
        if (last === undefined) {
          for (let item = low; item < high; item += 1) {
            const found = group(item).find(reaches)
            if (found !== undefined) return found
          }
          return undefined
        }
        if (reaches(last)) high = middle
        else low = middle + 1
      }
      return low < count ? group(low).find(reaches) : undefined
    }
  }
}

/**
 * `entries` grouped by the item their path is under, which must not
 * decrease; undefined when one is under no item or out of order.
 */
export function groupListItems<Item extends { readonly path: readonly (number | string)[] }>(
  entries: readonly Item[]
): MuyaMarkupItemGroups<Item> | undefined {
  const groups: Item[][] = []
  for (const entry of entries) {
    const item = itemOfPath(entry.path)
    if (item === undefined || item < groups.length - 1) return undefined
    while (groups.length <= item) groups.push([])
    groups[item].push(entry)
  }
  return itemGroups(groups.length, 0, (item) => groups[item])
}

/** The bindings of a list root grouped by item; undefined if one is under no item. */
export function createListItemBindings(
  bindings: readonly MuyaMarkupBinding[]
): MuyaMarkupItemBindings | undefined {
  const groups = groupListItems(bindings)
  return groups === undefined ? undefined : itemBindings(groups)
}

// Deeper item patches are listed again, so that reading a group walks at most
// this many patches.
const foldedItemDepth = 64

/**
 * `previous` once items `[itemsBefore, after)` became `placed` and the items
 * after them moved by `shift` (whose `items` is `itemsBefore +
 * placed.length - after`). A later item is read from the patch that last
 * placed it or from listed groups and moved once, by `move`, by every shift
 * since. `replaceFirst`, if given, rewrites item `0`'s group.
 */
export function patchedListItemGroups<Item>(
  previous: MuyaMarkupItemGroups<Item>,
  itemsBefore: number,
  after: number,
  placed: readonly (readonly Item[])[],
  shift: Omit<MuyaMarkupItemShift, 'items'>,
  move: (entry: Item, shift: MuyaMarkupItemShift) => Item,
  replaceFirst?: (group: readonly Item[]) => readonly Item[]
): MuyaMarkupItemGroups<Item> {
  const held = previous as HeldItemGroups<Item>
  const layer: ItemLayer<Item> = {
    previous: held,
    itemsBefore,
    placed,
    shift: { items: itemsBefore + placed.length - after, source: shift.source, syntax: shift.syntax },
    replacesFirst: replaceFirst !== undefined
  }
  const moved = (group: readonly Item[], total: MuyaMarkupItemShift): readonly Item[] =>
    total.items === 0 && total.source === 0 && total.syntax === 0
      ? group
      : group.map((entry) => move(entry, total))
  /** Group `item` of `groups`, moved by `total`, reading no patch in between. */
  const later = (groups: HeldItemGroups<Item>, item: number, total: MuyaMarkupItemShift): readonly Item[] => {
    for (;;) {
      const read = groups.peek(item)
      const step = groups.layer
      if (read !== undefined || step === undefined || (item === 0 && step.replacesFirst)) {
        return moved(read ?? groups.group(item), total)
      }
      if (item < step.itemsBefore) {
        groups = step.previous
        continue
      }
      if (item < step.itemsBefore + step.placed.length) return moved(step.placed[item - step.itemsBefore], total)
      total = {
        items: total.items + step.shift.items,
        source: total.source + step.shift.source,
        syntax: total.syntax + step.shift.syntax
      }
      item -= step.shift.items
      groups = step.previous
    }
  }
  const read = (item: number): readonly Item[] => {
    const group = item < itemsBefore
      ? previous.group(item)
      : item < itemsBefore + placed.length
        ? placed[item - itemsBefore]
        : later(held, item - layer.shift.items, layer.shift)
    return item === 0 && replaceFirst !== undefined ? replaceFirst(group) : group
  }
  const count = previous.count + layer.shift.items
  const patched = itemGroups(count, previous.depth + 1, read, layer)
  if (patched.depth <= foldedItemDepth) return patched
  const listed: (readonly Item[])[] = []
  for (let item = 0; item < count; item += 1) listed.push(patched.group(item))
  return itemGroups(count, 0, (item) => listed[item])
}

/** Item bindings patched as `patchedListItemGroups` patches any item groups. */
export function patchedListItemBindings(
  previous: MuyaMarkupItemBindings,
  itemsBefore: number,
  after: number,
  placed: readonly (readonly MuyaMarkupBinding[])[],
  sourceDelta: number,
  syntaxDelta: number,
  replaceFirst: (group: readonly MuyaMarkupBinding[]) => readonly MuyaMarkupBinding[]
): MuyaMarkupItemBindings {
  return itemBindings(patchedListItemGroups(previous, itemsBefore, after, placed,
    { source: sourceDelta, syntax: syntaxDelta },
    (binding, shift) => placedMuyaMarkupItemBinding(binding, 0, shift.items, shift.source, shift.syntax),
    replaceFirst))
}

/** Every entry of `groups`, in list order. */
export function listedItemGroups<Item>(groups: MuyaMarkupItemGroups<Item>): readonly Item[] {
  const entries: Item[] = []
  for (let item = 0; item < groups.count; item += 1) entries.push(...groups.group(item))
  return entries
}

/** `groups` of a root placed `pathDelta` roots later, its text moved by the deltas. */
function movedItemBindings(
  groups: MuyaMarkupItemBindings,
  pathDelta: number,
  sourceDelta: number,
  syntaxDelta: number
): MuyaMarkupItemBindings {
  return itemBindings(itemGroups(groups.count, groups.depth, (item) =>
    groups.group(item).map((binding) => movedBinding(binding, pathDelta, sourceDelta, syntaxDelta))))
}

/** `groups` of a list root placed `pathDelta` roots later. */
export const placedMuyaMarkupItemGroups = (
  groups: MuyaMarkupItemBindings,
  pathDelta: number
): MuyaMarkupItemBindings => pathDelta === 0 ? groups : movedItemBindings(groups, pathDelta, 0, 0)

const noBindings: readonly MuyaMarkupBinding[] = Object.freeze([])
const noDecorations: readonly MuyaMarkupDecoration[] = Object.freeze([])
const noComments: readonly MuyaMarkupComment[] = Object.freeze([])

/**
 * Closed intervals, one per root, searched for the roots whose interval
 * meets a query interval. A root that holds no position meets nothing.
 */
interface RootIntervals {
  /** Roots in `[from, to)` whose interval meets `[low, high]`, ascending. */
  meeting(from: number, to: number, low: number, high: number): Generator<number>
  /** Root `index`'s own interval. */
  interval(index: number): readonly [number, number]
}

function createRootIntervals(lows: readonly number[], highs: readonly number[]): RootIntervals {
  let size = 1
  while (size < lows.length) size *= 2
  // A complete binary tree over the roots: node `n` has children `2n` and
  // `2n + 1`, leaves start at `size`, and each node holds the lowest start
  // and highest end below it.
  const low = new Float64Array(2 * size).fill(Infinity)
  const high = new Float64Array(2 * size).fill(-Infinity)
  for (let index = 0; index < lows.length; index += 1) {
    low[size + index] = lows[index]
    high[size + index] = highs[index]
  }
  for (let node = size - 1; node > 0; node -= 1) {
    low[node] = Math.min(low[2 * node], low[2 * node + 1])
    high[node] = Math.max(high[2 * node], high[2 * node + 1])
  }
  return {
    interval: (index) => [low[size + index], high[size + index]],
    * meeting(from, to, queryLow, queryHigh) {
      // Triples of node, first leaf, end leaf; the left child is taken first.
      const pending = [1, 0, size]
      while (pending.length > 0) {
        const end = pending.pop() as number
        const start = pending.pop() as number
        const node = pending.pop() as number
        if (end <= from || start >= to || low[node] > queryHigh || high[node] < queryLow) continue
        if (node >= size) {
          yield start
          continue
        }
        const middle = (start + end) >>> 1
        pending.push(2 * node + 1, middle, end, 2 * node, start, middle)
      }
    }
  }
}

/**
 * The lowest and highest source positions a root's items hold or compare
 * with: a caret, selection or annotation position outside them is in none
 * of its items.
 */
function sourceHull(items: MuyaMarkupRootItems): readonly [number, number] {
  let low = Infinity
  let high = -Infinity
  const see = (position: number | undefined): void => {
    if (position === undefined) return
    if (position < low) low = position
    if (position > high) high = position
  }
  const seeRange = (range: SourceRange | undefined): void => {
    see(range?.start)
    see(range?.end)
  }
  for (const binding of items.bindings) {
    seeRange(binding.sourceRange)
    see(binding.sourceRange.end + (binding.blankLineText?.length ?? 0))
    for (const segment of binding.segments) seeRange(segment.source)
    seeRange(binding.tableCell?.table)
    seeRange(binding.tableCellContent)
    if (binding.tableCellContent !== undefined) {
      see(binding.tableCellContent.end + (binding.tableCellPadding ?? 0))
    }
    see(binding.documentEnd?.offset)
    see(binding.paragraphPrefixPosition)
    seeRange(binding.containerPrefix?.range)
    seeRange(binding.outerBlock?.range)
    seeRange(binding.sourceStructure?.range)
    see(binding.trailingLinePosition)
    see(binding.leadingLinePosition)
    if (binding.leadingLinePosition !== undefined) {
      see(binding.leadingLinePosition - (binding.leadingLineText?.length ?? 0))
    }
    if (binding.markerLine !== undefined) {
      const line = binding.markerLine
      see(line.start)
      see(line.end)
      see(line.content)
      see(line.start + line.text.length)
    }
    for (const snap of binding.caretSnaps ?? []) {
      see(snap.from)
      see(snap.to)
      see(snap.at)
    }
  }
  for (const decoration of items.decorations) {
    seeRange(decoration.mark.annotationRange)
    see(decoration.sourcePosition)
    see(decoration.exteriorEnd)
  }
  for (const comment of items.comments) seeRange(comment.annotationRange)
  return [low, high]
}

/** The lowest and highest editing-syntax positions of a root's bindings. */
function syntaxHull(items: MuyaMarkupRootItems): readonly [number, number] {
  let low = Infinity
  let high = -Infinity
  for (const binding of items.bindings) {
    low = Math.min(low, binding.syntax.range.start)
    high = Math.max(high, binding.syntax.range.end)
  }
  return [low, high]
}

/**
 * A list whose items are not in root order, such as the decorations of a
 * suggestion that spans paragraphs, listed mark by mark: the list, and the
 * index of each of its items among its root's items.
 */
interface ListOrder<Item> {
  readonly list: readonly Item[]
  readonly slots: readonly number[]
}

/** Fully listed roots that runs refer to; never changed once made. */
interface RootBase {
  /** The root index, in the view the base was taken from, of its first root. */
  readonly first: number
  readonly roots: readonly MuyaMarkupRootItems[]
  readonly source: RootIntervals
  readonly syntax: RootIntervals
  /** Editable bindings in the base's roots before each root index, and in all. */
  readonly editableBefore: readonly number[]
  readonly decorationOrder?: ListOrder<MuyaMarkupDecoration>
  readonly commentOrder?: ListOrder<MuyaMarkupComment>
}

type ItemLists = Pick<MuyaMarkupView, 'bindings' | 'decorations' | 'comments'>

const rootOf = (item: { readonly path: readonly (number | string)[] }): number => {
  const root = item.path[0]
  return typeof root === 'number' ? root : Number.NaN
}

/**
 * Items of `list` by root `[first, first + count)`, each root's in list
 * order, with the list's order when it is not root order. Undefined when an
 * item belongs to no such root.
 */
function groupByRoot<Item extends { readonly path: readonly (number | string)[] }>(
  list: readonly Item[],
  first: number,
  count: number,
  none: readonly Item[]
): { groups: (readonly Item[])[]; order?: ListOrder<Item> } | undefined {
  const groups: (readonly Item[])[] = []
  for (let index = 0; index < count; index += 1) groups.push(none)
  let ordered = true
  let previous = first
  for (const item of list) {
    const root = rootOf(item)
    if (!Number.isSafeInteger(root) || root < first || root >= first + count) return undefined
    if (root < previous) ordered = false
    previous = root
  }
  if (ordered) {
    let start = 0
    while (start < list.length) {
      const root = rootOf(list[start])
      let end = start + 1
      while (end < list.length && rootOf(list[end]) === root) end += 1
      groups[root - first] = list.slice(start, end)
      start = end
    }
    return { groups }
  }
  const slots: number[] = []
  const buckets = new Map<number, Item[]>()
  for (const item of list) {
    const root = rootOf(item) - first
    let bucket = buckets.get(root)
    if (bucket === undefined) buckets.set(root, (bucket = []))
    slots.push(bucket.length)
    bucket.push(item)
  }
  for (const [root, bucket] of buckets) groups[root] = bucket
  return { groups, order: { list, slots } }
}

/**
 * Groups the items of roots `[first, first + count)` listed by `lists`.
 * Undefined unless every item belongs to one of those roots and the bindings
 * are in root order.
 */
function createRootBase(lists: ItemLists, first: number, count: number): RootBase | undefined {
  const bindings = groupByRoot(lists.bindings, first, count, noBindings)
  const decorations = groupByRoot(lists.decorations, first, count, noDecorations)
  const comments = groupByRoot(lists.comments, first, count, noComments)
  if (
    bindings === undefined ||
    bindings.order !== undefined ||
    decorations === undefined ||
    comments === undefined
  ) {
    return undefined
  }
  const roots: MuyaMarkupRootItems[] = []
  const lows: number[] = []
  const highs: number[] = []
  const syntaxLows: number[] = []
  const syntaxHighs: number[] = []
  const editableBefore = [0]
  for (let index = 0; index < count; index += 1) {
    const items: MuyaMarkupRootItems = {
      bindings: bindings.groups[index],
      decorations: decorations.groups[index],
      comments: comments.groups[index]
    }
    roots.push(items)
    const [low, high] = sourceHull(items)
    lows.push(low)
    highs.push(high)
    const [syntaxLow, syntaxHigh] = syntaxHull(items)
    syntaxLows.push(syntaxLow)
    syntaxHighs.push(syntaxHigh)
    let editable = 0
    for (const binding of items.bindings) if (binding.editable !== false) editable += 1
    editableBefore.push(editableBefore[index] + editable)
  }
  return {
    first,
    roots,
    source: createRootIntervals(lows, highs),
    syntax: createRootIntervals(syntaxLows, syntaxHighs),
    editableBefore,
    ...(decorations.order === undefined ? {} : { decorationOrder: decorations.order }),
    ...(comments.order === undefined ? {} : { commentOrder: comments.order })
  }
}

/**
 * `base` moved like `movedBinding` moves one binding. Each kind moves when it
 * is first read, so checking a long list's decorations or comments does not
 * move its bindings.
 */
function movedRootItems(
  base: MuyaMarkupRootItems,
  pathDelta: number,
  sourceDelta: number,
  syntaxDelta: number
): MuyaMarkupRootItems {
  const positioned = pathDelta !== 0 || sourceDelta !== 0
  let bindings: readonly MuyaMarkupBinding[] | undefined
  let decorations: readonly MuyaMarkupDecoration[] | undefined
  let comments: readonly MuyaMarkupComment[] | undefined
  const baseGroups = itemGroupsByRoot.get(base)
  const itemGroups = baseGroups === undefined
    ? undefined
    : movedItemBindings(baseGroups, pathDelta, sourceDelta, syntaxDelta)
  const moved: MuyaMarkupRootItems = {
    get bindings() {
      bindings ??= itemGroups === undefined
        ? base.bindings.map((binding) => movedBinding(binding, pathDelta, sourceDelta, syntaxDelta))
        : listedItemGroups(itemGroups)
      return bindings
    },
    get decorations() {
      decorations ??= positioned
        ? base.decorations.map((decoration) => movedDecoration(decoration, pathDelta, sourceDelta))
        : base.decorations
      return decorations
    },
    get comments() {
      comments ??= positioned
        ? base.comments.map((comment) => movedComment(comment, pathDelta, sourceDelta))
        : base.comments
      return comments
    }
  }
  if (itemGroups !== undefined) itemGroupsByRoot.set(moved, itemGroups)
  return moved
}

/** Roots `[start, end)` of a view: base roots from `baseStart` on, moved. */
interface RootRun {
  readonly start: number
  readonly end: number
  readonly base: RootBase
  /** Index in `base.roots` of the run's first root. */
  readonly baseStart: number
  readonly sourceDelta: number
  readonly syntaxDelta: number
  /** Moved items of roots already read, by root. */
  readonly made: Map<number, MuyaMarkupRootItems>
}

/** What a root's items hold, without reading them. */
export interface MuyaMarkupRootExtent {
  readonly source: readonly [number, number]
  readonly syntax: readonly [number, number]
  readonly editable: number
}

/** A view's roots and their items, read one root at a time. */
export interface MuyaMarkupRoots {
  readonly count: number
  items(root: number): MuyaMarkupRootItems
  /**
   * Binding `index` of `root`, moved on its own: equal to, but not the same
   * object as, that entry of `items(root).bindings`.
   */
  bindingAt(root: number, index: number): MuyaMarkupBinding | undefined
  /**
   * The source and editing-syntax positions root `root`'s items can hold, as
   * for `sourceRoots` and `syntaxRoots`, and how many of its bindings are
   * editable.
   */
  extent(root: number): MuyaMarkupRootExtent
  /**
   * Roots, ascending, that can hold an item at a source position in
   * `[low, high]`; every other root holds none.
   */
  sourceRoots(low: number, high: number): Iterable<number>
  /** Roots, ascending, whose bindings can reach editing-syntax `[low, high]`. */
  syntaxRoots(low: number, high: number): Iterable<number>
  editableCount(): number
  /** The view's whole list of one kind, made on first request. */
  list<Kind extends keyof MuyaMarkupRootItems>(kind: Kind): MuyaMarkupRootItems[Kind]
  /**
   * Runs holding roots `[from, to)` of this view as roots from `start` on
   * of a view whose text before them changed length by the deltas.
   */
  moved(
    from: number,
    to: number,
    start: number,
    sourceDelta: number,
    syntaxDelta: number
  ): RootRun[]
}

// More runs than this are folded into one base, so that searches stay short
// however many places of a document are edited.
const foldedRunCount = 64

function createRoots(runs: readonly RootRun[], count: number): MuyaMarkupRoots {
  const runAt = (root: number): RootRun => {
    let low = 0
    let high = runs.length - 1
    while (low < high) {
      const middle = (low + high + 1) >>> 1
      if (runs[middle].start <= root) low = middle
      else high = middle - 1
    }
    return runs[low]
  }
  const lists: Partial<{ -readonly [Kind in keyof MuyaMarkupRootItems]: MuyaMarkupRootItems[Kind] }> = {}
  const roots: MuyaMarkupRoots = {
    count,
    items(root) {
      if (!Number.isSafeInteger(root) || root < 0 || root >= count) {
        return { bindings: noBindings, decorations: noDecorations, comments: noComments }
      }
      const run = runAt(root)
      let items = run.made.get(root)
      if (items === undefined) {
        const base = run.base.roots[run.baseStart + root - run.start]
        const pathDelta = run.start - run.base.first - run.baseStart
        const { sourceDelta, syntaxDelta } = run
        items =
          pathDelta === 0 && sourceDelta === 0 && syntaxDelta === 0
            ? base
            : movedRootItems(base, pathDelta, sourceDelta, syntaxDelta)
        run.made.set(root, items)
      }
      return items
    },
    bindingAt(root, index) {
      if (!Number.isSafeInteger(root) || root < 0 || root >= count) return undefined
      const run = runAt(root)
      const binding = run.base.roots[run.baseStart + root - run.start].bindings[index]
      const pathDelta = run.start - run.base.first - run.baseStart
      return binding === undefined || (pathDelta === 0 && run.sourceDelta === 0 && run.syntaxDelta === 0)
        ? binding
        : movedBinding(binding, pathDelta, run.sourceDelta, run.syntaxDelta)
    },
    extent(root) {
      const run = runAt(root)
      const index = run.baseStart + root - run.start
      const [low, high] = run.base.source.interval(index)
      const [syntaxLow, syntaxHigh] = run.base.syntax.interval(index)
      return {
        source: [low + run.sourceDelta, high + run.sourceDelta],
        syntax: [syntaxLow + run.syntaxDelta, syntaxHigh + run.syntaxDelta],
        editable: run.base.editableBefore[index + 1] - run.base.editableBefore[index]
      }
    },
    * sourceRoots(low, high) {
      for (const run of runs) {
        const shift = run.start - run.baseStart
        for (const index of run.base.source.meeting(
          run.baseStart,
          run.baseStart + run.end - run.start,
          low - run.sourceDelta,
          high - run.sourceDelta
        )) {
          yield index + shift
        }
      }
    },
    * syntaxRoots(low, high) {
      for (const run of runs) {
        const shift = run.start - run.baseStart
        for (const index of run.base.syntax.meeting(
          run.baseStart,
          run.baseStart + run.end - run.start,
          low - run.syntaxDelta,
          high - run.syntaxDelta
        )) {
          yield index + shift
        }
      }
    },
    editableCount() {
      let editable = 0
      for (const run of runs) {
        editable +=
          run.base.editableBefore[run.baseStart + run.end - run.start] -
          run.base.editableBefore[run.baseStart]
      }
      return editable
    },
    list(kind) {
      let list = lists[kind]
      if (list === undefined) {
        const items: MuyaMarkupRootItems[typeof kind][number][] = []
        for (const run of runs) {
          const order =
            kind === 'decorations'
              ? run.base.decorationOrder
              : kind === 'comments'
                ? run.base.commentOrder
                : undefined
          const shift = run.start - run.base.first - run.baseStart
          if (order === undefined) {
            for (let root = run.start; root < run.end; root += 1) {
              items.push(...roots.items(root)[kind])
            }
            continue
          }
          // The base's own order, restricted to the run's roots.
          for (let index = 0; index < order.list.length; index += 1) {
            const root = rootOf(order.list[index]) + shift
            if (root < run.start || root >= run.end) continue
            items.push(roots.items(root)[kind][order.slots[index]])
          }
        }
        list = items as MuyaMarkupRootItems[typeof kind]
        lists[kind] = list
      }
      return list as MuyaMarkupRootItems[typeof kind]
    },
    moved(from, to, start, sourceDelta, syntaxDelta) {
      const moved: RootRun[] = []
      for (const run of runs) {
        const first = Math.max(run.start, from)
        const end = Math.min(run.end, to)
        if (first >= end) continue
        const still = start === from && sourceDelta === 0 && syntaxDelta === 0
        if (still && first === run.start && end === run.end) {
          moved.push(run)
          continue
        }
        const made = new Map<number, MuyaMarkupRootItems>()
        if (still) {
          for (const [root, items] of run.made) if (root >= first && root < end) made.set(root, items)
        }
        moved.push({
          start: first + start - from,
          end: end + start - from,
          base: run.base,
          baseStart: run.baseStart + first - run.start,
          sourceDelta: run.sourceDelta + sourceDelta,
          syntaxDelta: run.syntaxDelta + syntaxDelta,
          made
        })
      }
      return moved
    }
  }
  return roots
}

const rootsByView = new WeakMap<object, MuyaMarkupRoots>()

/** The roots of a view made from runs, or of a listed view already grouped. */
export const muyaMarkupRootsOf = (view: object): MuyaMarkupRoots | undefined =>
  rootsByView.get(view)

/**
 * The roots of `view`, grouping a fully listed view's items on first use.
 * Undefined when its lists are not in root order within its root blocks.
 */
export function muyaMarkupRootsFor(view: MuyaMarkupView): MuyaMarkupRoots | undefined {
  let roots = rootsByView.get(view)
  if (roots === undefined) {
    const base = createRootBase(view, 0, view.state.length)
    if (base === undefined) return undefined
    roots = createRoots(
      [{ start: 0, end: view.state.length, base, baseStart: 0, sourceDelta: 0, syntaxDelta: 0, made: new Map() }],
      view.state.length
    )
    rootsByView.set(view, roots)
  }
  return roots
}

/** A run of roots `[first, first + count)` listed by `lists`, if they are in root order. */
export function createMuyaMarkupRootRun(
  lists: ItemLists,
  first: number,
  count: number
): RootRun | undefined {
  const base = createRootBase(lists, first, count)
  return base === undefined
    ? undefined
    : { start: first, end: first + count, base, baseStart: 0, sourceDelta: 0, syntaxDelta: 0, made: new Map() }
}

/**
 * A run of the one list root `first` whose bindings are `itemGroups`, whose
 * items hold at most `extent`: its items are not read to make it.
 */
export function createMuyaMarkupListRootRun(
  itemGroups: MuyaMarkupItemBindings,
  decorations: readonly MuyaMarkupDecoration[],
  first: number,
  extent: MuyaMarkupRootExtent
): RootRun {
  let bindings: readonly MuyaMarkupBinding[] | undefined
  const items: MuyaMarkupRootItems = {
    get bindings() {
      bindings ??= listedItemGroups(itemGroups)
      return bindings
    },
    decorations,
    comments: noComments
  }
  itemGroupsByRoot.set(items, itemGroups)
  const base: RootBase = {
    first,
    roots: [items],
    source: createRootIntervals([extent.source[0]], [extent.source[1]]),
    syntax: createRootIntervals([extent.syntax[0]], [extent.syntax[1]]),
    editableBefore: [0, extent.editable]
  }
  return { start: first, end: first + 1, base, baseStart: 0, sourceDelta: 0, syntaxDelta: 0, made: new Map() }
}

/** The positions `items` hold, as `extent` reports them for a root. */
export function muyaMarkupItemsExtent(items: ItemLists): MuyaMarkupRootExtent {
  const rootItems = { bindings: items.bindings, decorations: items.decorations, comments: items.comments }
  let editable = 0
  for (const binding of items.bindings) if (binding.editable !== false) editable += 1
  return { source: sourceHull(rootItems), syntax: syntaxHull(rootItems), editable }
}

export type { RootRun as MuyaMarkupRootRun }

/** `binding` of a view made for other roots, placed `pathDelta` roots later. */
export const placedMuyaMarkupBinding = (binding: MuyaMarkupBinding, pathDelta: number): MuyaMarkupBinding =>
  movedBinding(binding, pathDelta, 0, 0)

/** `path` with its item in its root's list moved `itemDelta` items later. */
const shiftedItemPath = (path: readonly (number | string)[], itemDelta: number): (number | string)[] =>
  itemDelta !== 0 && path[1] === 'children' && typeof path[2] === 'number'
    ? [path[0], 'children', path[2] + itemDelta, ...path.slice(3)]
    : [...path]

/**
 * `binding` of an item of a list root, placed `rootDelta` roots and
 * `itemDelta` items later once the text before it changed length by
 * `sourceDelta` source units (`syntaxDelta` in editing syntax).
 */
export function placedMuyaMarkupItemBinding(
  binding: MuyaMarkupBinding,
  rootDelta: number,
  itemDelta: number,
  sourceDelta: number,
  syntaxDelta: number
): MuyaMarkupBinding {
  const moved: Mutable<MuyaMarkupBinding> = { ...movedBinding(binding, rootDelta, sourceDelta, syntaxDelta) }
  if (itemDelta === 0) return moved
  moved.path = shiftedItemPath(moved.path, itemDelta)
  if (moved.markerLine !== undefined) {
    moved.markerLine = { ...moved.markerLine, statePath: shiftedItemPath(moved.markerLine.statePath, itemDelta) }
  }
  if (moved.sourceStructure !== undefined) {
    moved.sourceStructure = {
      ...moved.sourceStructure,
      nodes: moved.sourceStructure.nodes.map((node) => ({ ...node, path: shiftedItemPath(node.path, itemDelta) }))
    }
  }
  return moved
}

/**
 * `decoration` of an item of a list root, placed `rootDelta` roots and
 * `itemDelta` items later once the text before it changed length by
 * `sourceDelta` source units.
 */
export function placedMuyaMarkupItemDecoration(
  decoration: MuyaMarkupDecoration,
  rootDelta: number,
  itemDelta: number,
  sourceDelta: number
): MuyaMarkupDecoration {
  const moved = movedDecoration(decoration, rootDelta, sourceDelta)
  return itemDelta === 0 ? moved : { ...moved, path: shiftedItemPath(moved.path, itemDelta) }
}

/** `decoration` of a view made for other roots, placed `pathDelta` roots later. */
export const placedMuyaMarkupDecoration = (
  decoration: MuyaMarkupDecoration,
  pathDelta: number
): MuyaMarkupDecoration => movedDecoration(decoration, pathDelta, 0)

/**
 * A view whose roots are `runs`, which cover roots `[0, state.length)` in
 * order. Its item lists are made when first read.
 */
export function createRunMuyaMarkupView(
  parts: Readonly<{
    markdown: string
    markdownSegments: readonly MuyaMarkdownSegment[]
    state: readonly MuyaMarkupState[]
  }>,
  runs: readonly RootRun[]
): MuyaMarkupView {
  let roots = createRoots(runs, parts.state.length)
  if (runs.length > foldedRunCount) {
    const base = createRootBase(
      { bindings: roots.list('bindings'), decorations: roots.list('decorations'), comments: roots.list('comments') },
      0,
      parts.state.length
    )
    if (base !== undefined) {
      roots = createRoots(
        [{ start: 0, end: parts.state.length, base, baseStart: 0, sourceDelta: 0, syntaxDelta: 0, made: new Map() }],
        parts.state.length
      )
    }
  }
  const view: MuyaMarkupView = {
    kind: 'view',
    markdown: parts.markdown,
    markdownSegments: parts.markdownSegments,
    state: parts.state,
    get bindings() {
      return roots.list('bindings')
    },
    get decorations() {
      return roots.list('decorations')
    },
    get comments() {
      return roots.list('comments')
    }
  }
  rootsByView.set(view, roots)
  return view
}
