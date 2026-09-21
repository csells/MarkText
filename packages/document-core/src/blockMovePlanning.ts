import type { DocumentCore, DocumentRevision, MarkdownAstNode, SourceRange } from './documentCore.js'
import type { DocumentInputAction, DocumentInputPlan } from './inputPlanning.js'
import type { DocumentModelTextPoint } from './sourceInputPlanning.js'
import type { MarkdownLineIndex } from './revision.js'
import { blockCommandTarget } from './blockCommandPlanning.js'
import { markupAnnotations } from './markupEditOwnership.js'
import { syntaxPathAt } from './syntaxPath.js'
import { markupSourceFragment } from './markupSourceFragment.js'

type SourceMapping = { before: SourceRange; after: number }

/** Rotate owned outer blocks while retaining their exact source and separators. */
export function planBlockMove(core: DocumentCore, revision: DocumentRevision, action: Extract<DocumentInputAction, { command: 'moveBlock' }>, lines: MarkdownLineIndex): DocumentInputPlan {
  const { syntax } = core.project(revision, 'markup')
  const annotations = markupAnnotations(revision.annotations)
  let lineEnding = '\n'
  for (let index = 0; index < lines.count; index++) {
    const line = lines.at(index)
    if (line.end === line.contentEnd) continue
    const origin = syntax.coordinates.originAt(line.contentEnd)
    if (origin.kind !== 'source') continue
    lineEnding = core.sourceSlice(revision, { start: origin.sourceOffset, end: origin.sourceOffset + line.end - line.contentEnd })
    break
  }
  const targetAt = (source: number): MarkdownAstNode => {
    if (!Number.isSafeInteger(source) || source < 0 || source > revision.sourceLength) throw new RangeError('Block move target is outside the document')
    return blockCommandTarget(syntaxPathAt(syntax.ast.root, syntax.coordinates.toProjected(source, 'next')), 'outer')
  }
  const block = targetAt(action.from)
  const target = targetAt(action.to)
  const siblings = syntax.ast.root.children
  const from = siblings.indexOf(block)
  const targetIndex = siblings.indexOf(target)
  if (from < 0 || targetIndex < 0) throw new RangeError('Block move requires owned outer blocks')
  const to = targetIndex + (action.placement === 'after' ? 1 : 0) - (from < targetIndex || from === targetIndex && action.placement === 'after' ? 1 : 0)
  if (from === to) return { edits: [], selection: action.selection, reconciliation: [] }
  let first = Math.min(from, to)
  let last = Math.max(from, to)
  let lineOrdinal = 0
  const blockRanges = siblings.map(node => {
    let start = node.range.start
    let end = node.range.end
    for (; lineOrdinal < lines.count; lineOrdinal++) {
      const line = lines.at(lineOrdinal)
      if (line.start <= start && start <= line.contentEnd) start = line.start
      if (node.range.start < end && line.end === end) end = line.contentEnd
      if (line.end >= node.range.end) break
    }
    return {
      start: syntax.coordinates.toSource(start, 'previous'),
      end: syntax.coordinates.toSource(end, 'next')
    }
  })
  const sharedBoundaries = new Set<number>()
  let annotationOrdinal = 0
  let annotationEnd = -1
  for (let index = 0; index + 1 < blockRanges.length; index++) {
    while (annotations[annotationOrdinal] !== undefined && annotations[annotationOrdinal]!.range.start < blockRanges[index]!.end) {
      annotationEnd = Math.max(annotationEnd, annotations[annotationOrdinal++]!.range.end)
    }
    if (annotationEnd > blockRanges[index + 1]!.start) sharedBoundaries.add(index)
  }
  // Consume every sibling in a shared annotation before splitting its owned
  // arms. No unmatched wrapper is left behind around a stationary sibling.
  let expanded = true
  while (expanded) {
    expanded = false
    const start = blockRanges[first]!.start
    const end = blockRanges[last]!.end
    for (const annotation of annotations) {
      if (annotation.range.end <= start || annotation.range.start >= end) continue
      while (first > 0 && blockRanges[first - 1]!.end > annotation.range.start) { first--; expanded = true }
      while (last + 1 < blockRanges.length && blockRanges[last + 1]!.start < annotation.range.end) { last++; expanded = true }
    }
  }
  const ranges = blockRanges.slice(first, last + 1)
  const order = ranges.map((_, index) => index)
  const [moved] = order.splice(from - first, 1)
  if (moved === undefined) throw new RangeError('Moved block is unavailable')
  order.splice(to - first, 0, moved)
  const start = ranges[0]!.start
  const end = ranges.at(-1)!.end
  const mappings: SourceMapping[] = []
  const separators: typeof mappings = []
  let insert = ''
  for (let index = 0; index < order.length; index++) {
    const original = order[index]!
    let final = original
    // Stationary adjacent siblings retain their existing shared annotation;
    // only the seam actually separated by the drag requires split wrappers.
    while (order[index + 1] === final + 1 && sharedBoundaries.has(first + final)) {
      index += 1
      final += 1
    }
    const range = { start: ranges[original]!.start, end: ranges[final]!.end }
    const fragment = markupSourceFragment(core, revision, range)
    mappings.push(...fragment.mappings.map(mapping => ({ ...mapping, after: start + insert.length + mapping.after })))
    insert += fragment.text
    const previous = ranges[index]
    const next = ranges[index + 1]
    if (previous !== undefined && next !== undefined) {
      if (previous.end > next.start) throw new RangeError('Moved blocks share an annotation boundary')
      const separator = { start: previous.end, end: next.start }
      separators.push({ before: separator, after: start + insert.length })
      const spelling = core.sourceSlice(revision, separator)
      // Separate arms can be distinct parser-owned blocks with a generated
      // separator. Once split into separate annotations they need real spacing.
      insert += spelling === '' ? lineEnding + lineEnding : spelling
    }
  }
  const point = (source: number): number => {
    const mapping = [...mappings, ...separators].find(item => item.before.start <= source && source <= item.before.end)
    return mapping === undefined ? source < end ? source : source + insert.length - (end - start) : mapping.after + source - mapping.before.start
  }
  const modelPoint = (position: DocumentModelTextPoint): DocumentModelTextPoint => typeof position === 'number'
    ? point(position)
    : { text: { start: point(position.text.start), end: point(position.text.end) }, offset: position.offset }
  const selection = action.selection
  return {
    edits: [{ start, end, insert }],
    selection: 'ranges' in selection
      ? { ranges: selection.ranges.map(range => ({ anchor: point(range.anchor), focus: point(range.focus) })), primary: selection.primary }
      : selection.kind === 'model-text'
        ? { kind: selection.kind, anchor: modelPoint(selection.anchor), focus: modelPoint(selection.focus) }
        : { ...selection, cell: { ...selection.cell, table: { start: point(selection.cell.table.start), end: point(selection.cell.table.end) } } },
    reconciliation: []
  }
}
