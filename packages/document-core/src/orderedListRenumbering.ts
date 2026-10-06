import type { DocumentSourceEdit, MarkdownAstNode, MarkupSyntax, SourceRange } from './documentCore.js'
import type { EditNormalizationContext } from './editNormalization.js'
import { positionAfter } from './sourcePosition.js'

/** Top-level blocks read on each side of the edited ones, so a list the edit joins or splits is read whole. */
const CONTEXT_BLOCKS = 1

/** Upstream's serializer writes no larger ordinal (`stateToMarkdown` `_serializeListItem`). */
const LARGEST_ORDINAL = 999_999_999

interface ListItem {
  /** Source start of the item's ordinal. */
  readonly ordinalStart: number
  readonly ordinalEnd: number
  readonly ordinal: number
  readonly task: boolean
}

interface OrderedList {
  readonly items: readonly ListItem[]
}

/**
 * Upstream MarkText writes an ordered list afresh after an edit changes its
 * items: each run of task or plain items keeps its source ordinals while it
 * holds the items it was read with, and otherwise numbers from the run's
 * start, the list's first ordinal plus the run's offset in the list
 * (`compatibleTaskList`, `stateToMarkdown`). Here only the ordered lists an
 * edit changes are renumbered, in the same operation, so one undo restores
 * them; every other list and an unedited save keep their bytes.
 *
 * Returns the ordinal replacements in the source `edits` produce, ordered and
 * disjoint from the edited text; empty when no ordinal changes.
 */
export function orderedListRenumbering(context: EditNormalizationContext): DocumentSourceEdit[] {
  const { core, revision, parseWindow: parse } = context
  if (parse === undefined) return []
  const sorted = context.edits
  const first = sorted[0]
  const last = sorted.at(-1)
  if (first === undefined || last === undefined) return []
  // Item structure changes only where a line ending is written or removed.
  if (!sorted.some(edit => /[\r\n]/u.test(edit.insert) ||
    /[\r\n]/u.test(core.sourceSlice(revision, { start: edit.start, end: edit.end })))) return []
  // The blocks a window reads around the edit, widened to each whole list
  // there, read as the document does.
  const read = context.syntax?.({ start: first.start, end: last.end }) ?? core.project(revision, 'markup').syntax
  const blocks = topLevelWindow(read, first.start, last.end)
  if (blocks === undefined) return []
  let window = blocks
  for (const position of [blocks.start, Math.max(0, first.start - 1), first.start, last.end, blocks.end]) {
    const list = context.listRange?.(position)
    if (list !== undefined) window = { start: Math.min(window.start, list.start), end: Math.max(window.end, list.end) }
  }
  const beforeText = core.sourceSlice(revision, window)
  const before = orderedLists(parse(beforeText, window.start === 0), beforeText, window.start)
  const resultStart = positionAfter(sorted, window.start, false)
  const resultEnd = positionAfter(sorted, window.end, true)
  const afterText = context.result(resultStart, resultEnd)
  const after = orderedLists(parse(afterText, resultStart === 0), afterText, resultStart)
  const writtenSpans = sorted.map(edit => {
    const start = positionAfter(sorted, edit.start, false)
    return { start, end: start + edit.insert.length }
  })
  const touched = (list: OrderedList) => list.items.some(item =>
    writtenSpans.some(span => span.start <= item.ordinalStart && item.ordinalStart <= span.end)) ||
    writtenSpans.some(span => listStart(list) <= span.end && span.start <= listEnd(list))
  const previousItemAt = new Map<number, { list: OrderedList, index: number }>()
  for (const list of before) list.items.forEach((item, index) => previousItemAt.set(item.ordinalStart, { list, index }))
  // An unedited ordinal maps back to where it was; a written one has no origin.
  const origin = (resultPosition: number) => {
    let delta = 0
    for (const edit of sorted) {
      const start = edit.start + delta
      if (resultPosition < start) break
      if (resultPosition < start + edit.insert.length) return undefined
      delta += edit.insert.length - (edit.end - edit.start)
    }
    return previousItemAt.get(resultPosition - delta)
  }
  const replacements: DocumentSourceEdit[] = []
  for (const list of after.filter(touched)) {
    for (const run of runsOf(list.items)) {
      const origins = run.items.map(item => origin(item.ordinalStart))
      const firstOrigin = origins.find(found => found !== undefined)
      const previousRun = firstOrigin === undefined
        ? undefined
        : runsOf(firstOrigin.list.items).find(candidate => candidate.offset <= firstOrigin.index &&
          firstOrigin.index < candidate.offset + candidate.items.length)
      const kept = previousRun !== undefined && firstOrigin !== undefined &&
        origins.length === previousRun.items.length &&
        origins.every((found, index) => found?.list === firstOrigin.list && found.index === previousRun.offset + index)
      if (kept) continue
      const start = previousRun !== undefined && firstOrigin !== undefined
        ? (firstOrigin.list.items[0]?.ordinal ?? 1) + previousRun.offset
        : run.offset === 0 ? run.items[0]?.ordinal ?? 1 : (list.items[0]?.ordinal ?? 1) + run.offset
      run.items.forEach((item, index) => {
        let ordinal = start + index
        if (ordinal > LARGEST_ORDINAL) ordinal = 1
        if (ordinal !== item.ordinal) {
          replacements.push({ start: item.ordinalStart, end: item.ordinalEnd, insert: String(ordinal) })
        }
      })
    }
  }
  return replacements.sort((left, right) => left.start - right.start)
}

const listStart = (list: OrderedList) => list.items[0]?.ordinalStart ?? 0
const listEnd = (list: OrderedList) => list.items.at(-1)?.ordinalEnd ?? 0

/** Upstream splits a list where its items switch between task and plain. */
function runsOf(items: readonly ListItem[]): { readonly offset: number, readonly items: readonly ListItem[] }[] {
  const runs: { offset: number, items: ListItem[] }[] = []
  items.forEach((item, index) => {
    const current = runs.at(-1)
    if (current !== undefined && current.items[0]?.task === item.task) current.items.push(item)
    else runs.push({ offset: index, items: [item] })
  })
  return runs
}

/** The top-level blocks holding `start`..`end`, with context blocks on each side. */
function topLevelWindow(syntax: MarkupSyntax, start: number, end: number): SourceRange | undefined {
  const blocks = syntax.ast.root.children.map(block => ({
    start: syntax.coordinates.toSource(block.range.start, 'previous'),
    end: syntax.coordinates.toSource(block.range.end, 'next')
  }))
  if (blocks.length === 0) return undefined
  const overlapping = blocks.flatMap((block, index) => block.start <= end && start <= block.end ? [index] : [])
  // An edit between blocks reads the blocks on either side of it.
  const next = blocks.findIndex(block => block.start > end)
  const firstIndex = overlapping[0] ?? (next < 0 ? blocks.length - 1 : Math.max(0, next - 1))
  const lastIndex = overlapping.at(-1) ?? firstIndex
  const from = blocks[Math.max(0, firstIndex - CONTEXT_BLOCKS)]
  const to = blocks[Math.min(blocks.length - 1, lastIndex + CONTEXT_BLOCKS)]
  if (from === undefined || to === undefined) return undefined
  return { start: Math.min(from.start, start), end: Math.max(to.end, end) }
}

/** Every ordered list in a parsed window, with its items' ordinals in document coordinates. */
function orderedLists(syntax: MarkupSyntax, text: string, offset: number): OrderedList[] {
  const lists: OrderedList[] = []
  const visit = (node: MarkdownAstNode): void => {
    if (node.kind === 'list' && node.attributes.ordered === true) {
      const items: ListItem[] = []
      for (const item of node.children) {
        if (item.kind !== 'list-item') continue
        const start = syntax.coordinates.toSource(item.range.start, 'next')
        const digits = /^\d{1,9}/u.exec(text.slice(start, start + 10))?.[0]
        if (digits === undefined) continue
        items.push({
          ordinalStart: offset + start,
          ordinalEnd: offset + start + digits.length,
          ordinal: Number(digits),
          task: item.attributes.task === true
        })
      }
      if (items.length > 0) lists.push({ items })
    }
    node.children.forEach(visit)
  }
  visit(syntax.ast.root)
  return lists
}
