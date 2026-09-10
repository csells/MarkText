import { emptyTableColumn } from '@marktext/input-policy'
import type { DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, SourceRange } from './documentCore.js'
import type { DocumentInputAction, DocumentInputPlan } from './inputPlanning.js'
import { inputSourceRange } from './inputPlanning.js'
import { resolveTableCell } from './tableSelection.js'
import { positionAfter } from './sourcePosition.js'
import { markupReplacementRange } from './markupEditOwnership.js'
import { tableRowCompletion } from './tableCellEditing.js'

export function movedTableIndex(index: number, from: number, to: number): number {
  if (index === from) return to
  if (from < to && from < index && index <= to) return index - 1
  if (to < from && to <= index && index < from) return index + 1
  return index
}

/** Move parser-owned physical slots; identical exposed text cannot identify cells. */
export function planTableMove(core: DocumentCore, revision: DocumentRevision, action: Extract<DocumentInputAction, { command: 'moveTableColumn' | 'moveTableRow' }>): DocumentInputPlan {
  const target = resolveTableCell(core, revision, action.target)
  const count = action.command === 'moveTableRow' ? target.table.children.length : target.table.children[0]?.children.length ?? 0
  const from = action.command === 'moveTableRow' ? target.row : target.column
  const to = action.command === 'moveTableRow' ? action.row : action.column
  if (!Number.isInteger(to) || to < 0 || to >= count) throw new RangeError('Move destination is outside the current table')
  const first = Math.min(from, to)
  const last = Math.max(from, to)
  const edits: DocumentSourceEdit[] = []
  const mappings: { before: SourceRange, after: number, edit: DocumentSourceEdit }[] = []
  const slot = (node: MarkdownAstNode, delimiter: boolean): SourceRange | undefined => {
    const start = node.attributes[delimiter ? 'delimiterStart' : 'cellStart']
    const end = node.attributes[delimiter ? 'delimiterEnd' : 'cellEnd']
    return typeof start === 'number' && typeof end === 'number'
      ? { start: target.syntax.coordinates.toSource(start, 'next'), end: target.syntax.coordinates.toSource(end, 'previous') }
      : undefined
  }
  const row = (node: MarkdownAstNode, delimiter: boolean): void => {
    const slots = node.children.map(cell => slot(cell, delimiter))
    const firstSlot = slots[first]
    if (firstSlot === undefined || from === to) return
    const physical = slots.filter(value => value !== undefined)
    const finalPhysical = physical.at(-1)
    if (finalPhysical === undefined) throw new RangeError('Column move has no physical table row')
    const rowEnd = target.syntax.coordinates.toSource(node.range.end, 'previous')
    const finalSlot = slots[last]
    const trailing = finalSlot === undefined && finalPhysical.end < rowEnd ? '|' : ''
    const ordered = Array.from({ length: last - first + 1 }, (_, index) => first + index)
      .sort((left, right) => movedTableIndex(left, from, to) - movedTableIndex(right, from, to))
    let insert = ''
    const starts = new Map<number, number>()
    for (const [index, column] of ordered.entries()) {
      if (index > 0) insert += '|'
      starts.set(column, firstSlot.start + insert.length)
      const current = slots[column]
      insert += current === undefined ? emptyTableColumn().cell : core.sourceSlice(revision, current)
    }
    insert += trailing
    const edit = { start: firstSlot.start, end: finalSlot?.end ?? rowEnd, insert }
    if (core.sourceSlice(revision, edit) === insert) return
    edits.push(edit)
    for (const column of ordered) {
      const before = slots[column]
      const after = starts.get(column)
      if (before !== undefined && after !== undefined) mappings.push({ before, after, edit })
    }
  }
  if (action.command === 'moveTableColumn') {
    target.table.children.forEach((node, index) => {
      row(node, false)
      if (index === 0) row(node, true)
    })
  } else if (from !== to) {
    const rows = target.table.children.map(node => {
      const range = markupReplacementRange(core, revision, {
        start: target.syntax.coordinates.toSource(node.range.start, 'next'),
        end: target.syntax.coordinates.toSource(node.range.end, 'previous'),
        insert: ''
      }, 'structure')
      if (range === undefined) throw new RangeError('Moved row has no owned source interval')
      return range
    })
    for (let index = first; index <= last; index++) {
      const before = rows[index]
      const destinationIndex = movedTableIndex(index, from, to)
      const destination = rows[destinationIndex]
      const node = target.table.children[index]
      const header = target.table.children[0]
      if (before === undefined || destination === undefined || node === undefined || header === undefined) throw new RangeError('Moved row is outside the current table')
      let insert = core.sourceSlice(revision, before)
      if (destinationIndex === 0) {
        const completion = tableRowCompletion(target.syntax, node, header.children.length)
        insert = insert.slice(0, completion.start - before.start) + completion.insert + insert.slice(completion.end - before.start)
      }
      const edit = { ...destination, insert }
      if (core.sourceSlice(revision, destination) !== insert) edits.push(edit)
      mappings.push({ before, after: destination.start, edit })
    }
  }
  edits.sort((left, right) => left.start - right.start)
  const point = (position: number): number => {
    const mapping = mappings.find(item => item.before.start <= position && position <= item.before.end)
    return mapping === undefined
      ? positionAfter(edits, position, true)
      : mapping.after + position - mapping.before.start + edits.filter(edit => edit.start < mapping.edit.start).reduce((sum, edit) => sum + edit.insert.length - edit.end + edit.start, 0)
  }
  const primary = 'ranges' in action.selection ? action.selection.ranges[action.selection.primary] : action.selection
  if (primary === undefined) throw new RangeError('Table move has no current selection')
  const range = inputSourceRange(core, revision, action.selection)
  const backward = primary.anchor > primary.focus
  const table = {
    start: target.syntax.coordinates.toSource(target.table.range.start, 'next'),
    end: target.syntax.coordinates.toSource(target.table.range.end, 'previous')
  }
  let insert = core.sourceSlice(revision, table)
  for (const edit of [...edits].reverse()) {
    insert = insert.slice(0, edit.start - table.start) + edit.insert + insert.slice(edit.end - table.start)
  }
  // A move replaces one structure. Tracking row fragments would splice both
  // delimiter rows together in Markup and destroy the table's editing surface.
  return { edits: edits.length === 0 ? [] : [{ ...table, insert }], selection: { ranges: [{ anchor: point(backward ? range.end : range.start), focus: point(backward ? range.start : range.end) }], primary: 0 }, reconciliation: [] }
}
