import type { MuyaMarkupPath } from './muyaMarkupView'

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
