import type { MuyaMarkupBinding, MuyaMarkupPath, MuyaMarkupView } from './muyaMarkupView'
import { muyaMarkupRootsOf, type MuyaMarkupRootItems } from './muyaMarkupViewRoots'

/**
 * Items of a view list, such as its bindings or decorations, that belong to
 * the root block `path[0]` holds, found without scanning the whole list.
 * Views list items in root order; a list out of that order is scanned.
 */
const ordered = new WeakMap<readonly unknown[], boolean>()

const rootOf = (item: { readonly path: MuyaMarkupPath }): number => {
  const root = item.path[0]
  return typeof root === 'number' ? root : Number.NaN
}

function inRootOrder(items: readonly { readonly path: MuyaMarkupPath }[]): boolean {
  let result = ordered.get(items)
  if (result === undefined) {
    result = true
    for (let index = 1; index < items.length; index += 1) {
      if (!(rootOf(items[index - 1]) <= rootOf(items[index]))) {
        result = false
        break
      }
    }
    ordered.set(items, result)
  }
  return result
}

/** The items whose path starts at root `root`, in list order. */
export function muyaItemsAtRoot<Item extends { readonly path: MuyaMarkupPath }>(
  items: readonly Item[],
  root: number
): readonly Item[] {
  if (!inRootOrder(items)) return items.filter((item) => rootOf(item) === root)
  let low = 0
  let high = items.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (rootOf(items[middle]) < root) low = middle + 1
    else high = middle
  }
  let end = low
  while (end < items.length && rootOf(items[end]) === root) end += 1
  return items.slice(low, end)
}

/** The items whose path starts at a root in `[start, end)`, in list order. */
export function muyaItemsInRoots<Item extends { readonly path: MuyaMarkupPath }>(
  items: readonly Item[],
  start: number,
  end: number
): readonly Item[] {
  if (!inRootOrder(items)) {
    return items.filter((item) => rootOf(item) >= start && rootOf(item) < end)
  }
  const first = (root: number): number => {
    let low = 0
    let high = items.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (rootOf(items[middle]) < root) low = middle + 1
      else high = middle
    }
    return low
  }
  return items.slice(first(start), first(end))
}

const samePath = (left: MuyaMarkupPath, right: MuyaMarkupPath): boolean =>
  left.length === right.length && left.every((part, index) => part === right[index])

/** The items at exactly `path`, in list order. */
export function muyaItemsAtPath<Item extends { readonly path: MuyaMarkupPath }>(
  items: readonly Item[],
  path: MuyaMarkupPath
): Item[] {
  const root = path[0]
  const candidates =
    typeof root === 'number' ? muyaItemsAtRoot(items, root) : items
  return candidates.filter((item) => samePath(item.path, path))
}

/** The first item at exactly `path`. */
export function muyaItemAtPath<Item extends { readonly path: MuyaMarkupPath }>(
  items: readonly Item[],
  path: MuyaMarkupPath
): Item | undefined {
  const root = path[0]
  const candidates =
    typeof root === 'number' ? muyaItemsAtRoot(items, root) : items
  return candidates.find((item) => samePath(item.path, path))
}

/*
 * The queries below read a view one root at a time. A view made by a
 * regional change holds later roots unmoved until they are read, so the
 * editor's per-key paths use these instead of its whole lists; a fully
 * listed view answers them from its lists as the functions above do.
 */

type ViewLists = Pick<MuyaMarkupView, 'bindings' | 'decorations' | 'comments'>
type ViewItem<Kind extends keyof MuyaMarkupRootItems> = MuyaMarkupRootItems[Kind][number]

/** The view's items of one kind at root `root`, in list order. */
export function muyaViewItemsAtRoot<Kind extends keyof MuyaMarkupRootItems>(
  view: Pick<MuyaMarkupRootItems, Kind>,
  kind: Kind,
  root: number
): readonly ViewItem<Kind>[] {
  const roots = muyaMarkupRootsOf(view)
  return roots === undefined
    ? muyaItemsAtRoot<ViewItem<Kind>>(view[kind], root)
    : roots.items(root)[kind]
}

/** The view's items of one kind at exactly `path`, in list order. */
export function muyaViewItemsAtPath<Kind extends keyof MuyaMarkupRootItems>(
  view: Pick<MuyaMarkupRootItems, Kind>,
  kind: Kind,
  path: MuyaMarkupPath
): ViewItem<Kind>[] {
  const roots = muyaMarkupRootsOf(view)
  if (roots === undefined) return muyaItemsAtPath<ViewItem<Kind>>(view[kind], path)
  // Every item of such a view belongs to a root block.
  const root = path[0]
  return typeof root === 'number'
    ? (roots.items(root)[kind] as readonly ViewItem<Kind>[]).filter((item) =>
      samePath(item.path, path)
    )
    : []
}

/** The view's first item of one kind at exactly `path`. */
export function muyaViewItemAtPath<Kind extends keyof MuyaMarkupRootItems>(
  view: Pick<MuyaMarkupRootItems, Kind>,
  kind: Kind,
  path: MuyaMarkupPath
): ViewItem<Kind> | undefined {
  const roots = muyaMarkupRootsOf(view)
  if (roots === undefined) return muyaItemAtPath<ViewItem<Kind>>(view[kind], path)
  const root = path[0]
  return typeof root === 'number'
    ? (roots.items(root)[kind] as readonly ViewItem<Kind>[]).find((item) =>
      samePath(item.path, path)
    )
    : undefined
}

/** The view's bindings of roots `[start, end)`, in list order. */
export function muyaViewBindingsInRoots(
  view: Pick<ViewLists, 'bindings'>,
  start: number,
  end: number
): readonly MuyaMarkupBinding[] {
  const roots = muyaMarkupRootsOf(view)
  if (roots === undefined) return muyaItemsInRoots(view.bindings, start, end)
  const bindings: MuyaMarkupBinding[] = []
  for (let root = Math.max(0, start); root < Math.min(end, roots.count); root += 1) {
    bindings.push(...roots.items(root).bindings)
  }
  return bindings
}

/**
 * The view's bindings, in list order, of every root whose items can hold a
 * source position in `[low, high]`. A binding of any other root, and its
 * decorations and comments, hold no such position and compare none with it,
 * so a search for one may read only these.
 */
export function * muyaViewBindingsNear(
  view: Pick<ViewLists, 'bindings'>,
  low: number,
  high = low
): Generator<MuyaMarkupBinding> {
  const roots = muyaMarkupRootsOf(view)
  if (roots === undefined) {
    yield * view.bindings
    return
  }
  for (const root of roots.sourceRoots(low, high)) yield * roots.items(root).bindings
}

/** The view's last binding. */
export function muyaViewLastBinding(view: Pick<ViewLists, 'bindings'>): MuyaMarkupBinding | undefined {
  const roots = muyaMarkupRootsOf(view)
  if (roots === undefined) return view.bindings.at(-1)
  for (let root = roots.count - 1; root >= 0; root -= 1) {
    const binding = roots.items(root).bindings.at(-1)
    if (binding !== undefined) return binding
  }
  return undefined
}

/** The binding listed just before `binding`, which the view lists. */
export function muyaViewPreviousBinding(
  view: Pick<ViewLists, 'bindings'>,
  binding: MuyaMarkupBinding
): MuyaMarkupBinding | undefined {
  const roots = muyaMarkupRootsOf(view)
  if (roots === undefined) return view.bindings[view.bindings.indexOf(binding) - 1]
  const root = binding.path[0]
  if (typeof root !== 'number') return undefined
  const index = roots.items(root).bindings.indexOf(binding)
  if (index < 0) return undefined
  if (index > 0) return roots.items(root).bindings[index - 1]
  for (let before = root - 1; before >= 0; before -= 1) {
    const previous = roots.items(before).bindings.at(-1)
    if (previous !== undefined) return previous
  }
  return undefined
}

/** Whether the view lists `left` before `right`; both must be its bindings. */
export function muyaViewBindingPrecedes(
  view: Pick<ViewLists, 'bindings'>,
  left: MuyaMarkupBinding,
  right: MuyaMarkupBinding
): boolean {
  const roots = muyaMarkupRootsOf(view)
  if (roots === undefined) return view.bindings.indexOf(left) < view.bindings.indexOf(right)
  const leftRoot = Number(left.path[0])
  const rightRoot = Number(right.path[0])
  return leftRoot !== rightRoot
    ? leftRoot < rightRoot
    : roots.items(leftRoot).bindings.indexOf(left) < roots.items(rightRoot).bindings.indexOf(right)
}

/** The view's first binding. */
export function muyaViewFirstBinding(view: Pick<ViewLists, 'bindings'>): MuyaMarkupBinding | undefined {
  const roots = muyaMarkupRootsOf(view)
  if (roots === undefined) return view.bindings[0]
  for (let root = 0; root < roots.count; root += 1) {
    const binding = roots.items(root).bindings[0]
    if (binding !== undefined) return binding
  }
  return undefined
}

/** The number of the view's bindings that are editable. */
export function muyaViewEditableCount(view: Pick<ViewLists, 'bindings'>): number {
  const roots = muyaMarkupRootsOf(view)
  if (roots !== undefined) return roots.editableCount()
  let editable = 0
  for (const binding of view.bindings) if (binding.editable !== false) editable += 1
  return editable
}

/**
 * The first item of one kind, in list order, at a root that can hold a source
 * position in `[low, high]`, that `predicate` accepts. The predicate must
 * accept only items that hold or compare with such a position.
 */
export function muyaViewFindNear<Kind extends keyof MuyaMarkupRootItems>(
  view: Pick<MuyaMarkupRootItems, Kind>,
  kind: Kind,
  low: number,
  high: number,
  predicate: (item: ViewItem<Kind>) => boolean
): ViewItem<Kind> | undefined {
  const roots = muyaMarkupRootsOf(view)
  if (roots === undefined) return (view[kind] as readonly ViewItem<Kind>[]).find(predicate)
  for (const root of roots.sourceRoots(low, high)) {
    const item = (roots.items(root)[kind] as readonly ViewItem<Kind>[]).find(predicate)
    if (item !== undefined) return item
  }
  return undefined
}
