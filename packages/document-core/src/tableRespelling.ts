import { tableToMarkdownWithPositions } from '@marktext/input-policy'
import type { DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, MarkupSyntax, SourceRange } from './documentCore.js'
import type { DocumentInputSelection } from './inputPlanning.js'
import { copyDocumentSelection, type DocumentModelTextPoint, type DocumentSelection, type DocumentTableSelection } from './sourceInputPlanning.js'
import { rebaseModelTextPoint } from './modelText.js'
import { DOCUMENT_RESOURCE_POLICY_V1 } from './resourcePolicy.js'
import { composeSourceEdits } from './sourceEditComposition.js'
import { positionAfter } from './sourcePosition.js'
import { tableCellContentRange } from './tableSelection.js'

/** The source a table is spelled in: a revision's or an unadmitted preview's. */
export interface TableSource {
  readonly length: number
  slice(start: number, end: number): string
}

const revisionSource = (core: DocumentCore, revision: DocumentRevision): TableSource => ({
  length: revision.sourceLength,
  slice: (start, end) => core.sourceSlice(revision, { start, end })
})

interface Respelling extends DocumentSourceEdit {
  /** Whitespace before a cell's content, which a caret at that content follows. */
  readonly leading?: true
}

/**
 * Upstream MarkText writes a table afresh from its cells after a cell edit:
 * each column is padded to its widest cell and rows gain outer pipes and
 * missing cells. Upstream also drops cells beyond the header's columns; here
 * they stay verbatim after the row's last column. The spelling is input-policy's native
 * table serializer; these edits change only the table's pipes, padding and
 * delimiter row around `edits`, which stay separate operations. Whitespace
 * that `edits` add at a cell's edge stands in for that cell's padding.
 */
export function tableRespellingEdits(
  text: TableSource,
  syntax: MarkupSyntax,
  table: MarkdownAstNode,
  edits: readonly DocumentSourceEdit[]
): readonly Respelling[] | undefined {
  const source = (start: number, end: number) => text.slice(Math.max(0, start), Math.min(text.length, end))
  const sourceStart = (offset: number) => syntax.coordinates.toSource(offset, 'previous')
  const sourceEnd = (offset: number) => syntax.coordinates.toSource(offset, 'next')
  const header = table.children[0]
  if (header === undefined) return undefined
  const columns = header.children.length
  const cellText = (cell: MarkdownAstNode) => {
    let start = sourceStart(cell.range.start)
    let end = sourceEnd(cell.range.end)
    // A caret after the text's trailing spaces edits there; those spaces are
    // the cell's text until the table is written again.
    const slotEnd = typeof cell.attributes.cellEnd === 'number' ? sourceEnd(cell.attributes.cellEnd) : end
    // Annotation spelling beside the text, such as a comment, is the cell's too.
    if (typeof cell.attributes.cellStart === 'number') {
      const slotStart = sourceStart(cell.attributes.cellStart)
      const slot = source(slotStart, slotEnd)
      const first = slot.search(/\S/u)
      if (first >= 0) {
        start = Math.min(start, slotStart + first)
        end = Math.max(end, slotStart + slot.trimEnd().length)
      }
    }
    if (start < end) {
      for (const edit of edits) {
        if (edit.start >= end && edit.end <= slotEnd && source(end, edit.start).trim() === '') end = Math.max(end, edit.end)
      }
    }
    let text = source(start, end)
    for (const edit of [...edits].reverse()) {
      if (edit.start < start || edit.end > end) continue
      text = text.slice(0, edit.start - start) + edit.insert + text.slice(edit.end - start)
    }
    return { start, end, text }
  }
  const rows = table.children.map(row => Array.from({ length: columns }, (_, column) => {
    const cell = row.children[column]
    return cell === undefined || typeof cell.attributes.cellStart !== 'number' ? undefined : { node: cell, ...cellText(cell) }
  }))
  const spelled = tableToMarkdownWithPositions({
    children: rows.map(cells => ({
      children: cells.map((cell, column) => ({ text: cell?.text ?? '', meta: { align: String(header.children[column]?.attributes.alignment ?? 'none') } }))
    }))
  }, '', DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits)
  if (spelled === undefined) return undefined
  const output = spelled.markdown
  const respelled: Respelling[] = []
  const replace = (start: number, end: number, insert: string, leading?: true) => {
    if (source(start, end) !== insert) respelled.push({ start, end, insert, ...(leading === undefined ? {} : { leading }) })
  }
  for (const rowIndex of table.children.keys()) {
    const written = spelled.rows[rowIndex]
    const cells = rows[rowIndex]
    if (written === undefined || cells === undefined) return undefined
    let rowEnd: number | undefined
    let missing = ''
    for (const [column, cell] of cells.entries()) {
      const position = written.cells[column]
      if (position === undefined) return undefined
      const slot = output.slice(position.slotStart, position.slotEnd)
      if (cell === undefined) {
        missing += slot + '|'
        continue
      }
      const slotStart = sourceStart(Number(cell.node.attributes.cellStart))
      const slotEnd = sourceEnd(Number(cell.node.attributes.cellEnd))
      const trimmed = cell.text.trim()
      const leading = trimmed === '' ? cell.text.length : cell.text.length - cell.text.trimStart().length
      const trailing = trimmed === '' ? 0 : cell.text.length - cell.text.trimEnd().length
      const before = output.slice(position.slotStart, position.start)
      const after = output.slice(position.end, position.slotEnd)
      const opens = column > 0 || source(slotStart - 1, slotStart) === '|' ? '' : '|'
      replace(slotStart, cell.start, opens + before.slice(Math.min(leading, before.length)), true)
      const closes = source(slotEnd, slotEnd + 1) === '|'
      replace(cell.end, slotEnd, after.slice(Math.min(trailing, after.length)) + (closes ? '' : '|'))
      rowEnd = slotEnd + (closes ? 1 : 0)
    }
    if (rowEnd === undefined) return undefined
    // Text after the header's last column stays as written: upstream drops
    // those cells, but the owner ruled that padding never removes text (plan
    // 0012 G24). The parser reads them as no cell, so they are not respelled.
    if (missing !== '') replace(rowEnd, rowEnd, missing)
    if (rowIndex === 0) {
      for (const [column, cell] of header.children.entries()) {
        const delimiter = spelled.delimiterCells[column]
        if (delimiter === undefined || typeof cell.attributes.delimiterStart !== 'number' || typeof cell.attributes.delimiterEnd !== 'number') return undefined
        const start = sourceStart(cell.attributes.delimiterStart)
        const end = sourceEnd(cell.attributes.delimiterEnd)
        const opens = column > 0 || source(start - 1, start) === '|' ? '' : '|'
        const closes = column < columns - 1 || source(end, end + 1) === '|' ? '' : '|'
        replace(start, end, opens + output.slice(delimiter.start, delimiter.end) + closes)
      }
    }
  }
  return respelled
}

/**
 * Adds the table respelling to a cell input plan: the plan's own edits keep
 * their locations, the native echo is reconciled to the respelled row, and
 * the selection keeps its place in the cell's text.
 */
export function respellTableInput<Plan extends { readonly edits: readonly DocumentSourceEdit[], readonly selection: { readonly start: number, readonly end: number }, readonly reconciliation: readonly DocumentSourceEdit[] }>(
  core: DocumentCore,
  revision: DocumentRevision,
  syntax: MarkupSyntax,
  table: MarkdownAstNode,
  plan: Plan
): Plan {
  const tableStart = syntax.coordinates.toSource(table.range.start, 'previous')
  const tableEnd = syntax.coordinates.toSource(table.range.end, 'next')
  plan = writtenDeletion(core, revision, plan, tableStart, tableEnd)
  const escaped = escapeCellPipes(core, revision, syntax, table, plan, tableStart, tableEnd)
  const unescaped = plan
  plan = escaped.plan
  // An edit across an annotation's edge is spelled by the markup compiler,
  // whose result this cannot foresee, so only its pipes are escaped.
  const acrossAnnotation = plan.edits.some(edit => revision.annotations.some(({ range }) =>
    edit.start < range.end && range.start < edit.end && !(edit.start <= range.start && range.end <= edit.end) && !(range.start <= edit.start && edit.end <= range.end)))
  const padding = acrossAnnotation ? [] : tableRespellingEdits(revisionSource(core, revision), syntax, table, plan.edits)
  if (padding === undefined) return unescaped
  const respelled = [...padding, ...escaped.escapes]
  if (respelled.length === 0) return plan
  const order = (edit: DocumentSourceEdit) => 'leading' in edit ? 0 : plan.edits.includes(edit) ? 1 : 2
  const edits = [...plan.edits, ...respelled].sort((a, b) => a.start - b.start || order(a) - order(b))
  for (const [index, edit] of edits.entries()) {
    const previous = edits[index - 1]
    if (previous !== undefined && edit.start < previous.end) return unescaped
  }
  // The respelling in the plan's own result, where the selection and echo live.
  const after = respelled.map(edit => ({
    start: positionAfter(plan.edits, edit.start, !('leading' in edit)),
    end: positionAfter(plan.edits, edit.end, !('leading' in edit)),
    insert: edit.insert,
    ...('leading' in edit ? { leading: true as const } : {})
  }))
  const result = planResult(core, revision, plan.edits, tableStart, tableEnd)
  const point = (position: number) => positionAfter(after, position, edit => 'leading' in edit)
  return {
    ...plan,
    edits: Object.freeze(edits.map(({ start, end, insert }) => Object.freeze({ start, end, insert }))),
    selection: Object.freeze({ start: point(plan.selection.start), end: point(plan.selection.end) }),
    reconciliation: Object.freeze(composeSourceEdits(plan.reconciliation, after.map(({ start, end, insert }) => ({ start, end, insert })), result).map(edit => Object.freeze(edit)))
  }
}

/**
 * A deletion the markup compiler writes differently, such as one that empties
 * an insertion and so removes its delimiters too, is planned as written. The
 * table's padding then fits the cell's resulting text, as it fits the bytes of
 * delimiters that remain. The selection and native echo follow the removal.
 */
function writtenDeletion<Plan extends { readonly edits: readonly DocumentSourceEdit[], readonly selection: { readonly start: number, readonly end: number }, readonly reconciliation: readonly DocumentSourceEdit[] }>(
  core: DocumentCore, revision: DocumentRevision, plan: Plan, tableStart: number, tableEnd: number
): Plan {
  if (plan.edits.length === 0 || plan.edits.some(edit => edit.insert !== '')) return plan
  const written = core.markupEdits(revision, plan.edits)
  if (written === undefined || written.some(edit => edit.insert !== '' || edit.start < tableStart || edit.end > tableEnd) ||
    (written.length === plan.edits.length && written.every((edit, index) => edit.start === plan.edits[index]?.start && edit.end === plan.edits[index]?.end))) return plan
  // Each written removal holds the planned ones it widens and whole annotations.
  if (plan.edits.some(edit => !written.some(removal => removal.start <= edit.start && edit.end <= removal.end)) ||
    written.some(removal => revision.annotations.some(({ range }) =>
      removal.start < range.end && range.start < removal.end && !(removal.start <= range.start && range.end <= removal.end)))) return plan
  // The written removals must stand as edits of their own.
  const rewritten = core.markupEdits(revision, written)
  if (rewritten === undefined || rewritten.length !== written.length ||
    rewritten.some((edit, index) => edit.start !== written[index]?.start || edit.end !== written[index]?.end || edit.insert !== '')) return plan
  const previousPosition = (position: number) => {
    let removed = 0
    for (const edit of plan.edits) {
      if (edit.start - removed >= position) break
      removed += edit.end - edit.start
    }
    return position + removed
  }
  const point = (position: number) => positionAfter(written, previousPosition(position), false)
  const widened = written.map(removal => ({
    start: positionAfter(plan.edits, removal.start, false),
    end: positionAfter(plan.edits, removal.end, true),
    insert: ''
  })).filter(edit => edit.start < edit.end)
  return {
    ...plan,
    edits: Object.freeze(written.map(edit => Object.freeze({ ...edit }))),
    selection: Object.freeze({ start: point(plan.selection.start), end: point(plan.selection.end) }),
    reconciliation: Object.freeze(composeSourceEdits(plan.reconciliation, widened, planResult(core, revision, plan.edits, tableStart, tableEnd)).map(edit => Object.freeze(edit)))
  }
}

/** Reads a plan's result within the table region `start`..`end` of the source it edits. */
function planResult(core: DocumentCore, revision: DocumentRevision, edits: readonly DocumentSourceEdit[], start: number, end: number) {
  let region = core.sourceSlice(revision, { start, end })
  for (const edit of [...edits].reverse()) region = region.slice(0, edit.start - start) + edit.insert + region.slice(edit.end - start)
  return (from: number, to: number) => region.slice(from - start, to - start)
}

/**
 * Upstream writes a cell's text with each bare pipe escaped, so an edit that
 * leaves a pipe unescaped keeps it in the cell. A pipe the plan inserts is
 * escaped within its edit; a pipe the plan leaves after its edit gains a
 * backslash of its own, returned in `escapes`.
 */
function escapeCellPipes<Plan extends { readonly edits: readonly DocumentSourceEdit[], readonly selection: { readonly start: number, readonly end: number }, readonly reconciliation: readonly DocumentSourceEdit[] }>(
  core: DocumentCore, revision: DocumentRevision, syntax: MarkupSyntax, table: MarkdownAstNode, plan: Plan, tableStart: number, tableEnd: number
): { plan: Plan, escapes: Respelling[] } {
  const contents = table.children.flatMap(row => row.children).map(cell => ({
    start: tableCellContentRange(syntax, cell).start,
    end: syntax.coordinates.toSource(typeof cell.attributes.cellEnd === 'number' ? cell.attributes.cellEnd : cell.range.end, 'next')
  }))
  const character = (position: number) => position < 0 || position >= revision.sourceLength ? '' : core.sourceSlice(revision, { start: position, end: position + 1 })
  const edits: DocumentSourceEdit[] = []
  const escapes: Respelling[] = []
  // Backslashes added within inserts, at their places in the plan's result.
  const added: number[] = []
  let shift = 0
  for (const edit of plan.edits) {
    if (!contents.some(content => content.start <= edit.start && edit.end <= content.end)) {
      edits.push(edit)
      shift += edit.insert.length - (edit.end - edit.start)
      continue
    }
    let insert = ''
    let previous = character(edit.start - 1)
    for (let index = 0; index < edit.insert.length; index++) {
      const next = edit.insert.charAt(index)
      if (next === '|' && previous !== '\\') {
        insert += '\\'
        added.push(edit.start + shift + index)
      }
      insert += next
      previous = next
    }
    if (character(edit.end) === '|' && previous !== '\\' && contents.some(content => content.start <= edit.end && edit.end < content.end)) {
      escapes.push({ start: edit.end, end: edit.end, insert: '\\' })
    }
    edits.push(insert === edit.insert ? edit : { ...edit, insert })
    shift += edit.insert.length - (edit.end - edit.start)
  }
  if (added.length === 0) return { plan, escapes }
  const escaped = (position: number) => position + added.filter(at => at < position).length
  const result = planResult(core, revision, plan.edits, tableStart, tableEnd)
  const inserted = added.map(at => ({ start: at, end: at, insert: '\\' }))
  return {
    plan: {
      ...plan,
      edits,
      selection: { start: escaped(plan.selection.start), end: escaped(plan.selection.end) },
      reconciliation: composeSourceEdits(plan.reconciliation, inserted, result)
    },
    escapes
  }
}

/**
 * Respells the table whose one cell's text holds every edit of an untracked
 * plan, as `respellTableInput` does, for a plan whose selection is one source
 * range. Other plans are unchanged.
 */
export function respellCellTextInput<Plan extends { readonly edits: readonly DocumentSourceEdit[], readonly selection: DocumentInputSelection, readonly reconciliation: readonly DocumentSourceEdit[] }>(core: DocumentCore, revision: DocumentRevision, plan: Plan): Plan {
  const first = plan.edits[0]
  const last = plan.edits.at(-1)
  const range = 'ranges' in plan.selection && plan.selection.ranges.length === 1 ? plan.selection.ranges[plan.selection.primary] : undefined
  if (first === undefined || last === undefined || range === undefined) return plan
  const syntax = core.project(revision, 'markup').syntax
  const table = tableAt(syntax, first.start)
  const inOneCell = table?.children.some(row => row.children.some(cell => typeof cell.attributes.cellStart === 'number' && typeof cell.attributes.cellEnd === 'number' &&
    syntax.coordinates.toSource(cell.range.start, 'previous') <= first.start && last.end <= syntax.coordinates.toSource(cell.range.end, 'next')))
  if (table === undefined || inOneCell !== true) return plan
  const backward = range.anchor > range.focus
  const respelled = respellTableInput(core, revision, syntax, table, { edits: plan.edits, reconciliation: plan.reconciliation, selection: { start: Math.min(range.anchor, range.focus), end: Math.max(range.anchor, range.focus) } })
  if (respelled.edits === plan.edits) return plan
  const { start, end } = respelled.selection
  return { ...plan, edits: respelled.edits, reconciliation: respelled.reconciliation, selection: Object.freeze({ ranges: Object.freeze([Object.freeze({ anchor: backward ? end : start, focus: backward ? start : end })]), primary: 0 }) }
}

/** A planned result whose selection keeps its place in the respelled table. */
interface RespelledPlan {
  readonly edits: readonly DocumentSourceEdit[]
  readonly selection: DocumentInputSelection | DocumentTableSelection
}

/** The table whose source contains `position`, including its end. */
export function tableAt(syntax: MarkupSyntax, position: number): MarkdownAstNode | undefined {
  const visit = (node: MarkdownAstNode): MarkdownAstNode | undefined => {
    if (node.kind === 'table') {
      const start = syntax.coordinates.toSource(node.range.start, 'previous')
      const end = syntax.coordinates.toSource(node.range.end, 'next')
      return start <= position && position <= end ? node : undefined
    }
    for (const child of node.children) {
      const found = visit(child)
      if (found !== undefined) return found
    }
    return undefined
  }
  return visit(syntax.ast.root)
}

/** Reads a planned result's owned syntax without admitting it. */
export type TablePreview = (edits: readonly DocumentSourceEdit[]) => { readonly syntax: MarkupSyntax, readonly source: string }

/**
 * Upstream also writes a table afresh after a command changes its structure
 * or a cell's text. The table the plan leaves, read from its unadmitted
 * `preview`, is respelled within the same operation, and the selection keeps
 * its place in its cell's text. A plan that removes the table is unchanged.
 */
export function respellTableResult<Plan extends RespelledPlan>(plan: Plan, tableStart: number, preview: TablePreview, echoed = false): Plan {
  if (plan.edits.length === 0) return plan
  const { syntax, source } = preview(plan.edits)
  const table = tableAt(syntax, positionAfter(plan.edits, tableStart, false))
  if (table === undefined) return plan
  const respelled = tableRespellingEdits(source, syntax, table, [])
  if (respelled === undefined || respelled.length === 0) return plan
  const point = (position: number) => positionAfter(respelled, position, edit => 'leading' in edit)
  const modelPoint = (value: DocumentModelTextPoint) => typeof value === 'number' ? point(value) : rebaseModelTextPoint(value, respelled)
  // Cell offsets count within the cell's text, which respelling keeps.
  const extent = (range: SourceRange) => ({ start: positionAfter(respelled, range.start, false), end: positionAfter(respelled, range.end, true) })
  const selection = plan.selection
  const moved = 'ranges' in selection
    ? { ranges: selection.ranges.map(range => ({ anchor: point(range.anchor), focus: point(range.focus) })), primary: selection.primary }
    : selection.kind === 'table-cell'
      ? { ...selection, cell: { ...selection.cell, table: extent(selection.cell.table) } }
      : selection.kind === 'model-text'
        // Respelling writes only pipes and padding, never a text value.
        ? { ...selection, anchor: modelPoint(selection.anchor), focus: modelPoint(selection.focus) }
        : { ...selection, table: extent(selection.table) }
  const length = source.length + respelled.reduce((sum, edit) => sum + edit.insert.length - (edit.end - edit.start), 0)
  const result = (start: number, end: number) => source.slice(start, end)
  return {
    ...plan,
    edits: Object.freeze(composeSourceEdits(plan.edits, respelled, result).map(edit => Object.freeze(edit))),
    selection: copyDocumentSelection(moved as DocumentSelection, length) as Plan['selection'],
    // A native echo of the plan's own edits is respelled the same way.
    ...(echoed && 'reconciliation' in plan
      ? { reconciliation: Object.freeze(composeSourceEdits(plan.reconciliation as readonly DocumentSourceEdit[], respelled.map(({ start, end, insert }) => ({ start, end, insert })), result).map(edit => Object.freeze(edit))) }
      : {})
  }
}

/**
 * Respells the table an untracked edit of `range` falls within, as
 * `respellTableResult` does; an edit reaching outside one table is unchanged.
 */
export function respellEditedTable<Plan extends RespelledPlan>(core: DocumentCore, revision: DocumentRevision, plan: Plan, range: SourceRange, preview: TablePreview): Plan {
  if (plan.edits.length === 0) return plan
  const syntax = core.project(revision, 'markup').syntax
  const table = tableAt(syntax, range.start)
  if (table === undefined || range.end > syntax.coordinates.toSource(table.range.end, 'next')) return plan
  return respellTableResult(plan, syntax.coordinates.toSource(table.range.start, 'previous'), preview)
}
