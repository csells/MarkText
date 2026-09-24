import { constrainLiteralDeletion, isEmptyFencedPayloadPoint, resolveModelTextSelection, planModelTextInput } from './modelText.js'
import type { MarkdownLineIndex } from './revision.js'
import { planTextMove } from './textMovePlanning.js'
import { planBlockMove } from './blockMovePlanning.js'
import { planTableMove, movedTableIndex } from './tableMovePlanning.js'
import { materializeTableCellEdit } from './tableCellEditing.js'
import { respellCellTextInput, respellEditedTable, respellTableInput, respellTableResult, tableAt, type TablePreview } from './tableRespelling.js'
import { planSetextTrailingLine } from './setextTrailingLine.js'
import { planTableSpanCut } from './tableSpanCut.js'
import { copyDocumentSelection, type DocumentTextSelection, type DocumentModelTextSelection, type DocumentTableCellSelection, type DocumentTableCellAddress } from './sourceInputPlanning.js'
import { previousTableCell, resolveTableCell, tableCellSelectionAfter, tableCellSelectionAtSource } from './tableSelection.js'
import { positionAfter } from './sourcePosition.js'
import type { HeadingChange, ListChange, ListMarkerOptions } from '@marktext/input-policy'
import type { ParagraphEnterConversion } from './internal/profile1/markdownParser.js'
import type { DocumentCore, DocumentCommit, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, MarkupSyntax, SourceRange } from './documentCore.js'
import { applyInputPairing, type IInputPairingOptions, type IInputPairingSyntaxContext } from './inputPolicy.js'
import { planStructuralInput } from './structuralInputPlanning.js'
import { planInlineUpdate, planTypedIndentedCode } from './typedLineBlockPlanning.js'
import { editedSourceReader, planDemotedRuleSeparation, planEmptiedParagraph } from './emptiedParagraphPlanning.js'
import { composeSourceEdits } from './sourceEditComposition.js'
import { paragraphBackwardStructuralTarget } from './paragraphJoinPlanning.js'
import { syntaxPathAt } from './syntaxPath.js'
import { isAnnotationDelimiter } from './annotationDelimiter.js'
import { isLiteralBlock } from './literalBlock.js'
import { editingReconciliation, retainedSourceEndpoint, sparseEditingReconciliation } from './editingReconciliation.js'

export type DocumentInputTarget = SourceRange | DocumentTableCellSelection | DocumentModelTextSelection
export type DocumentInputSelection = DocumentTextSelection | DocumentTableCellSelection | DocumentModelTextSelection

export interface DocumentBrowserInputAction<Selection extends DocumentInputSelection | SourceRange = DocumentInputSelection> {
  /** Browser replacement target; differs from the caret for a collapsed deletion. */
  readonly range: Selection extends SourceRange ? SourceRange : DocumentInputTarget
  readonly selection: Selection
  readonly inputType: string
  readonly data: string | null
  readonly options: Readonly<IInputPairingOptions & { readonly tabSize?: number }>
}

export type DocumentCommandInputAction<Selection extends DocumentInputSelection | SourceRange = DocumentInputSelection> = {
  readonly kind: 'command'
  readonly selection: Selection
  readonly options: DocumentBrowserInputAction['options']
} & ({ readonly command: 'moveText', readonly target: DocumentInputTarget, readonly copy: boolean } | { readonly command: 'moveBlock', readonly from: number, readonly to: number, readonly placement: 'before' | 'after' } | { readonly command: 'createFootnote', readonly identifier: string } | { readonly command: 'setCodeLanguage', readonly language: string, readonly infoOffset?: number } | { readonly command: 'changeBlock', readonly change: { readonly type: 'duplicate' | 'new' | 'delete' | 'clear' | 'reset', readonly at?: number, readonly placement?: 'before' | 'after', readonly text?: string, readonly scope: 'outer' | 'leaf', readonly selectionMode: 'start' | 'preserve' | 'end' } } | { readonly command: 'tab', readonly shift: boolean } | { readonly command: 'setTaskChecked', readonly checked: boolean, readonly autoCheck: boolean, readonly autoMoveCheckedToEnd: boolean } | { readonly command: 'createCodeBlock', readonly replace: boolean } | { readonly command: 'wrapCodeBlocks' } | { readonly command: 'resetCodeBlock', readonly selectionMode: 'preserve' | 'end' } | { readonly command: 'createMathBlock', readonly replace: boolean } | { readonly command: 'createHtmlBlock', readonly replace: boolean, readonly selectionMode: 'content' | 'end' } | { readonly command: 'changeThematicBreak', readonly change: { readonly type: 'insert' | 'replace' | 'toggle' | 'reset' | 'enter' } } | { readonly command: 'createFrontMatter', readonly replace: boolean, readonly style: string } | { readonly command: 'createTable', readonly rows: number, readonly columns: number, readonly replace: boolean } | { readonly command: 'moveTableRow', readonly target: DocumentTableCellAddress, readonly row: number } | { readonly command: 'moveTableColumn', readonly target: DocumentTableCellAddress, readonly column: number } | { readonly command: 'alignTableColumn', readonly target: DocumentTableCellAddress, readonly alignment: 'left' | 'center' | 'right' } | { readonly command: 'insertTableRow' | 'insertTableColumn', readonly placement: 'before' | 'after' } | { readonly command: 'removeTableRow' | 'removeTableColumn' | 'tableBoundaryBackspace' | 'exitTable' | 'joinParagraphBackward' | 'joinParagraphForward' } | { readonly command: 'changeList', readonly change: ListChange, readonly listOptions: ListMarkerOptions } | { readonly command: 'changeHeading', readonly change: HeadingChange } | { readonly command: 'changeBlockquote', readonly change: { readonly type: 'set' | 'quick-insert' | 'toggle' | 'reset' } })

export type DocumentInputAction<Selection extends DocumentInputSelection | SourceRange = DocumentInputSelection> = DocumentBrowserInputAction<Selection> | DocumentCommandInputAction<Selection>

export interface DocumentInputPlan {
  /** Policy-authored source operations, before ordinary/tracked spelling compilation. */
  readonly edits: readonly DocumentSourceEdit[]
  /** Owned materialization may retain visible carriers instead of transporting their syntax. */
  readonly editScope?: 'visible' | 'structure'
  /** Selection in the source domain after applying these edits. */
  readonly selection: DocumentInputSelection
  /** Exact edits from the raw native echo domain into the policy-authored domain. */
  readonly reconciliation: readonly DocumentSourceEdit[]
}

export interface DocumentSourceInputPlan extends Omit<DocumentInputPlan, 'selection'> {
  readonly selection: SourceRange
}

export interface DocumentInputSyntaxContext extends IInputPairingSyntaxContext {
  readonly type: 'format' | 'literal'
}

const contentBlocks = new Set(['paragraph', 'heading', 'table-cell'])

function inputSyntaxAt(root: MarkdownAstNode, projected: number): {
  context: DocumentInputSyntaxContext
  block: MarkdownAstNode
} | undefined {
  const path = syntaxPathAt(root, projected)
  if (path.length === 0) return undefined
  const context: IInputPairingSyntaxContext & { type: 'format' | 'literal' } = { type: 'format', isInInlineCode: false, isInInlineMath: false }
  let block = root
  for (const node of path) {
    // Until a fence has a body or closer, its opening line is being authored as
    // the paragraph upstream keeps it as until Enter converts it.
    const openerLine = node.kind === 'code-block' && node.attributes.provider === 'fenced-code' &&
      Number(node.attributes.contentStart) === node.range.end
    if (contentBlocks.has(node.kind) || isLiteralBlock(node.kind)) block = node
    if (isLiteralBlock(node.kind) && !openerLine) context.type = 'literal'
    if (projected > node.range.start && projected < node.range.end) {
      if (node.kind === 'inline-code') context.isInInlineCode = true
      if (node.kind === 'inline-math') context.isInInlineMath = true
    }
  }
  return { context, block }
}

/** Language facts at a position in an existing owned syntax tree. */
export function documentInputContext(root: MarkdownAstNode, position: number): Readonly<DocumentInputSyntaxContext> | undefined {
  const located = inputSyntaxAt(root, position)
  return located === undefined ? undefined : Object.freeze(located.context)
}

/** Resolve intrinsic cell offsets against the current shared syntax owner. */
export function inputSourceRange(core: DocumentCore, revision: DocumentRevision, selection: DocumentInputSelection | DocumentInputTarget): SourceRange {
  if ('start' in selection) return selection
  if ('ranges' in selection) {
    const copied = copyDocumentSelection(selection, revision.sourceLength)
    const primary = copied.ranges[copied.primary]
    if (copied.ranges.length !== 1 || primary === undefined) throw new RangeError('Native input requires exactly one text selection')
    return { start: Math.min(primary.anchor, primary.focus), end: Math.max(primary.anchor, primary.focus) }
  }
  if (selection.kind === 'model-text') return resolveModelTextSelection(core, revision, selection).bounds
  const resolved = resolveTableCell(core, revision, selection.cell)
  const { anchor, focus } = selection
  if (![anchor, focus].every(value => Number.isInteger(value) && value >= 0 && value <= resolved.caretEnd - resolved.start)) throw new RangeError('Input selection is outside the current cell')
  return { start: resolved.start + Math.min(anchor, focus), end: resolved.start + Math.max(anchor, focus) }
}

/**
 * A caret in an empty fenced payload addresses that literal value, whose first
 * text also owns the payload's line; a raw source insertion would join the closer.
 */
function emptyFencedPayloadInput(core: DocumentCore, revision: DocumentRevision, action: DocumentInputAction, regionalSyntax?: (range: SourceRange) => MarkupSyntax | undefined): DocumentInputAction {
  if ('kind' in action || !action.inputType.startsWith('insert') || action.inputType === 'insertParagraph' || action.inputType === 'insertLineBreak' || !action.data) return action
  if (!('ranges' in action.selection) || action.selection.ranges.length !== 1) return action
  const caret = action.selection.ranges[action.selection.primary]
  if (caret === undefined || caret.anchor !== caret.focus) return action
  const syntax = regionalSyntax?.({ start: caret.anchor, end: caret.anchor }) ?? core.project(revision, 'markup').syntax
  if (!isEmptyFencedPayloadPoint(core, revision, caret.anchor, syntax)) return action
  const selection = { kind: 'model-text' as const, anchor: caret.anchor, focus: caret.anchor }
  return { ...action, selection, range: selection }
}

/** Normalize current model addresses only; physical cell materialization is an edit. */
export function planInput(core: DocumentCore, revision: DocumentRevision, action: DocumentInputAction, enterConversion: (range: SourceRange) => ParagraphEnterConversion | undefined, physicalLines: () => MarkdownLineIndex, regionalSyntax?: (range: SourceRange) => MarkupSyntax | undefined, untracked = false, preview?: TablePreview): DocumentInputPlan {
  const plan = planUnspelledInput(core, revision, action, enterConversion, physicalLines, regionalSyntax, untracked)
  if (!untracked || preview === undefined) return plan
  if (!('kind' in action)) {
    // Enter in a table's last row and text written into a cell a short row
    // lacks edit that table too; their plans have no cell text to overlay.
    if (action.selection.kind !== 'table-cell' || plan.edits.length === 0) return plan
    const cell = resolveTableCell(core, revision, action.selection.cell)
    if (cell.slotStart !== undefined && action.inputType !== 'insertParagraph') return plan
    return Object.freeze(respellTableResult(plan, cell.syntax.coordinates.toSource(cell.table.range.start, 'previous'), preview, true))
  }
  // A command that moves text into or out of a table's cells edits that table.
  if (tableBoundaryCommands.has(action.command)) {
    const first = plan.edits[0]
    const syntax = first === undefined ? undefined : core.project(revision, 'markup').syntax
    const table = first === undefined || syntax === undefined ? undefined : tableAt(syntax, first.start)
    return table === undefined || syntax === undefined ? plan : Object.freeze(respellTableResult(plan, syntax.coordinates.toSource(table.range.start, 'previous'), preview))
  }
  if (!tableCommands.has(action.command)) return plan
  // Upstream writes the table afresh after a table command as well; the
  // padding is spelling, so a tracked command never suggests it.
  if ('target' in action && typeof action.target === 'object' && 'row' in action.target) {
    const target = resolveTableCell(core, revision, action.target)
    return Object.freeze(respellTableResult(plan, target.syntax.coordinates.toSource(target.table.range.start, 'previous'), preview))
  }
  return Object.freeze(respellEditedTable(core, revision, plan, inputSourceRange(core, revision, action.selection), preview))
}

const tableBoundaryCommands = new Set(['joinParagraphBackward', 'joinParagraphForward', 'exitTable'])
const tableCommands = new Set(['insertTableRow', 'insertTableColumn', 'removeTableRow', 'removeTableColumn', 'alignTableColumn', 'moveTableRow', 'moveTableColumn'])

function planUnspelledInput(core: DocumentCore, revision: DocumentRevision, action: DocumentInputAction, enterConversion: (range: SourceRange) => ParagraphEnterConversion | undefined, physicalLines: () => MarkdownLineIndex, regionalSyntax: ((range: SourceRange) => MarkupSyntax | undefined) | undefined, untracked: boolean): DocumentInputPlan {
  if ('kind' in action && action.command === 'moveText') return planTextMove(core, revision, action, physicalLines())
  if ('kind' in action && action.command === 'moveBlock') return planBlockMove(core, revision, action, physicalLines())
  action = constrainLiteralDeletion(core, revision, action, regionalSyntax)
  action = emptyFencedPayloadInput(core, revision, action, regionalSyntax)
  if (action.selection.kind === 'model-text' || 'range' in action && 'kind' in action.range && action.range.kind === 'model-text') {
    const plan = planModelTextInput(core, revision, action, physicalLines(), normalized => planStructuralInput(core, revision, normalized, enterConversion, physicalLines))
    // A cell's text addressed by its model value is still that cell's text.
    return untracked && !('kind' in action) && action.inputType !== 'insertParagraph' ? Object.freeze(respellCellTextInput(core, revision, plan)) : plan
  }
  if ('kind' in action && (action.command === 'moveTableColumn' || action.command === 'moveTableRow')) return planTableMove(core, revision, action)
  const actual = copyDocumentSelection(action.selection, revision.sourceLength)
  const selectedCell = actual.kind === 'table-cell' ? resolveTableCell(core, revision, actual.cell) : undefined
  if ('kind' in action && action.command === 'tableBoundaryBackspace' && actual.kind === 'table-cell' && selectedCell !== undefined) {
    if (actual.anchor !== 0 || actual.focus !== 0) throw new RangeError('Table boundary Backspace requires a cell-start caret')
    const cell = previousTableCell(core.project(revision, 'markup').syntax, actual.cell)
    if (cell !== undefined) {
      const previous = resolveTableCell(core, revision, cell)
      const offset = previous.end - previous.start
      return Object.freeze({ edits: Object.freeze([]), reconciliation: Object.freeze([]), selection: copyDocumentSelection({ kind: 'table-cell', cell, anchor: offset, focus: offset }, revision.sourceLength) })
    }
  }
  const primary = 'ranges' in actual ? actual.ranges[actual.primary] : actual
  if (primary === undefined || 'ranges' in actual && actual.ranges.length !== 1) throw new RangeError('Native input requires exactly one text selection')
  const backward = primary.anchor > primary.focus
  const finish = (plan: DocumentSourceInputPlan): DocumentInputPlan => Object.freeze({ ...plan, selection: Object.freeze({ ranges: Object.freeze([Object.freeze({ anchor: backward ? plan.selection.end : plan.selection.start, focus: backward ? plan.selection.start : plan.selection.end })]), primary: 0 }) })
  const selection = inputSourceRange(core, revision, action.selection)
  const normalized: DocumentInputAction<SourceRange> = 'range' in action
    ? { ...action, selection, range: inputSourceRange(core, revision, action.range) }
    : { ...action, selection }
  // Typing over a selection that reaches into a table keeps the table's grid.
  if (untracked && !('kind' in action) && action.inputType === 'insertText' && 'ranges' in actual && selection.start < selection.end) {
    const span = planTableSpanCut(core, revision, regionalSyntax?.(selection) ?? core.project(revision, 'markup').syntax, selection, action.data ?? '')
    if (span !== undefined) return finish({ edits: Object.freeze([...span.edits]), selection: Object.freeze({ start: span.caret, end: span.caret }), reconciliation: Object.freeze([]) })
  }
  const plan = planSourceInput(core, revision, normalized, enterConversion, physicalLines, selectedCell, regionalSyntax)
  if ('kind' in action && action.command === 'tableBoundaryBackspace' && plan.edits.length === 0 && plan.selection.start === selection.start && plan.selection.end === selection.end) return Object.freeze({ ...plan, selection: actual })
  if (selectedCell === undefined || selectedCell.slotStart !== undefined || 'kind' in action || action.inputType === 'insertParagraph' ||
    plan.edits.length === 0 || plan.edits.every(edit => edit.start === edit.end && edit.insert.length === 0)) {
    // Upstream writes the table afresh after each edit of a cell's text. Its
    // padding is spelling rather than a suggestion, so tracking leaves it.
    const cellEdit = untracked && selectedCell?.slotStart !== undefined && !('kind' in action) && action.inputType !== 'insertParagraph' &&
      plan.edits.length > 0 && plan.edits.every(edit => selectedCell.start <= edit.start && edit.end <= selectedCell.caretEnd)
    return finish(cellEdit ? respellTableInput(core, revision, selectedCell.syntax, selectedCell.table, plan) : plan)
  }
  const edit = plan.edits[0]
  if (plan.edits.length !== 1 || edit === undefined || edit.start !== selectedCell.start || edit.end !== selectedCell.end) throw new RangeError('Implicit cell input requires an insertion into its empty content')
  // A pipe typed into the cell stays its text, as upstream escapes it.
  const escape = (text: string) => text.replace(/(?<!\\)\|/gu, '\\|')
  const materialized = materializeTableCellEdit(selectedCell, { ...edit, insert: escape(edit.insert) })
  const insert = materialized.edit.insert
  const position = (offset: number) => {
    const typed = edit.insert.slice(0, Math.max(0, offset - edit.start))
    return offset + materialized.prefixLength + escape(typed).length - typed.length
  }
  return finish({
    edits: Object.freeze([materialized.edit]),
    selection: Object.freeze({ start: position(plan.selection.start), end: position(plan.selection.end) }),
    reconciliation: Object.freeze([{ start: edit.start, end: edit.start + ('data' in normalized ? normalized.data?.length ?? 0 : 0), insert }])
  })
}

/** Plans native input against the current revision's owned syntax, without reparsing a draft. */
function planSourceInput(core: DocumentCore, revision: DocumentRevision, action: DocumentInputAction<SourceRange>, enterConversion: (range: SourceRange) => ParagraphEnterConversion | undefined, physicalLines: () => MarkdownLineIndex, selectedCell?: ReturnType<typeof resolveTableCell>, regionalSyntax?: (range: SourceRange) => MarkupSyntax | undefined): DocumentSourceInputPlan {
  if ('kind' in action) return planStructuralInput(core, revision, action, enterConversion, physicalLines, selectedCell)
  const { selection, inputType, data, options } = action
  if (inputType === 'cancelComposition') {
    return Object.freeze({ edits: Object.freeze([]), selection: Object.freeze({ ...selection }), reconciliation: Object.freeze([]) })
  }
  if (inputType === 'insertParagraph' || inputType === 'insertLineBreak') {
    const trailingLine = selectedCell === undefined ? planSetextTrailingLine(core, revision, action, core.project(revision, 'markup').syntax) : undefined
    if (trailingLine !== undefined && !('moveTo' in trailingLine)) return trailingLine
    const broken = trailingLine === undefined ? action : { ...action, selection: trailingLine.moveTo, range: trailingLine.moveTo }
    return planStructuralInput(core, revision, broken, enterConversion, physicalLines, selectedCell)
  }
  const syntax = selectedCell === undefined && selection.start === selection.end
    ? regionalSyntax?.({ start: Math.min(selection.start, action.range.start), end: Math.max(selection.end, action.range.end) }) ?? core.project(revision, 'markup').syntax
    : core.project(revision, 'markup').syntax
  const trailingLine = selectedCell === undefined ? planSetextTrailingLine(core, revision, action, syntax) : undefined
  if (trailingLine !== undefined && !('moveTo' in trailingLine)) return trailingLine
  // Backspace after the indentation that emptied indented code leaves on the
  // line of a root empty paragraph removes it, as upstream resets that block.
  if (inputType === 'deleteContentBackward' && selectedCell === undefined && selection.start === selection.end &&
      action.range.end === selection.start && action.range.start < selection.start) {
    const preceding = core.sourceSlice(revision, { start: Math.max(0, selection.start - 256), end: selection.start })
    const lineStart = selection.start - preceding.length + Math.max(preceding.lastIndexOf('\n'), preceding.lastIndexOf('\r')) + 1
    const rest = core.sourceSlice(revision, { start: selection.start, end: Math.min(revision.sourceLength, selection.start + 256) })
    if (lineStart < selection.start && /^[ \t]+$/u.test(core.sourceSlice(revision, { start: lineStart, end: selection.start })) &&
        /^[ \t]*(?:[\r\n]|$)/u.test(rest) &&
        syntax.ast.root.children.some(node => node.kind === 'paragraph' && node.range.start === node.range.end &&
          syntax.coordinates.toSource(node.range.start, 'next') === lineStart)) {
      return Object.freeze({
        edits: Object.freeze([Object.freeze({ start: lineStart, end: selection.start, insert: '' })]),
        selection: Object.freeze({ start: lineStart, end: lineStart }),
        reconciliation: Object.freeze([Object.freeze({ start: lineStart, end: action.range.start, insert: '' })])
      })
    }
  }
  // Plain typing belongs to the live caret. Browser normalization can move its
  // collapsed target across an elided annotation edge or out of an empty cell.
  // Expanded replacements and non-typing insertion targets retain their intent.
  const range = inputType.startsWith('insert') && selection.start === selection.end &&
    action.range.start === action.range.end &&
    (inputType === 'insertText' ||
      syntax.coordinates.toProjected(selection.start, 'next') === syntax.coordinates.toProjected(action.range.start, 'next'))
    ? selection
    : action.range
  const projected = syntax.coordinates.toProjected(range.start, 'next')
  const projectedEnd = syntax.coordinates.toProjected(range.end, 'previous')
  // A caret in a cell's trailing padding, or beside a comment that is its only
  // content, continues the cell's text.
  const located = inputSyntaxAt(selectedCell?.cell ?? syntax.ast.root, selectedCell === undefined
    ? projected
    : Math.max(selectedCell.cell.range.start, Math.min(projected, selectedCell.cell.range.end)))
  if (located === undefined) throw new Error('Input position has no owned syntax context')
  const { context, block } = located
  const character = (position: number): { text: string, source: number } | undefined => {
    if (position < block.range.start || position >= block.range.end) return undefined
    const origin = syntax.coordinates.originAt(position)
    return origin.kind === 'source'
      ? { text: core.sourceSlice(revision, { start: origin.sourceOffset, end: origin.sourceOffset + 1 }), source: origin.sourceOffset }
      : undefined
  }
  const beforeOrigin = character(projected - 1)
  const afterOrigin = character(projectedEnd)
  // Upstream pairs from the raw characters beside the caret, where annotation
  // delimiters are ordinary punctuation. Payload neighbors are already exact.
  const delimiter = (position: number) =>
    inputType === 'insertText' && position >= 0 && position < revision.sourceLength && isAnnotationDelimiter(revision.annotations, position)
      ? core.sourceSlice(revision, { start: position, end: position + 1 })
      : undefined
  const delimiterAfter = delimiter(range.end)
  const before = delimiter(range.start - 1) ?? beforeOrigin?.text ?? ''
  const after = delimiterAfter ?? afterOrigin?.text ?? ''
  const deleted = core.sourceSlice(revision, range)
  // Pair deletion recognizes one exposed character, even when its browser
  // target also spans hidden annotation markers or comments in source.
  const projectedDeletion = selection.start === selection.end && inputType.startsWith('delete') && projectedEnd - projected === 1
    ? character(projected)
    : undefined
  const deletedOrigin = projectedDeletion !== undefined && range.start <= projectedDeletion.source && projectedDeletion.source < range.end
    ? projectedDeletion
    : undefined
  const policyDeleted = deletedOrigin?.text ?? deleted
  const start = before.length
  const end = start + policyDeleted.length
  const pairing = (pairingOptions: IInputPairingOptions) => applyInputPairing({
    text: before + policyDeleted + after,
    start,
    end,
    offsetInBlock: projected - block.range.start,
    collapsed: selection.start === selection.end,
    inputType,
    data,
    options: pairingOptions,
    context
  })
  const paired = pairing(options)
  // Stepping over a matching delimiter would place the caret inside the
  // annotation's syntax, which has no caret position; type the key instead.
  const admitted = paired.kind === 'selection' && delimiterAfter !== undefined
    ? pairing({ autoPairBracket: false, autoPairMarkdownSyntax: false, autoPairQuote: false })
    : paired
  const lineBlock = admitted.kind === 'replace' && selection.start === selection.end && context.type === 'format' &&
    block.kind === 'paragraph' && inputType === 'insertText'
    ? planTypedIndentedCode(core, revision, syntax, block, range.start, data)
    : undefined
  const result = admitted
  const raw = data ?? ''
  const reconciliation: DocumentSourceEdit[] = []
  let edits: DocumentSourceEdit[]
  let nextSelection: SourceRange
  if (result.kind === 'selection') {
    if (afterOrigin === undefined) throw new Error('Input policy selected an unavailable closer')
    edits = []
    nextSelection = { start: afterOrigin.source + 1, end: afterOrigin.source + 1 }
    reconciliation.push(afterOrigin.source === range.end
      ? { start: range.start + raw.length, end: range.end + raw.length + 1, insert: '' }
      : { start: range.start, end: range.start + raw.length, insert: '' })
  } else if (result.kind === 'wrap') {
    const [open, close] = result.edits
    edits = [
      { start: range.start, end: range.start, insert: open.text },
      { start: range.end, end: range.end, insert: close.text }
    ]
    nextSelection = { start: range.start + open.text.length, end: range.end + open.text.length }
    reconciliation.push({ start: range.start + raw.length, end: range.start + raw.length, insert: deleted + close.text })
  } else {
    const edit = result.edit
    const leading = edit.start < start ? beforeOrigin : undefined
    const trailing = edit.end > end ? afterOrigin : undefined
    // A key typed within a run of spaces may land at the run's end; the
    // bytes are the same and the caret follows the converted line's content.
    const keyAt = lineBlock?.at ?? range.start
    const primary = deletedOrigin === undefined
      ? { start: keyAt, end: keyAt + range.end - range.start, insert: edit.text }
      : { start: deletedOrigin.source, end: deletedOrigin.source + 1, insert: edit.text }
    edits = [primary]
    if (deletedOrigin !== undefined) {
      const retained = core.sourceSlice(revision, { start: range.start, end: primary.start }) +
        core.sourceSlice(revision, { start: primary.end, end: range.end })
      if (retained.length > 0) reconciliation.push({ start: range.start, end: range.start, insert: retained })
    }
    if (leading !== undefined) {
      if (leading.source + 1 === primary.start) primary.start = leading.source
      else edits.unshift({ start: leading.source, end: leading.source + 1, insert: '' })
      reconciliation.push({ start: leading.source, end: leading.source + 1, insert: '' })
    }
    if (trailing !== undefined) {
      if (trailing.source === primary.end) primary.end = trailing.source + 1
      else edits.push({ start: trailing.source, end: trailing.source + 1, insert: '' })
      const echoPosition = trailing.source + raw.length - (range.end - range.start)
      reconciliation.push({ start: echoPosition, end: echoPosition + 1, insert: '' })
    }
    let caret = leading?.source ?? keyAt + result.selection.start - start
    if (edit.text.length > raw.length) {
      reconciliation.push({
        start: range.start + raw.length, end: range.start + raw.length, insert: edit.text.slice(raw.length)
      })
    }
    // The converted line's other edits surround the typed key without
    // overlapping it; one ending where the key's edit begins joins it.
    const echoShift = raw.length - (range.end - range.start)
    for (const extra of lineBlock?.edits ?? []) {
      const precedes = extra.end <= primary.start
      reconciliation.push(precedes ? { ...extra } : { start: extra.start + echoShift, end: extra.end + echoShift, insert: extra.insert })
      if (precedes) caret += extra.insert.length - (extra.end - extra.start)
      if (extra.end === primary.start) {
        primary.start = extra.start
        primary.insert = extra.insert + primary.insert
      } else {
        edits.push({ ...extra })
      }
    }
    const emptied = lineBlock === undefined && selectedCell === undefined && inputType.startsWith('delete') && context.type === 'format' && block.kind === 'paragraph'
      ? planEmptiedParagraph(core, revision, syntax, block, edits)
      : undefined
    // Upstream writes text typed after a lone quote marker as the quote's
    // paragraph, after the marker's space.
    const quoteSpace = inputType === 'insertText' && selection.start === selection.end && block.kind === 'paragraph' &&
      block.range.start === block.range.end && (data ?? '') !== '' && !/^\s/u.test(data ?? '') &&
      syntaxPathAt(syntax.ast.root, block.range.start).at(-2)?.kind === 'blockquote' &&
      keyAt > 0 && core.sourceSlice(revision, { start: keyAt - 1, end: keyAt }) === '>'
      ? [{ start: keyAt, end: keyAt, insert: ' ' }]
      : []
    for (const extra of [...(emptied ?? []), ...quoteSpace]) {
      const precedes = extra.end <= primary.start
      reconciliation.push(precedes ? { ...extra } : { start: extra.start + echoShift, end: extra.end + echoShift, insert: extra.insert })
      if (precedes) caret += extra.insert.length
      if (extra.end === primary.start) {
        primary.start = extra.start
        primary.insert = extra.insert + primary.insert
      } else if (extra.start === primary.end) {
        primary.end = extra.end
        primary.insert += extra.insert
      } else {
        edits.push({ ...extra })
      }
    }
    edits.sort((a, b) => a.start - b.start)
    nextSelection = { start: caret, end: caret + result.selection.end - result.selection.start }
  }
  if (range.start !== action.range.start && action.range.start === action.range.end) {
    // Relate the browser's exact target to the model operation by their owned
    // source intervals. This preserves hidden bytes without diffing or reparsing.
    const start = Math.min(action.range.start, ...edits.map(edit => edit.start))
    const end = Math.max(action.range.end, ...edits.map(edit => edit.end))
    let insert = core.sourceSlice(revision, { start, end })
    for (const edit of [...edits].reverse()) {
      insert = insert.slice(0, edit.start - start) + edit.insert + insert.slice(edit.end - start)
    }
    reconciliation.splice(0, reconciliation.length, { start, end: end + raw.length, insert })
  }
  let composed = reconciliation.sort((a, b) => a.start - b.start)
  // Upstream edits a thematic break's text as a paragraph's, which it
  // re-evaluates after each input.
  const rule = block.kind === 'document' ? syntaxPathAt(syntax.ast.root, projected).find(node => node.kind === 'thematic-break') : undefined
  const updated = rule ?? block
  const update = lineBlock === undefined && selectedCell === undefined && context.type === 'format' && (updated.kind === 'paragraph' || updated.kind === 'heading' || updated.kind === 'thematic-break') &&
    (typedInputTypes.has(inputType) || inputType.startsWith('delete') && inputType !== 'deleteByCut' && inputType !== 'deleteByDrag')
    ? planInlineUpdate(core, revision, syntax, updated, edits, nextSelection)
    : undefined
  if (update !== undefined) {
    // The conversion belongs to this input: it is composed into the same
    // operation rather than applied after it.
    edits = composeSourceEdits(edits, update.edits, update.result)
    composed = composeSourceEdits(composed, update.edits, update.result)
    nextSelection = update.selection
  }
  if (rule !== undefined && lineBlock === undefined && selectedCell === undefined && context.type === 'format') {
    const read = editedSourceReader(core, revision, edits)
    const separators = planDemotedRuleSeparation(core, revision, syntax, rule, edits, read)
    if (separators.length > 0) {
      edits = composeSourceEdits(edits, separators, read)
      composed = composeSourceEdits(composed, separators, read)
      const shift = (position: number) => position + separators.filter(edit => edit.start <= position).reduce((sum, edit) => sum + edit.insert.length, 0)
      nextSelection = { start: shift(nextSelection.start), end: shift(nextSelection.end) }
    }
  }
  return Object.freeze({
    edits: Object.freeze(edits.map(edit => Object.freeze(edit))),
    selection: Object.freeze(nextSelection),
    reconciliation: Object.freeze(composed.map(edit => Object.freeze(edit)))
  })
}

// Upstream re-evaluates a block's type on each of these inputs.
const typedInputTypes: ReadonlySet<string> = new Set(['insertText', 'insertCompositionText', 'insertReplacementText'])

export interface DocumentInputResult {
  readonly policy: DocumentInputPlan
  /** Omitted when this compilation has no proven coordinate mapping. */
  readonly compilerReconciliation?: readonly DocumentSourceEdit[]
  readonly selection?: DocumentInputSelection
}

export function reconcileInput(
  core: DocumentCore, previous: DocumentRevision, policy: DocumentInputPlan, commit: DocumentCommit | null, action: DocumentInputAction
): DocumentInputResult {
  const applied = commit?.change.appliedEdits ?? []
  const next = commit?.revision ?? previous
  if (commit === null && policy.edits.some(edit => core.sourceSlice(previous, edit) !== edit.insert)) throw new RangeError('Input without a commit must preserve source')
  const unchanged = applied.length === policy.edits.length && applied.every((edit, index) => {
    const requested = policy.edits[index]
    return requested !== undefined && edit.start === requested.start && edit.end === requested.end && edit.insert === requested.insert
  })
  const edit = policy.edits.length === 1 ? policy.edits[0] : undefined
  const joinSyntax = 'kind' in action && action.command === 'joinParagraphBackward' ? core.project(previous, 'markup').syntax : undefined
  const codeJoin = joinSyntax !== undefined && paragraphBackwardStructuralTarget(joinSyntax,
    joinSyntax.coordinates.toProjected(inputSourceRange(core, previous, action.selection).start, 'next')) !== undefined
  const compilerReconciliation = unchanged || commit === null
    ? Object.freeze([])
    : edit === undefined
      ? sparseEditingReconciliation(core, previous, policy.edits, commit, 'kind' in action && action.command === 'moveText', policy.editScope ?? 'structure')
      : editingReconciliation(core, previous, edit, commit, codeJoin || 'kind' in action && (action.command === 'changeBlock' || action.command === 'createFootnote' || action.command === 'setCodeLanguage' || action.command === 'createTable' || action.command === 'createFrontMatter' || action.command === 'changeThematicBreak' || action.command === 'createMathBlock' || action.command === 'createHtmlBlock' || action.command === 'createCodeBlock' || action.command === 'wrapCodeBlocks' || action.command === 'resetCodeBlock' || (action.command === 'changeHeading' || action.command === 'changeBlockquote') && action.change.type === 'quick-insert') ? 'structure' : 'visible')
  if (compilerReconciliation === undefined) return Object.freeze({ policy })
  const deletion = policy.edits.length > 0 && policy.edits.every(edit => edit.insert.length === 0)
  const point = (position: number): number => {
    let delta = 0
    for (const mapping of compilerReconciliation) {
      if (mapping.start > position) break
      if (mapping.start === mapping.end) {
        if (mapping.start < position || deletion) delta += mapping.insert.length
      } else if (position < mapping.end) return mapping.start + delta + mapping.insert.length
      else delta += mapping.insert.length - (mapping.end - mapping.start)
    }
    return position + delta
  }
  if (policy.selection.kind === 'model-text') {
    if ('kind' in action && action.command === 'moveBlock') {
      const mapped = (position: DocumentModelTextSelection['anchor']) => typeof position === 'number' ? point(position) : { text: { start: point(position.text.start), end: point(position.text.end) }, offset: position.offset }
      const selection = { ...policy.selection, anchor: mapped(policy.selection.anchor), focus: mapped(policy.selection.focus) }
      resolveModelTextSelection(core, next, selection)
      return Object.freeze({ policy, compilerReconciliation, selection })
    }
    resolveModelTextSelection(core, next, policy.selection)
    if (policy.edits.length !== 0 || applied.length !== 0) throw new RangeError('Retained intrinsic input requires an unchanged document')
    return Object.freeze({ policy, compilerReconciliation, selection: policy.selection })
  }
  if (policy.selection.kind === 'table-cell') {
    if ('kind' in action && action.command === 'moveBlock') {
      const original = policy.selection.cell
      const cell = { ...original, table: { start: point(original.table.start), end: point(original.table.end) } }
      resolveTableCell(core, next, cell)
      return Object.freeze({ policy, compilerReconciliation, selection: { ...policy.selection, cell } })
    }
    if (policy.edits.length !== 0 || applied.length !== 0) throw new RangeError('Intrinsic navigation selection requires an unchanged document')
    resolveTableCell(core, next, policy.selection.cell)
    return Object.freeze({ policy, compilerReconciliation, selection: copyDocumentSelection(policy.selection, next.sourceLength) })
  }
  const planned = policy.selection.ranges[policy.selection.primary]
  if (policy.selection.ranges.length !== 1 || planned === undefined) throw new RangeError('Native input requires exactly one planned text selection')
  // Structural commands may preserve selected source even when their syntax
  // edits compile into suggestions. Retained boundaries belong outside those
  // inserted delimiters; newly authored payload keeps the compiler's own map.
  const original = 'kind' in action && action.command !== 'moveBlock' && action.command !== 'moveText' && 'ranges' in action.selection ? action.selection.ranges[action.selection.primary] : undefined
  const anchor = (original === undefined ? undefined : retainedSourceEndpoint(core, previous, original.anchor, planned.anchor, policy.edits, applied)) ?? point(planned.anchor)
  const focus = (original === undefined ? undefined : retainedSourceEndpoint(core, previous, original.focus, planned.focus, policy.edits, applied)) ?? point(planned.focus)
  const selection = { start: Math.min(anchor, focus), end: Math.max(anchor, focus) }
  const directed = copyDocumentSelection({ ranges: [{ anchor, focus }], primary: 0 }, next.sourceLength)
  if (action.selection.kind === 'table-cell') {
    if ('kind' in action && (action.command === 'moveTableColumn' || action.command === 'moveTableRow') &&
      action.selection.cell.table.start === action.target.table.start && action.selection.cell.table.end === action.target.table.end) {
      const original = action.selection.cell
      const table = {
        start: positionAfter(compilerReconciliation, positionAfter(policy.edits, original.table.start, false), true),
        end: positionAfter(compilerReconciliation, positionAfter(policy.edits, original.table.end, true), false)
      }
      const coordinates = core.project(next, 'markup').syntax.coordinates
      table.start = coordinates.toSource(coordinates.toProjected(table.start, 'next'), 'previous')
      table.end = coordinates.toSource(coordinates.toProjected(table.end, 'previous'), 'next')
      const cell = { ...original, table, ...(action.command === 'moveTableColumn' ? { column: movedTableIndex(original.column, action.target.column, action.column) } : { row: movedTableIndex(original.row, action.target.row, action.row) }) }
      resolveTableCell(core, next, cell)
      return Object.freeze({ policy, compilerReconciliation, selection: Object.freeze({ ...action.selection, cell }) })
    }
    if ('kind' in action && action.command === 'alignTableColumn') return Object.freeze({ policy, compilerReconciliation, selection: tableCellSelectionAfter(core.project(next, 'markup').syntax, next.sourceLength, applied, action.selection) })
    const original = action.selection.cell
    const table = { start: positionAfter(applied, original.table.start, false), end: positionAfter(applied, original.table.end, true) }
    if (!('kind' in action) && action.inputType !== 'insertParagraph') {
      const cell = resolveTableCell(core, next, { ...original, table })
      if (cell.start === cell.end && cell.slotStart !== undefined && cell.slotEnd !== undefined &&
        cell.slotStart <= selection.start && selection.end <= cell.slotEnd) {
        // Removing the final payload leaves the parser-owned empty cell. Its
        // retained padding has no content offsets; the cell's only caret is 0.
        return Object.freeze({ policy, compilerReconciliation, selection: Object.freeze({ kind: 'table-cell', cell: { ...original, table }, anchor: 0, focus: 0 }) })
      }
      if (selection.start < cell.start || selection.end > cell.caretEnd) throw new RangeError('Accepted input selection is outside its cell')
      return Object.freeze({ policy, compilerReconciliation, selection: Object.freeze({ kind: 'table-cell', cell: { ...original, table }, anchor: anchor - cell.start, focus: focus - cell.start }) })
    }
    if (!('kind' in action) && action.inputType === 'insertParagraph') {
      const previousCell = resolveTableCell(core, previous, original)
      if (previousCell.table.children[original.row + 1] !== undefined) {
        const address = { table, row: original.row + 1, column: 0 }
        const cell = resolveTableCell(core, next, address)
        return Object.freeze({ policy, compilerReconciliation, selection: Object.freeze({ kind: 'table-cell', cell: address, anchor: anchor - cell.start, focus: focus - cell.start }) })
      }
      return Object.freeze({ policy, compilerReconciliation, selection: directed })
    }
    const address = tableCellSelectionAtSource(core.project(next, 'markup').syntax, selection)
    if (address !== undefined) return Object.freeze({ policy, compilerReconciliation, selection: Object.freeze(anchor > focus ? { ...address, anchor: address.focus, focus: address.anchor } : address) })
  }
  return Object.freeze({ policy, compilerReconciliation, selection: directed })
}
