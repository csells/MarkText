import type { MuyaMarkupPath } from './muyaMarkupView'

export const samePath = (left: MuyaMarkupPath, right: MuyaMarkupPath): boolean =>
  left.length === right.length && left.every((part, index) => part === right[index])

/** A view item's root block; NaN for a path that starts with no root index. */
export const rootOf = (item: { readonly path: MuyaMarkupPath }): number => {
  const root = item.path[0]
  return typeof root === 'number' ? root : Number.NaN
}

/** The item of a list root that `path` is under. */
export const itemOfPath = (path: MuyaMarkupPath): number | undefined =>
  path[1] === 'children' && typeof path[2] === 'number' ? path[2] : undefined

export const listStates: ReadonlySet<string> = new Set(['bullet-list', 'order-list', 'task-list'])
