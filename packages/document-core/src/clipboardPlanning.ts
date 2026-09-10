import { planModelTextClipboard, rebaseModelTextPoint } from './modelText.js'
import type { CriticMarkupAnnotation, DocumentCore, DocumentRevision, DocumentSourceEdit, MarkupSyntax, SourceRange } from './documentCore.js'
import { copyDocumentSelection, type DocumentSelection, type DocumentTableSelection, type DocumentTableCellSelection } from './sourceInputPlanning.js'
import { inputSourceRange, type DocumentInputSelection } from './inputPlanning.js'
import { resolveTableCell, resolveTableSelection, resolveTableSelectionInSyntax, tableCellSelectionAfter } from './tableSelection.js'
import { materializeTableCellEdit } from './tableCellEditing.js'
import { planTableClipboard } from './tableClipboardPlanning.js'
import { positionAfter } from './sourcePosition.js'
import { prepareClipboardMarkdown } from './clipboardMarkdown.js'
import { createMarkupCompoundSourceEdits } from './markupEditing.js'
import { createTrackedSourceEdit, prepareTrackedBlockEdit } from './trackedAuthoring.js'

export type DocumentClipboardSelection = SourceRange | DocumentSelection

export type DocumentClipboardContent = Readonly<{ markdown: string, plainText?: string, bareUrl?: string, pasteAsPlainText?: boolean, currentSelection?: DocumentSelection }>

export type DocumentTextClipboardAction = Readonly<{
  selection: DocumentInputSelection
  tracked: boolean
} & ({ kind: 'cut' } | ({ kind: 'paste' } & DocumentClipboardContent))>

export type DocumentTableClipboardAction = Readonly<{
  kind: 'table'
  selection: DocumentTableSelection
  tracked: boolean
} & ({ operation: 'delete' | 'cut' } | ({ operation: 'paste' } & DocumentClipboardContent))>

export type DocumentClipboardAction = DocumentTextClipboardAction | DocumentTableClipboardAction
export type DocumentClipboardPasteAction = Extract<DocumentTextClipboardAction, { kind: 'paste' }> | Extract<DocumentTableClipboardAction, { operation: 'paste' }>

/** Immutable command admission is shared by the live binding and recovery journal. */
export function copyClipboardAction(action: DocumentClipboardAction): DocumentClipboardAction {
  if (action.kind === 'table') {
    const selection = copyDocumentSelection(action.selection, Number.MAX_SAFE_INTEGER)
    if (selection.kind !== 'table') throw new RangeError('Table clipboard requires a table selection')
    return Object.freeze({ ...action, selection, ...('currentSelection' in action && action.currentSelection !== undefined ? { currentSelection: copyClipboardSelection(action.currentSelection) } : {}) })
  }
  return Object.freeze({
    ...action,
    selection: copyClipboardSelection(action.selection),
    ...(action.kind === 'paste' && action.currentSelection !== undefined ? { currentSelection: copyClipboardSelection(action.currentSelection) } : {})
  })
}

function copyClipboardSelection(selection: DocumentInputSelection): DocumentInputSelection
function copyClipboardSelection(selection: DocumentSelection): DocumentSelection
function copyClipboardSelection(selection: DocumentSelection): DocumentSelection {
  return copyDocumentSelection(selection, Number.MAX_SAFE_INTEGER)
}

const sameClipboardSelection = (left: DocumentSelection, right: DocumentSelection): boolean => {
  if ('ranges' in left) return 'ranges' in right && left.primary === right.primary && left.ranges.length === right.ranges.length && left.ranges.every((range, index) => range.anchor === right.ranges[index]?.anchor && range.focus === right.ranges[index]?.focus)
  if ('ranges' in right || left.kind !== right.kind) return false
  if (left.kind === 'table' && right.kind === 'table') return left.table.start === right.table.start && left.table.end === right.table.end && left.anchor.row === right.anchor.row && left.anchor.column === right.anchor.column && left.focus.row === right.focus.row && left.focus.column === right.focus.column
  if (left.kind === 'model-text' && right.kind === 'model-text') {
    const same = (a: typeof left.anchor, b: typeof right.anchor) => typeof a === 'number' || typeof b === 'number' ? a === b : a.text.start === b.text.start && a.text.end === b.text.end && a.offset === b.offset
    return same(left.anchor, right.anchor) && same(left.focus, right.focus)
  }
  if (left.kind !== 'table-cell' || right.kind !== 'table-cell') return false
  return left.anchor === right.anchor && left.focus === right.focus &&
    left.cell.table.start === right.cell.table.start && left.cell.table.end === right.cell.table.end &&
    left.cell.row === right.cell.row && left.cell.column === right.cell.column
}

export interface DocumentClipboardPlan {
  readonly edits: readonly DocumentSourceEdit[]
  readonly selection: DocumentSelection
}

/** The clipboard importer supplies Markdown; the current document owns its insertion. */
export function planClipboard(
  core: DocumentCore,
  previous: DocumentRevision,
  action: DocumentClipboardAction,
  preview: (edits: readonly DocumentSourceEdit[]) => DocumentRevision,
  importSyntax: (source: string) => MarkupSyntax,
  previewSyntax: (edits: readonly DocumentSourceEdit[]) => MarkupSyntax,
  compileStructuralDeletion: (edits: readonly DocumentSourceEdit[]) => readonly DocumentSourceEdit[] | undefined
): DocumentClipboardPlan {
  if (action.kind === 'table') {
    if (action.operation !== 'paste') return planTableClipboard(core, previous, action, preview, previewSyntax, compileStructuralDeletion)
    const selected = resolveTableSelection(core, previous, action.selection)
    if (selected.cells.length !== 1) return Object.freeze({ edits: Object.freeze([]), selection: selected.selection })
    const cell = selected.cells[0]!
    return planClipboard(core, previous, {
      kind: 'paste',
      markdown: action.markdown,
      tracked: action.tracked,
      ...(action.pasteAsPlainText === undefined ? {} : { pasteAsPlainText: action.pasteAsPlainText }),
      ...(action.plainText === undefined ? {} : { plainText: action.plainText }),
      ...(action.bareUrl === undefined ? {} : { bareUrl: action.bareUrl }),
      ...(action.currentSelection === undefined || sameClipboardSelection(action.currentSelection, action.selection) ? {} : { currentSelection: action.currentSelection }),
      selection: { kind: 'table-cell', cell: { table: selected.selection.table, row: cell.row, column: cell.column }, anchor: 0, focus: cell.end - cell.start }
    }, preview, importSyntax, previewSyntax, compileStructuralDeletion)
  }
  if (action.selection.kind === 'model-text') return retainClipboardSelection(core, previous, action, planModelTextClipboard(core, previous, action, preview), previewSyntax)
  const { start, end } = inputSourceRange(core, previous, action.selection)
  const selectedCell = 'ranges' in action.selection ? undefined : resolveTableCell(core, previous, action.selection.cell)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > previous.sourceLength) {
    throw new RangeError('Clipboard selection is outside the current document')
  }
  let insert = action.kind === 'paste' ? action.markdown : ''
  if (action.kind === 'paste') {
    const syntax = core.project(previous, 'markup').syntax
    const point = syntax.coordinates.toProjected(start, 'next')
    let literal = false
    const visit = (node: typeof syntax.ast.root): void => {
      if (node.range.start <= point && point <= node.range.end) {
        if (['code-block', 'math-block', 'diagram', 'inline-code', 'inline-math'].includes(node.kind)) literal = true
        for (const child of node.children) visit(child)
      }
    }
    visit(selectedCell?.cell ?? syntax.ast.root)
    if (literal && action.plainText !== undefined) insert = action.plainText
    else if (action.bareUrl !== undefined && insert === `[${action.bareUrl}](${action.bareUrl})`) {
      const candidate = core.sourceSlice(previous, { start: 0, end: start }) + action.bareUrl + core.sourceSlice(previous, { start: end, end: previous.sourceLength })
      const candidateSyntax = importSyntax(candidate)
      const from = candidateSyntax.coordinates.toProjected(start, 'next')
      const to = candidateSyntax.coordinates.toProjected(start + action.bareUrl.length, 'previous')
      let autoLink = false
      const inspect = (node: typeof syntax.ast.root): void => {
        if ((node.kind === 'autolink' || node.kind === 'link' && node.attributes.extendedAutolink === true) && node.range.start === from && node.range.end === to) autoLink = true
        for (const child of node.children) inspect(child)
      }
      inspect(candidateSyntax.ast.root)
      if (autoLink) insert = action.bareUrl
    }
  }
  if (typeof insert !== 'string') throw new TypeError('Clipboard Markdown must be text')
  if (start === end && insert === '') return { edits: [], selection: copyClipboardSelection(action.selection) }
  const prepared = prepareClipboardMarkdown(core, previous, { start, end, insert }, action.selection, importSyntax, action.kind === 'paste' && action.pasteAsPlainText === true)
  const input = prepared.edit
  const inputs = [input, ...(prepared.after ?? [])]
  const trackedInputs = action.tracked
    ? inputs.map(edit => {
      const enclosed = prepareTrackedBlockEdit(core, previous, edit, previewSyntax([edit]))
      return createTrackedSourceEdit(core, previous, enclosed, preview, true)
    })
    : undefined
  const tracked = trackedInputs?.[0]
  let edits = trackedInputs === undefined
    ? createMarkupCompoundSourceEdits(core, previous, inputs, preview, true)
    : trackedInputs.every(edit => edit !== undefined) ? trackedInputs : undefined
  if (edits === undefined) throw new RangeError('Clipboard action has no safe source edit')
  let materializedPrefix = 0
  if (selectedCell !== undefined && selectedCell.slotStart === undefined && insert !== '') {
    if (edits.length !== 1 || edits[0] === undefined) throw new RangeError('Implicit cell clipboard requires one exact insertion')
    const materialized = materializeTableCellEdit(selectedCell, edits[0])
    edits = [materialized.edit]
    materializedPrefix = materialized.prefixLength
  }
  let caret = start
  let shift = 0
  for (const edit of edits) {
    if (edit.start <= start && start <= edit.end && (edit.insert.length > 0 || insert === '')) {
      caret = edit.start + shift + (edit.insert.length > 0 && !action.tracked ? prepared.caret + materializedPrefix : edit.insert.length)
      break
    }
    shift += edit.insert.length - (edit.end - edit.start)
  }
  if (action.tracked && tracked !== undefined && insert.length > 0) {
    const candidate = preview(edits)
    const pending: CriticMarkupAnnotation[] = [...candidate.annotations]
    while (pending.length > 0) {
      const annotation = pending.pop()
      if (annotation === undefined) break
      if (annotation.range.start === tracked.start + materializedPrefix && annotation.range.end === tracked.start + materializedPrefix + tracked.insert.length) {
        const arm = annotation.arms.find(item => item.name === (annotation.kind === 'substitution' ? 'new' : 'content'))
        if (arm !== undefined) caret = arm.range.end
      }
      for (const arm of annotation.arms) pending.push(...arm.annotations)
    }
  }
  let resultSyntax: MarkupSyntax | undefined
  const resultCellSelection = (original: DocumentTableCellSelection, sourceAnchor?: number, sourceFocus = sourceAnchor): DocumentTableCellSelection => {
    resultSyntax ??= previewSyntax(edits)
    return tableCellSelectionAfter(resultSyntax, previous.sourceLength + edits.reduce((sum, edit) => sum + edit.insert.length - (edit.end - edit.start), 0), edits, original, sourceAnchor, sourceFocus)
  }
  const selection: DocumentSelection = 'ranges' in action.selection ? { ranges: [{ anchor: caret, focus: caret }], primary: 0 } : resultCellSelection(action.selection, caret)
  return retainClipboardSelection(core, previous, action, { edits, selection }, previewSyntax)
}

/** Async completion preserves the live selection through every clipboard target kind. */
function retainClipboardSelection(core: DocumentCore, previous: DocumentRevision, action: DocumentTextClipboardAction, plan: DocumentClipboardPlan, previewSyntax: (edits: readonly DocumentSourceEdit[]) => MarkupSyntax): DocumentClipboardPlan {
  const { edits } = plan
  let { selection } = plan
  let resultSyntax: MarkupSyntax | undefined
  const sourceLength = previous.sourceLength + edits.reduce((sum, edit) => sum + edit.insert.length - (edit.end - edit.start), 0)
  if (action.kind === 'paste' && action.currentSelection !== undefined && !sameClipboardSelection(action.currentSelection, action.selection)) {
    const current = action.currentSelection
    if ('kind' in current && current.kind === 'table') {
      resultSyntax ??= previewSyntax(edits)
      const table = { start: positionAfter(edits, current.table.start, false), end: positionAfter(edits, current.table.end, true) }
      selection = resolveTableSelectionInSyntax(resultSyntax, previous.sourceLength + edits.reduce((sum, edit) => sum + edit.insert.length - (edit.end - edit.start), 0), { ...current, table }).selection
      return Object.freeze({ edits: Object.freeze(edits), selection })
    }
    const currentRange = inputSourceRange(core, previous, current)
    if (!Number.isSafeInteger(currentRange.start) || !Number.isSafeInteger(currentRange.end) || currentRange.start < 0 || currentRange.end < currentRange.start || currentRange.end > previous.sourceLength) {
      throw new RangeError('Current clipboard selection is outside the document')
    }
    if ('ranges' in current) selection = { ...current, ranges: current.ranges.map(range => ({ anchor: positionAfter(edits, range.anchor, true), focus: positionAfter(edits, range.focus, true) })) }
    else if (current.kind === 'model-text') selection = { kind: 'model-text', anchor: rebaseModelTextPoint(current.anchor, edits), focus: rebaseModelTextPoint(current.focus, edits) }
    else {
      const currentCell = resolveTableCell(core, previous, current.cell)
      selection = currentCell.slotStart === undefined
        ? tableCellSelectionAfter(resultSyntax ??= previewSyntax(edits), sourceLength, edits, current)
        : tableCellSelectionAfter(resultSyntax ??= previewSyntax(edits), sourceLength, edits, current, positionAfter(edits, currentCell.start + current.anchor, true), positionAfter(edits, currentCell.start + current.focus, true))
    }
  }
  return Object.freeze({ edits: Object.freeze(edits), selection: Object.freeze(selection) })
}
