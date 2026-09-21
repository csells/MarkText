import type { DocumentCore, DocumentRevision, DocumentSourceEdit, SourceRange } from './documentCore.js'
import { inputSourceRange, type DocumentInputAction, type DocumentInputPlan } from './inputPlanning.js'
import { markupSourceFragment } from './markupSourceFragment.js'
import { materializeModelTextEdit, modelTextSelectionValue, resolveModelTextPoint, resolveModelTextSelection } from './modelText.js'
import type { MarkdownLineIndex } from './revision.js'
import { positionAfter } from './sourcePosition.js'
import type { DocumentModelTextPoint } from './sourceInputPlanning.js'
import { prepareTextMoveTableInsertion } from './textMoveTableInsertion.js'

function spellingPoint(core: DocumentCore, revision: DocumentRevision, point: DocumentModelTextPoint): DocumentModelTextPoint {
  if (typeof point === 'number') return point
  const resolved = resolveModelTextPoint(core, revision, point)
  const node = resolved.node
  if (node === undefined || node.semanticTextSegments === undefined) return point
  if (node.semanticTextSegments.some(spelling => resolved.syntax.coordinates.toSource(spelling.range.start, 'next') === point.text.start && resolved.syntax.coordinates.toSource(spelling.range.end, 'previous') === point.text.end)) return point
  let raw = node.range.start
  let value = 0
  for (const spelling of node.semanticTextSegments) {
    const plain = spelling.range.start - raw
    if (point.offset < value + plain) return resolved.syntax.coordinates.toSource(raw + point.offset - value, 'next')
    value += plain
    if (point.offset <= value + spelling.value.length) {
      return {
        text: { start: resolved.syntax.coordinates.toSource(spelling.range.start, 'next'), end: resolved.syntax.coordinates.toSource(spelling.range.end, 'previous') },
        offset: point.offset - value
      }
    }
    value += spelling.value.length
    raw = spelling.range.end
  }
  return resolved.syntax.coordinates.toSource(raw + point.offset - value, 'previous')
}

/** Normalize a shared literal spelling once, then move the exact owned payload. */
function moveWithinLiteralValue(core: DocumentCore, revision: DocumentRevision, selected: ReturnType<typeof resolveModelTextSelection>, target: ReturnType<typeof resolveModelTextSelection>, lines: MarkdownLineIndex): DocumentInputPlan {
  const values = new Map<string, ReturnType<typeof materializeModelTextEdit>>()
  for (const point of [selected.first.point, selected.last.point, target.first.point]) {
    if (typeof point === 'number') continue
    const anchor = { text: point.text, offset: 0 }
    values.set(`${point.text.start}:${point.text.end}`, materializeModelTextEdit(core, revision, { kind: 'model-text', anchor, focus: anchor }, '', lines))
  }
  const materialized = [...values.values()].sort((a, b) => a.edit.start - b.edit.start)
  const normalize = materialized.map(value => value.edit)
  const from = Math.min(selected.bounds.start, target.bounds.start)
  const end = Math.max(selected.bounds.end, target.bounds.end)
  let value = core.sourceSlice(revision, { start: from, end })
  for (const edit of [...normalize].reverse()) value = value.slice(0, edit.start - from) + edit.insert + value.slice(edit.end - from)
  const position = (point: DocumentModelTextPoint): number => {
    if (typeof point === 'number') return positionAfter(normalize, point, false) - from
    const index = materialized.findIndex(value => value.edit.start === point.text.start && value.edit.end === point.text.end)
    const value = materialized[index]
    if (value === undefined) throw new RangeError('Literal drag point has no owned materialization')
    return positionAfter(normalize.slice(0, index), value.caret, false) + point.offset - from
  }
  const startOffset = position(selected.first.point)
  const endOffset = position(selected.last.point)
  const drop = position(target.first.point)
  if (startOffset <= drop && drop <= endOffset) return { edits: [], selection: selected.selection, reconciliation: [] }
  const payload = value.slice(startOffset, endOffset)
  const remaining = value.slice(0, startOffset) + value.slice(endOffset)
  const at = drop > endOffset ? drop - (endOffset - startOffset) : drop
  const insert = remaining.slice(0, at) + payload + remaining.slice(at)
  const caret = from + at + payload.length
  return { edits: [{ start: from, end, insert }], selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 }, reconciliation: [], editScope: 'visible' }
}

/** One drag gesture retains both original locations until its atomic commit. */
export function planTextMove(core: DocumentCore, revision: DocumentRevision, action: Extract<DocumentInputAction, { command: 'moveText' }>, lines: MarkdownLineIndex): DocumentInputPlan {
  if (action.selection.kind === 'model-text') action = { ...action, selection: { ...action.selection, anchor: spellingPoint(core, revision, action.selection.anchor), focus: spellingPoint(core, revision, action.selection.focus) } }
  if ('kind' in action.target && action.target.kind === 'model-text') action = { ...action, target: { ...action.target, anchor: spellingPoint(core, revision, action.target.anchor), focus: spellingPoint(core, revision, action.target.focus) } }
  const source = inputSourceRange(core, revision, action.selection)
  const target = inputSourceRange(core, revision, action.target)
  const selectedValue = action.selection.kind === 'model-text' ? resolveModelTextSelection(core, revision, action.selection) : undefined
  const targetValue = 'kind' in action.target && action.target.kind === 'model-text' ? resolveModelTextSelection(core, revision, action.target) : undefined
  if (selectedValue !== undefined && targetValue !== undefined &&
    selectedValue.first.range.start === selectedValue.last.range.start && selectedValue.first.range.end === selectedValue.last.range.end &&
    selectedValue.first.range.start === targetValue.first.range.start && selectedValue.first.range.end === targetValue.first.range.end) {
    if (!targetValue.collapsed) throw new RangeError('Text drag requires a collapsed model target')
    const from = selectedValue.first.offset
    const end = selectedValue.last.offset
    const to = targetValue.first.offset
    if (from === end || !action.copy && from <= to && to <= end) return { edits: [], selection: action.selection, reconciliation: [] }
    const value = selectedValue.first.text
    const payload = value.slice(from, end)
    const remaining = action.copy ? value : value.slice(0, from) + value.slice(end)
    const at = !action.copy && to > end ? to - (end - from) : to
    const moved = remaining.slice(0, at) + payload + remaining.slice(at)
    const address = (offset: number) => ({ text: selectedValue.first.range, offset })
    const offset = at + payload.length
    if (moved === value) return { edits: [], selection: { kind: 'model-text', anchor: address(offset), focus: address(offset) }, reconciliation: [] }
    const tableReplacement = prepareTextMoveTableInsertion(core, revision, { kind: 'model-text', anchor: address(0), focus: address(value.length) }, moved, lines, offset)
    if (tableReplacement !== undefined) return { edits: [tableReplacement.edit], selection: { ranges: [{ anchor: tableReplacement.caret, focus: tableReplacement.caret }], primary: 0 }, reconciliation: [], editScope: 'visible' }
    const materialized = materializeModelTextEdit(core, revision, { kind: 'model-text', anchor: address(0), focus: address(value.length) }, moved, lines)
    const caret = materialized.position(offset)
    return { edits: [materialized.edit], selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 }, reconciliation: [], editScope: 'visible' }
  }
  if (target.start !== target.end && !('kind' in action.target && action.target.kind === 'model-text')) throw new RangeError('Text drag requires an insertion target')
  if (source.start === source.end || !action.copy && source.start <= target.start && target.end <= source.end && selectedValue === undefined && targetValue === undefined) return { edits: [], selection: action.selection, reconciliation: [] }
  const sourceStart = resolveModelTextPoint(core, revision, selectedValue?.first.point ?? source.start)
  const sourceEnd = resolveModelTextPoint(core, revision, selectedValue?.last.point ?? source.end)
  const targetPoint = resolveModelTextPoint(core, revision, targetValue?.first.point ?? target.start)
  const literalPayload = sourceStart.literal !== undefined && sourceStart.literal === sourceEnd.literal && targetPoint.literal !== undefined
  const fragment = literalPayload
    ? { text: modelTextSelectionValue(core, revision, { kind: 'model-text', anchor: sourceStart.point, focus: sourceEnd.point }, true), mappings: [] }
    : markupSourceFragment(core, revision, source)
  let insert = fragment.text
  let removal: DocumentSourceEdit = { ...source, insert: '' }
  if (action.selection.kind === 'model-text') {
    const selected = selectedValue!
    if (selected.collapsed) return { edits: [], selection: action.selection, reconciliation: [] }
    const replacements: DocumentSourceEdit[] = []
    const replaceValue = (range: SourceRange, value: string) => {
      const first = fragment.mappings.find(mapping => mapping.before.start <= range.start && range.start <= mapping.before.end)
      const last = fragment.mappings.find(mapping => mapping.before.start <= range.end && range.end <= mapping.before.end)
      if (first === undefined || last === undefined) throw new RangeError('Selected value has no owned fragment mapping')
      replacements.push({ start: first.after + range.start - first.before.start, end: last.after + range.end - last.before.start, insert: value })
    }
    // Literal fragments already contain the parser's selected payload, without indentation.
    if (!literalPayload) {
      if (selected.first.range.start === selected.last.range.start && selected.first.range.end === selected.last.range.end) {
        replaceValue(selected.first.range, selected.first.text.slice(selected.first.offset, selected.last.offset))
      } else {
        if (typeof selected.first.point !== 'number') replaceValue(selected.first.range, selected.first.text.slice(selected.first.offset))
        if (typeof selected.last.point !== 'number') replaceValue(selected.last.range, selected.last.text.slice(0, selected.last.offset))
      }
    }
    for (const replacement of replacements.sort((a, b) => b.start - a.start)) insert = insert.slice(0, replacement.start) + replacement.insert + insert.slice(replacement.end)
    removal = materializeModelTextEdit(core, revision, action.selection, '', lines).edit
  }
  let insertion: DocumentSourceEdit = { ...target, insert }
  let caret = target.start + insert.length
  const tableInsertion = prepareTextMoveTableInsertion(core, revision, action.target, insert, lines)
  if (tableInsertion !== undefined) {
    insertion = tableInsertion.edit
    caret = tableInsertion.caret
  } else if ('kind' in action.target && action.target.kind === 'model-text' || literalPayload) {
    const targetSelection = 'kind' in action.target && action.target.kind === 'model-text' ? action.target : { kind: 'model-text' as const, anchor: target.start, focus: target.end }
    const selected = resolveModelTextSelection(core, revision, targetSelection)
    if (!selected.collapsed) throw new RangeError('Text drag requires a collapsed model target')
    const materialized = materializeModelTextEdit(core, revision, targetSelection, insert, lines)
    insertion = materialized.edit
    caret = materialized.caret
  }
  const edits = (action.copy ? [insertion] : [removal, insertion]).sort((a, b) => a.start - b.start)
  if (!action.copy && removal.start < insertion.end && insertion.start < removal.end) {
    if (selectedValue !== undefined && targetValue !== undefined && sourceStart.literal !== undefined && sourceStart.literal === sourceEnd.literal && sourceStart.literal === targetPoint.literal) return moveWithinLiteralValue(core, revision, selectedValue, targetValue, lines)
    throw new RangeError('Text drag source and target share an intrinsic value')
  }
  if (!action.copy) caret = positionAfter([removal], insertion.start, false) + caret - insertion.start
  return { edits, selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 }, reconciliation: [] }
}
