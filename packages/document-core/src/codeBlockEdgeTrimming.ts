import type { DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, MarkupSyntax, SourceRange } from './documentCore.js'
import type { DocumentInputAction, DocumentInputPlan } from './inputPlanning.js'
import { editedSourceReader } from './emptiedParagraphPlanning.js'
import { rebaseModelTextPoint } from './modelText.js'
import { composeSourceEdits } from './sourceEditComposition.js'
import { positionAfter } from './sourcePosition.js'
import { syntaxPathAt } from './syntaxPath.js'

const trimmedBlocks = new Set(['code-block', 'diagram'])

interface CodeLine {
  /** Source start of the line, container prefix included. */
  readonly start: number
  /** Source end of the line after its line ending. */
  readonly end: number
  readonly empty: boolean
}

/** Lines read past at one edge before its run of empty lines is left alone. */
const EDGE_LINE_READS = 256

type SyntaxReader = (range: SourceRange) => MarkupSyntax | undefined

/**
 * Upstream's `trimUnnecessaryCodeBlockEmptyLines` drops the empty lines at a
 * fenced code block's edges whenever it reads a document. Here the trim is
 * edit-scoped: an untracked input inside one closed fenced code block also
 * removes that block's leading and trailing empty lines, in the same
 * operation, so it is undone with the input. Lines the input touches stay,
 * so a line just opened with Enter keeps its caret; every other block and an
 * unedited save keep their bytes (ADR 0007).
 */
export function trimEditedCodeBlock(
  core: DocumentCore,
  revision: DocumentRevision,
  action: DocumentInputAction,
  plan: DocumentInputPlan,
  regionalSyntax?: SyntaxReader,
  literalBlockRange?: (position: number) => SourceRange | undefined
): DocumentInputPlan {
  if (action.options.trimUnnecessaryCodeBlockEmptyLines !== true || plan.edits.length === 0) return plan
  const position = Math.min(...plan.edits.map(edit => edit.start))
  // Without a window the revision holds its parse, which the projection reads.
  const read: SyntaxReader = regionalSyntax ?? (() => core.project(revision, 'markup').syntax)
  const lineEnd = (at: number) => at + (/^(?:\r\n?|\n)/u.exec(core.sourceSlice(revision, { start: at, end: Math.min(at + 2, revision.sourceLength) }))?.[0].length ?? 0)
  const codeBlockAt = (at: number) => codeBlock(read, lineEnd, at)
  const edited = codeBlockAt(position)
  if (edited === undefined) return plan
  // A window around a literal holds only the lines near the edit, its fences
  // standing for the rest; the whole block's extent comes from the document.
  const bounds = edited.whole ? edited : wholeBlockContent(core, revision, edited, literalBlockRange?.(position))
  if (bounds === undefined) return regionalSyntax === undefined ? plan : trimEditedCodeBlock(core, revision, action, plan)
  const { contentStart, contentEnd } = bounds
  if (plan.edits.some(edit => edit.start < contentStart || edit.start >= contentEnd || edit.end > contentEnd)) return plan

  // An edit at a line's start belongs to that line; one ending at a line's
  // start joins it to the line before.
  const trimmable = (line: CodeLine) => line.empty && !plan.edits.some(edit => edit.start < line.end && edit.end >= line.start)
  // A window around a long literal holds only some of its lines, so the
  // lines at each edge are read from windows there until a kept line ends
  // the edge's run of empty lines; a run that cannot be read is left alone.
  const known = new Map<number, CodeLine>()
  const learn = (lines: readonly CodeLine[] | undefined) => { for (const line of lines ?? []) known.set(line.start, line) }
  learn(edited.lines)
  const lineFrom = (at: number) => known.get(at) ?? (learn(codeBlockAt(at)?.lines), known.get(at))
  const lineTo = (at: number) => {
    const find = () => [...known.values()].find(line => line.end === at)
    return find() ?? (learn(codeBlockAt(at - 1)?.lines), find())
  }
  const kept = (next: (at: number) => CodeLine | undefined, from: number, step: (line: CodeLine) => number) => {
    for (let at = from, reads = 0; reads < EDGE_LINE_READS; reads++) {
      const line = next(at)
      if (line === undefined || !trimmable(line)) return line
      at = step(line)
    }
    return undefined
  }
  // A top-level block's line with visible text is code, so an edge spelled
  // that way ends its run without reading a window there.
  const firstSpelled = !edited.whole && /^[^\r\n]*\S/u.test(core.sourceSlice(revision, { start: contentStart, end: Math.min(contentEnd, contentStart + 256) }))
  const lastSpelled = !edited.whole && /\S[^\r\n]*(?:\r\n|\r|\n)$/u.test(core.sourceSlice(revision, { start: Math.max(contentStart, contentEnd - 256), end: contentEnd }))
  const leadingKept = firstSpelled ? undefined : kept(lineFrom, contentStart, line => line.end)
  const trailingKept = lastSpelled ? undefined : kept(lineTo, contentEnd, line => line.start)
  const trims: DocumentSourceEdit[] = []
  if (leadingKept !== undefined && leadingKept.start > contentStart) trims.push({ start: contentStart, end: leadingKept.start, insert: '' })
  const trailingFrom = trailingKept?.end
  if (trailingFrom !== undefined && trailingFrom < contentEnd && trailingFrom >= (trims[0]?.end ?? contentStart)) {
    trims.push({ start: trailingFrom, end: contentEnd, insert: '' })
  }
  if (trims.length === 0) return plan

  // The trimmed lines are untouched, so they map through the input exactly.
  const trimmed = trims.map(trim => ({ start: positionAfter(plan.edits, trim.start, false), end: positionAfter(plan.edits, trim.end, false), insert: '' }))
  const result = editedSourceReader(core, revision, plan.edits)
  const point = (at: number) => positionAfter(trimmed, at, false)
  const selection = plan.selection as DocumentInputPlan['selection'] | SourceRange
  const moved = 'ranges' in selection
    ? { ...selection, ranges: selection.ranges.map(range => ({ anchor: point(range.anchor), focus: point(range.focus) })) }
    : 'start' in selection
      ? { start: point(selection.start), end: point(selection.end) }
      : selection.kind === 'model-text'
        ? { ...selection, anchor: rebaseModelTextPoint(selection.anchor, trimmed), focus: rebaseModelTextPoint(selection.focus, trimmed) }
        : selection
  return Object.freeze({
    ...plan,
    edits: Object.freeze(composeSourceEdits(plan.edits, trimmed, result).map(edit => Object.freeze(edit))),
    selection: Object.freeze(moved) as DocumentInputPlan['selection'],
    // A native echo of the input lacks the trim, which the plan's own
    // operation carries.
    ...('kind' in action
      ? {}
      : { reconciliation: Object.freeze(composeSourceEdits(plan.reconciliation, trimmed, result).map(edit => Object.freeze(edit))) })
  })
}

/**
 * The closed fenced code block or diagram holding `position`: its content's
 * source bounds and the lines a window shows of it, which may be fewer than
 * the block's when its fences stand for lines beyond the window.
 */
interface CodeBlockView {
  readonly contentStart: number
  readonly contentEnd: number
  /** Where the opener's line ends in the document. */
  readonly openerEnd: number
  /** Whether the syntax spells the whole block rather than a window of it. */
  readonly whole: boolean
  readonly lines: readonly CodeLine[]
}

function codeBlock(read: SyntaxReader, lineEnd: (position: number) => number, position: number): CodeBlockView | undefined {
  const syntax = read({ start: position, end: position })
  if (syntax === undefined) return undefined
  const block = syntaxPathAt(syntax.ast.root, syntax.coordinates.toProjected(position, 'next'))
    .reverse().find(node => trimmedBlocks.has(node.kind))
  if (block === undefined || block.kind === 'code-block' && block.attributes.provider !== 'fenced-code') return undefined
  const { contentStart, contentEnd } = block.attributes
  // An unclosed fence runs to the end of the document, where its last line
  // is still being written.
  if (typeof contentStart !== 'number' || typeof contentEnd !== 'number' || contentStart <= block.range.start || contentEnd >= block.range.end) return undefined
  const toSource = (at: number) => syntax.coordinates.toSource(at, 'previous')
  const start = toSource(contentStart)
  const end = toSource(contentEnd)
  const whole = syntax.coordinates.toSource(block.range.end, 'previous') - syntax.coordinates.toSource(block.range.start, 'next') === block.range.end - block.range.start
  // The opener's line ending maps to the document's even in a window.
  const openerEnd = toSource(contentStart - 1) + 1
  const lines = codeLines(block, toSource, lineEnd)
  return lines === undefined || start >= end ? undefined : { contentStart: start, contentEnd: end, openerEnd, whole, lines }
}

/**
 * The content bounds of the whole top-level literal block a window shows
 * part of: from its opener's line end to the start of its closer, the last
 * non-blank line of the block's source extent.
 */
function wholeBlockContent(core: DocumentCore, revision: DocumentRevision, view: CodeBlockView, block: SourceRange | undefined): { contentStart: number, contentEnd: number } | undefined {
  if (block === undefined || view.openerEnd <= block.start || view.openerEnd >= block.end) return undefined
  const text = core.sourceSlice(revision, block).replace(/(?:\r\n|\r|\n)[ \t\r\n]*$/u, '')
  const closer = Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r')) + 1
  const contentEnd = block.start + closer
  return closer === 0 || contentEnd <= view.openerEnd ? undefined : { contentStart: view.openerEnd, contentEnd }
}

/** The block's lines, or undefined when its content is not plain code text. */
function codeLines(block: MarkdownAstNode, toSource: (position: number) => number, lineEnd: (position: number) => number): CodeLine[] | undefined {
  const lines: CodeLine[] = []
  let start = toSource(Number(block.attributes.contentStart))
  let text: MarkdownAstNode | undefined
  for (const child of block.children) {
    if (child.kind === 'text') {
      if (text !== undefined) return undefined
      text = child
    } else if (child.kind === 'soft-break' && text !== undefined) {
      const end = toSource(child.range.end)
      lines.push({ start, end, empty: text.attributes.semanticText === '' })
      start = end
      text = undefined
    } else {
      return undefined
    }
  }
  // The last line's own ending, not the closer, which may stand for lines
  // beyond a window.
  if (text !== undefined) lines.push({ start, end: lineEnd(toSource(text.range.end)), empty: text.attributes.semanticText === '' })
  return lines
}
