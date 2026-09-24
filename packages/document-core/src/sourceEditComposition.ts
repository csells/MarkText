import type { DocumentSourceEdit } from './documentCore.js'

/**
 * Composes `after`, authored against the source `before` produces, into one
 * edit list against `before`'s own source. Edits that overlap or touch join
 * into one replacement; `result` reads the source `before` produces.
 */
export function composeSourceEdits(
  before: readonly DocumentSourceEdit[], after: readonly DocumentSourceEdit[], result: (start: number, end: number) => string
): DocumentSourceEdit[] {
  if (after.length === 0) return [...before]
  interface Item { readonly start: number, readonly end: number, readonly base?: DocumentSourceEdit, readonly next?: DocumentSourceEdit }
  const items: Item[] = []
  let shift = 0
  for (const edit of [...before].sort((a, b) => a.start - b.start)) {
    const start = edit.start + shift
    items.push({ start, end: start + edit.insert.length, base: edit })
    shift += edit.insert.length - (edit.end - edit.start)
  }
  for (const edit of after) items.push({ start: edit.start, end: edit.end, next: edit })
  items.sort((a, b) => a.start - b.start || (a.base === undefined ? 1 : 0) - (b.base === undefined ? 1 : 0))
  const clusters: Item[][] = []
  let reach = -1
  for (const item of items) {
    const current = clusters.at(-1)
    if (current !== undefined && item.start <= reach) {
      current.push(item)
      reach = Math.max(reach, item.end)
    } else {
      clusters.push([item])
      reach = item.end
    }
  }
  const composed: DocumentSourceEdit[] = []
  let delta = 0
  for (const cluster of clusters) {
    const bases = cluster.flatMap(item => item.base === undefined ? [] : [item.base])
    const growth = bases.reduce((sum, edit) => sum + edit.insert.length - (edit.end - edit.start), 0)
    const nexts = cluster.flatMap(item => item.next === undefined ? [] : [item.next]).sort((a, b) => b.start - a.start)
    if (nexts.length === 0) {
      composed.push(...bases)
    } else {
      const start = Math.min(...cluster.map(item => item.start))
      const end = Math.max(...cluster.map(item => item.end))
      let insert = result(start, end)
      for (const edit of nexts) insert = insert.slice(0, edit.start - start) + edit.insert + insert.slice(edit.end - start)
      composed.push({ start: start - delta, end: end - delta - growth, insert })
    }
    delta += growth
  }
  return composed
}
