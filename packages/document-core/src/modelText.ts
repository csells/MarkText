import { codeEnter, codeTabExpansion } from '@marktext/input-policy'
import { compiledEditReconciliation } from './editingReconciliation.js'
import type { DocumentClipboardAction, DocumentClipboardPlan } from './clipboardPlanning.js'
import { positionAfter } from './sourcePosition.js'
import type { DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, SourceRange } from './documentCore.js'
import type { MarkdownLineIndex } from './revision.js'
import { copyDocumentSelection, type DocumentModelTextPoint, type DocumentModelTextSelection } from './sourceInputPlanning.js'
import { advanceMarkdownColumn } from './internal/profile1/markdownLaneState.js'
import { applyInputPairing } from './inputPolicy.js'
import type { DocumentInputAction, DocumentInputPlan, DocumentSourceInputPlan } from './inputPlanning.js'
import { isLiteralBlock } from './literalBlock.js'

/** Resolve values only from the current parser; an address contains no cached semantics. */
export function resolveModelTextPoint(core: DocumentCore, revision: DocumentRevision, point: DocumentModelTextPoint) {
  const syntax = core.project(revision, 'markup').syntax
  const numeric = typeof point === 'number'
  if (numeric) core.sourceSlice(revision, { start: point, end: point })
  let found: MarkdownAstNode | undefined
  let literal: MarkdownAstNode | undefined
  let normalized: { range: SourceRange, offset: number, text: string } | undefined
  const visit = (node: MarkdownAstNode, code?: MarkdownAstNode): void => {
    const owner = isLiteralBlock(node.kind) ? node : code
    if (node.kind === 'text') {
      const range = { start: syntax.coordinates.toSource(node.range.start, 'next'), end: syntax.coordinates.toSource(node.range.end, 'previous') }
      if (numeric) {
        if (range.start <= point && point <= range.end) {
          const text = node.attributes.semanticText
          if (typeof text === 'string' && text.length !== range.end - range.start && (point === range.start || point === range.end)) {
            found = node
            literal = owner
            normalized = { range, offset: point === range.start ? 0 : text.length, text }
          } else if (found === undefined) { found = node; literal = owner }
        }
      } else if (range.start === point.text.start && range.end === point.text.end) {
        if (found !== undefined) throw new RangeError('Model text point is ambiguous')
        found = node
        literal = owner
      }
    }
    for (const child of node.children) visit(child, owner)
  }
  visit(syntax.ast.root)
  const node = found as MarkdownAstNode | undefined
  if (numeric) {
    const value = normalized as { range: SourceRange, offset: number, text: string } | undefined
    return { point, range: value?.range ?? { start: point, end: point }, offset: value?.offset ?? 0, text: value?.text ?? '', node, literal, syntax }
  }
  const text = node?.attributes.semanticText
  if (node === undefined || typeof text !== 'string' || !Number.isSafeInteger(point.offset) || point.offset < 0 || point.offset > text.length) throw new RangeError('Model text point has no current owned value')
  return { point, range: point.text, offset: point.offset, text, node, literal, syntax }
}

export function resolveModelTextSelection(core: DocumentCore, revision: DocumentRevision, selection: DocumentModelTextSelection) {
  const copied = copyDocumentSelection(selection, revision.sourceLength)
  const anchor = resolveModelTextPoint(core, revision, copied.anchor)
  const focus = resolveModelTextPoint(core, revision, copied.focus)
  const backward = anchor.range.start > focus.range.start || anchor.range.start === focus.range.start && anchor.offset > focus.offset
  const first = backward ? focus : anchor
  const last = backward ? anchor : focus
  return { selection: copied, anchor, focus, first, last, backward, collapsed: first.range.start === last.range.start && first.range.end === last.range.end && first.offset === last.offset, bounds: { start: first.range.start, end: last.range.end } }
}

function physicalLineAt(lines: MarkdownLineIndex, offset: number) {
  let low = 0
  let high = lines.count
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2)
    if (lines.at(mid).start <= offset) low = mid + 1
    else high = mid
  }
  return lines.at(Math.max(0, low - 1))
}

function projectedSourceSlice(core: DocumentCore, revision: DocumentRevision, point: ReturnType<typeof resolveModelTextPoint>, from: number, to: number) {
  let result = ''
  for (const segment of point.syntax.coordinates.sourceSegments ?? []) {
    const start = Math.max(from, segment.projected.start)
    const end = Math.min(to, segment.projected.end)
    if (end > start) result += core.sourceSlice(revision, { start: segment.source.start + start - segment.projected.start, end: segment.source.start + end - segment.projected.start })
  }
  return result
}

/** Preserve the columns of a tab consumed by literal indentation syntax. */
function materializationPrefix(core: DocumentCore, revision: DocumentRevision, point: ReturnType<typeof resolveModelTextPoint>, lines: MarkdownLineIndex): string {
  if (point.node === undefined || point.literal === undefined || core.sourceSlice(revision, point.range) !== '\t') return ''
  const line = physicalLineAt(lines, point.node.range.start)
  let column = 0
  for (const segment of point.syntax.coordinates.sourceSegments ?? []) {
    const start = Math.max(line.start, segment.projected.start)
    const end = Math.min(point.node.range.start, segment.projected.end)
    if (end <= start) continue
    const text = core.sourceSlice(revision, { start: segment.source.start + start - segment.projected.start, end: segment.source.start + end - segment.projected.start })
    for (let index = 0; index < text.length; index++) column = advanceMarkdownColumn(column, text.charCodeAt(index))
  }
  return ' '.repeat(Math.max(0, advanceMarkdownColumn(column, 9) - column - point.text.length))
}

/** One declared value replacement, including only its touched authored spellings. */
export function materializeModelTextEdit(core: DocumentCore, revision: DocumentRevision, selection: DocumentModelTextSelection, insert: string, lines: MarkdownLineIndex) {
  const resolved = resolveModelTextSelection(core, revision, selection)
  const { first, last } = resolved
  const prefix = materializationPrefix(core, revision, first, lines) + first.text.slice(0, first.offset)
  const suffix = last.text.slice(last.offset)
  let continuation = ''
  if (first.node !== undefined && first.literal !== undefined && /[\r\n]/u.test(insert)) {
    const line = physicalLineAt(lines, first.node.range.start)
    const firstPayload = first.literal.children.find(node => node.kind === 'text' && line.start <= node.range.start && node.range.start <= line.contentEnd)
    if (firstPayload !== undefined) {
      const address = { text: { start: first.syntax.coordinates.toSource(firstPayload.range.start, 'next'), end: first.syntax.coordinates.toSource(firstPayload.range.end, 'previous') }, offset: 0 }
      continuation = projectedSourceSlice(core, revision, first, line.start, firstPayload.range.start) + materializationPrefix(core, revision, resolveModelTextPoint(core, revision, address), lines)
    }
  }
  const spell = (value: string) => value.replace(/\r\n|\r|\n/gu, ending => ending + continuation)
  const edit: DocumentSourceEdit = { start: first.range.start, end: last.range.end, insert: prefix + spell(insert) + suffix }
  const insertedStart = edit.start + prefix.length
  const position = (offset: number) => insertedStart + spell(insert.slice(0, offset)).length
  return { edit, caret: position(insert.length), insertedStart, position, resolved }
}

export function modelTextSelectionValue(core: DocumentCore, revision: DocumentRevision, selection: DocumentModelTextSelection): string {
  const { first, last } = resolveModelTextSelection(core, revision, selection)
  if (first.range.start === last.range.start && first.range.end === last.range.end) return first.text.slice(first.offset, last.offset)
  if (first.literal !== undefined && first.literal === last.literal) {
    const content = literalTextContext(core, revision, first.literal)
    return content.text.slice(content.offset(first.point), content.offset(last.point))
  }
  return first.text.slice(first.offset) + projectedSourceSlice(core, revision, first, first.syntax.coordinates.toProjected(first.range.end, 'next'), first.syntax.coordinates.toProjected(last.range.start, 'previous')) + last.text.slice(0, last.offset)
}

/** Literal value coordinates come from the parser's ordinary payload children. */
function literalTextContext(core: DocumentCore, revision: DocumentRevision, literal: MarkdownAstNode) {
  const syntax = core.project(revision, 'markup').syntax
  let length = 0
  const spans = literal.children.map(node => {
    const text = node.kind === 'soft-break' ? '\n' : node.attributes.semanticText
    if (typeof text !== 'string') throw new RangeError('Literal text requires its owned payload')
    const start = length
    length += text.length
    return { node, text, start, end: length, source: { start: syntax.coordinates.toSource(node.range.start, 'next'), end: syntax.coordinates.toSource(node.range.end, 'previous') } }
  })
  return {
    text: spans.map(span => span.text).join(''),
    offset(point: DocumentModelTextPoint): number {
      for (const span of spans) {
        if (typeof point !== 'number' && point.text.start === span.source.start && point.text.end === span.source.end) return span.start + point.offset
        if (typeof point === 'number' && point >= span.source.start && point <= span.source.end) {
          if (point === span.source.start) return span.start
          if (point === span.source.end) return span.end
          if (span.text.length === span.source.end - span.source.start) return span.start + point - span.source.start
        }
      }
      throw new RangeError('Point is outside its literal payload')
    },
    point(offset: number): DocumentModelTextPoint {
      for (const span of spans) {
        if (offset < span.start || offset > span.end) continue
        if (offset === span.start) return span.source.start
        if (offset === span.end) return span.source.end
        return span.text.length === span.source.end - span.source.start ? span.source.start + offset - span.start : { text: span.source, offset: offset - span.start }
      }
      throw new RangeError('Literal value position is outside its payload')
    }
  }
}

/** Input policy is shared; only the addressed spelling's materialization differs. */
export function planModelTextInput(core: DocumentCore, revision: DocumentRevision, action: DocumentInputAction, lines: MarkdownLineIndex, structural: (action: DocumentInputAction<SourceRange>) => DocumentSourceInputPlan): DocumentInputPlan {
  const intrinsic = (selection: typeof action.selection | SourceRange): DocumentModelTextSelection => {
    if ('start' in selection) return { kind: 'model-text', anchor: selection.start, focus: selection.end }
    if (selection.kind === 'model-text') return selection
    if ('ranges' in selection && selection.ranges.length === 1) {
      const range = selection.ranges[selection.primary]
      if (range !== undefined) return { kind: 'model-text', anchor: range.anchor, focus: range.focus }
    }
    throw new RangeError('Intrinsic text operation requires one text selection')
  }
  const actual = resolveModelTextSelection(core, revision, intrinsic(action.selection))
  if (!('kind' in action) && action.inputType === 'cancelComposition') return { edits: [], reconciliation: [], selection: actual.selection }
  if ('kind' in action) {
    if (action.command === 'tab') {
      if (!actual.collapsed) return { edits: [], reconciliation: [], selection: actual.selection }
      const literal = actual.first.literal ?? actual.last.literal
      if (literal === undefined) throw new RangeError('Intrinsic Tab requires its owned literal value')
      const content = literalTextContext(core, revision, literal)
      const at = content.offset(actual.selection.anchor)
      const expansion = codeTabExpansion(content.text, at, at, String(literal.attributes.semanticInfo ?? literal.attributes.info ?? '').trim().split(/\s+/u)[0] ?? '')
      const target = expansion === undefined ? actual.selection : { kind: 'model-text' as const, anchor: content.point(expansion.start), focus: content.point(expansion.end) }
      const insert = expansion?.insert ?? ' '.repeat(action.options.tabSize ?? 4)
      const materialized = materializeModelTextEdit(core, revision, target, insert, lines)
      const start = materialized.insertedStart + (expansion === undefined ? insert.length : expansion.selection.start - expansion.start)
      const end = materialized.insertedStart + (expansion === undefined ? insert.length : expansion.selection.end - expansion.start)
      return { edits: [materialized.edit], reconciliation: [], selection: { ranges: [{ anchor: start, focus: end }], primary: 0 } }
    }
    // Source extents locate the same structural owner. They never stand in for
    // an interior value position when the operation preserves that position.
    const sourceSelection = { start: actual.first.range.start, end: actual.collapsed ? actual.first.range.start : actual.last.range.end }
    const planned = structural({ ...action, selection: sourceSelection })
    if (planned.edits.length === 0 && planned.selection.start === sourceSelection.start && planned.selection.end === sourceSelection.end) return { ...planned, selection: actual.selection }
    if (action.command === 'resetCodeBlock' && action.selectionMode === 'preserve') {
      const map = (point: DocumentModelTextPoint): DocumentModelTextPoint => {
        if (typeof point === 'number') return positionAfter(planned.edits, point, false)
        const value = resolveModelTextPoint(core, revision, point)
        const normalization = planned.edits.find(edit => edit.start === point.text.start && edit.end === point.text.end && edit.insert === value.text)
        return normalization === undefined ? rebaseModelTextPoint(point, planned.edits) : positionAfter(planned.edits.filter(edit => edit !== normalization), point.text.start, false) + point.offset
      }
      const anchor = map(actual.selection.anchor)
      const focus = map(actual.selection.focus)
      return { ...planned, selection: typeof anchor === 'number' && typeof focus === 'number' ? { ranges: [{ anchor, focus }], primary: 0 } : { kind: 'model-text', anchor, focus } }
    }
    return { ...planned, selection: { ranges: [{ anchor: planned.selection.start, focus: planned.selection.end }], primary: 0 } }
  }
  if (action.inputType === 'insertParagraph' || action.inputType === 'insertLineBreak') {
    const literal = actual.first.literal ?? actual.last.literal
    if (action.inputType === 'insertParagraph' && literal !== undefined) {
      const content = literalTextContext(core, revision, literal)
      const point = actual.backward ? actual.selection.focus : actual.selection.anchor
      const line = physicalLineAt(lines, actual.first.node?.range.start ?? actual.first.syntax.coordinates.toProjected(actual.first.range.start, 'next'))
      const eol = projectedSourceSlice(core, revision, actual.first, line.contentEnd, line.end) || '\n'
      const policy = codeEnter(content.text, content.offset(point), action.options.tabSize ?? 4, eol)
      const materialized = materializeModelTextEdit(core, revision, actual.selection, policy.insert, lines)
      const caret = materialized.position(policy.caret)
      return { edits: [materialized.edit], reconciliation: [], selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 } }
    }
    const selection = { start: actual.first.range.start, end: actual.collapsed ? actual.first.range.start : actual.last.range.end }
    const planned = structural({ ...action, selection, range: selection })
    return { ...planned, selection: { ranges: [{ anchor: planned.selection.start, focus: planned.selection.end }], primary: 0 } }
  }
  const target = intrinsic(action.range)
  const resolved = resolveModelTextSelection(core, revision, target)
  const literal = resolved.first.literal !== undefined && resolved.first.literal === resolved.last.literal ? literalTextContext(core, revision, resolved.first.literal) : undefined
  const literalStart = literal?.offset(resolved.first.point)
  const literalEnd = literal?.offset(resolved.last.point)
  const before = literal !== undefined && literalStart !== undefined ? literal.text.slice(Math.max(0, literalStart - 1), literalStart) : resolved.first.offset > 0 ? resolved.first.text.slice(resolved.first.offset - 1, resolved.first.offset) : ''
  const after = literal !== undefined && literalEnd !== undefined ? literal.text.slice(literalEnd, literalEnd + 1) : resolved.last.text.slice(resolved.last.offset, resolved.last.offset + 1)
  const deleted = modelTextSelectionValue(core, revision, target)
  const policy = applyInputPairing({
    text: before + deleted + after,
    start: before.length,
    end: before.length + deleted.length,
    offsetInBlock: resolved.first.offset,
    collapsed: actual.collapsed,
    inputType: action.inputType,
    data: action.data,
    options: action.options,
    context: { type: resolved.first.literal !== undefined || resolved.last.literal !== undefined ? 'literal' : 'format', isInInlineCode: false, isInInlineMath: false }
  })
  const moved = (point: DocumentModelTextPoint, delta: number): DocumentModelTextPoint => {
    if (typeof point === 'number') return point + delta
    const value = resolveModelTextPoint(core, revision, point)
    const offset = point.offset + delta
    if (offset < 0) return point.text.start + offset
    if (offset > value.text.length) return point.text.end + offset - value.text.length
    return { text: point.text, offset }
  }
  if (policy.kind === 'selection') {
    const point = moved(resolved.backward ? target.anchor : target.focus, policy.selection.start - before.length - deleted.length)
    return { edits: [], reconciliation: [], selection: { kind: 'model-text', anchor: point, focus: point } }
  }
  const firstPoint = resolved.backward ? target.focus : target.anchor
  const lastPoint = resolved.backward ? target.anchor : target.focus
  if (policy.kind === 'wrap' && resolved.first.range.end <= resolved.last.range.start) {
    const opening = materializeModelTextEdit(core, revision, { kind: 'model-text', anchor: firstPoint, focus: firstPoint }, policy.edits[0].text, lines)
    const closing = materializeModelTextEdit(core, revision, { kind: 'model-text', anchor: lastPoint, focus: lastPoint }, policy.edits[1].text, lines)
    if (opening.edit.end > closing.edit.start) throw new RangeError('Distinct wrapping endpoints overlap')
    const start = opening.position(policy.edits[0].text.length)
    const end = closing.insertedStart + opening.edit.insert.length - (opening.edit.end - opening.edit.start)
    return { edits: [opening.edit, closing.edit], reconciliation: [], selection: { ranges: [{ anchor: actual.backward ? end : start, focus: actual.backward ? start : end }], primary: 0 } }
  }
  const replacement = policy.kind === 'wrap'
    ? { target, insert: policy.edits[0].text + deleted + policy.edits[1].text, start: policy.edits[0].text.length, end: policy.edits[0].text.length + deleted.length }
    : {
      target: { kind: 'model-text' as const, anchor: moved(firstPoint, policy.edit.start - before.length), focus: moved(lastPoint, policy.edit.end - before.length - deleted.length) },
      insert: policy.edit.text,
      start: policy.selection.start - policy.edit.start,
      end: policy.selection.end - policy.edit.start
    }
  if (replacement.insert === deleted && policy.kind === 'replace' && policy.edit.start === before.length && policy.edit.end === before.length + deleted.length) return { edits: [], reconciliation: [], selection: actual.selection }
  const materialized = materializeModelTextEdit(core, revision, replacement.target, replacement.insert, lines)
  const start = materialized.position(replacement.start)
  const end = materialized.position(replacement.end)
  return { edits: [materialized.edit], reconciliation: [], selection: { ranges: [{ anchor: actual.backward ? end : start, focus: actual.backward ? start : end }], primary: 0 } }
}

/** Untouched intrinsic values retain their exact address through unrelated source edits. */
export function rebaseModelTextPoint(point: DocumentModelTextPoint, edits: readonly DocumentSourceEdit[]): DocumentModelTextPoint {
  if (typeof point === 'number') return positionAfter(edits, point, true)
  if (edits.some(edit => edit.start < point.text.end && point.text.start < edit.end || edit.start === edit.end && point.text.start < edit.start && edit.start < point.text.end)) throw new RangeError('Retained model text spelling changed')
  return { text: { start: positionAfter(edits, point.text.start, true), end: positionAfter(edits, point.text.end, false) }, offset: point.offset }
}

/** Clipboard replacement uses the same addressed input and literal compiler. */
export function planModelTextClipboard(core: DocumentCore, revision: DocumentRevision, action: DocumentClipboardAction, preview: (edits: readonly DocumentSourceEdit[]) => DocumentRevision): DocumentClipboardPlan {
  if (action.kind === 'table' || action.selection.kind !== 'model-text') throw new RangeError('Expected intrinsic text clipboard selection')
  const resolved = resolveModelTextSelection(core, revision, action.selection)
  const literal = resolved.first.literal !== undefined || resolved.last.literal !== undefined
  const data = action.kind === 'cut' ? null : literal && action.plainText !== undefined ? action.plainText : action.markdown
  const input = {
    selection: action.selection,
    range: action.selection,
    inputType: action.kind === 'cut' ? 'deleteByCut' : 'insertFromPaste',
    data,
    options: { autoPairBracket: false, autoPairMarkdownSyntax: false, autoPairQuote: false }
  }
  const plan = core.planInput(revision, input)
  if (plan.edits.length === 0) return { edits: [], selection: action.selection }
  const edits = core.inputEdits(revision, input, plan, action.tracked)
  if (edits === undefined) throw new RangeError('Intrinsic clipboard action has no safe source edit')
  const edit = plan.edits[0]
  if (edit === undefined || plan.edits.length !== 1 || !('ranges' in plan.selection)) throw new RangeError('Intrinsic clipboard replacement requires one owned edit')
  const mapping = compiledEditReconciliation(core, revision, edit, edits, preview(edits), 'visible')
  if (mapping === undefined) throw new RangeError('Intrinsic clipboard compilation has no exact selection map')
  const selection = { ...plan.selection, ranges: plan.selection.ranges.map(range => ({ anchor: positionAfter(mapping, range.anchor, true), focus: positionAfter(mapping, range.focus, true) })) }
  return { edits, selection }
}
