import type { DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, MarkupSyntax, SourceRange } from './documentCore.js'
import type { MarkdownLineIndex, MarkdownPhysicalLine } from './revision.js'
import { syntaxPathAt } from './syntaxPath.js'
import { escapeTableInput } from './tableRespelling.js'

const LITERALS = new Set(['code-block', 'math-block', 'html-block', 'diagram'])

/**
 * Upstream MarkText's cut of a selection that crosses block boundaries into or
 * out of a code block or table (#5371, #5368, #4903, #5148, #5405): the start
 * block keeps its head and the blocks strictly between the ends go, but
 *
 * - a cut starting in a code block's language line turns that code block
 *   into a paragraph holding the rest of the language and the end's tail;
 * - a cut ending in a code block's language line keeps the code block and
 *   removes only the selected start of its language;
 * - a cut ending in a code block's code removes the whole code block and
 *   joins its remaining code to the start block;
 * - a cut ending in a table cell keeps the table (emptying the cells before
 *   the end, whose own rest stays in it) unless it covers the whole table.
 *
 * Containers whose opening line the cut removes keep their marker on their
 * first remaining line, as upstream keeps the container around what survives.
 * Returns undefined for any shape this does not cover, or when the selection
 * touches an annotation, leaving the ordinary replacement to plan it.
 */
export function planCrossBlockCut(core: DocumentCore, revision: DocumentRevision, syntax: MarkupSyntax, lines: MarkdownLineIndex, range: SourceRange, insert = ''): { edits: readonly DocumentSourceEdit[], caret: number } | undefined {
  if (range.start >= range.end || /[\r\n]/u.test(insert)) return undefined
  if (revision.annotations.some(annotation => annotation.range.start <= range.end && range.start <= annotation.range.end)) return undefined
  const toSource = (position: number, side: 'next' | 'previous' = 'next') => syntax.coordinates.toSource(position, side)
  const from = syntax.coordinates.toProjected(range.start, 'next')
  const to = syntax.coordinates.toProjected(range.end, 'previous')
  const startPath = syntaxPathAt(syntax.ast.root, from)
  const endPath = syntaxPathAt(syntax.ast.root, to)
  const literalOf = (path: readonly MarkdownAstNode[]) => [...path].reverse().find(node => LITERALS.has(node.kind) && typeof node.attributes.contentStart === 'number')
  const leafOf = (path: readonly MarkdownAstNode[]) => [...path].reverse().find(node => node.kind === 'paragraph' || node.kind === 'heading')
  const startLiteral = literalOf(startPath)
  const endLiteral = literalOf(endPath)
  const endTable = endPath.find(node => node.kind === 'table')
  const inInfo = (node: MarkdownAstNode | undefined, position: number) => node !== undefined &&
    typeof node.attributes.infoStart === 'number' && typeof node.attributes.infoEnd === 'number' &&
    node.attributes.infoStart <= position && position <= node.attributes.infoEnd
  const inContent = (node: MarkdownAstNode | undefined, position: number) => node !== undefined &&
    Number(node.attributes.contentStart) <= position && position <= Number(node.attributes.contentEnd)
  const records: MarkdownPhysicalLine[] = Array.from({ length: lines.count }, (_, index) => lines.at(index))
  const lineIndexAt = (position: number) => {
    let found = 0
    for (let index = 0; index < records.length; index++) {
      if (records[index]!.start > position) break
      found = index
    }
    return found
  }
  const slice = (start: number, end: number) => core.sourceSlice(revision, { start, end })
  const edits: DocumentSourceEdit[] = []

  // Remove the whole lines between the start leaf's last line and `target`'s
  // first line, keeping one blank separator line, and give each list item
  // whose marker line goes the marker on `target`'s line.
  const removeBetween = (leafEnd: number, target: MarkdownAstNode | undefined, targetLine: number): void => {
    let first = lineIndexAt(leafEnd) + 1
    let last = targetLine
    // One blank line keeps the two blocks apart: the one after the start
    // leaf, or else the one before the target.
    if (records[first]?.blank === true && first < targetLine) first += 1
    else if (records[targetLine - 1]?.blank === true && targetLine - 1 > first) last = targetLine - 1
    if (first >= last) return
    const removedStart = records[first]!.start
    const removedEnd = records[last]?.start ?? records.at(-1)!.end
    edits.push({ start: toSource(removedStart), end: toSource(removedEnd, 'previous'), insert: '' })
    const line = records[targetLine]
    if (target === undefined || line === undefined) return
    for (const item of syntaxPathAt(syntax.ast.root, target.range.start)) {
      if (item.kind !== 'list-item' || item.range.start < removedStart || item.range.start >= removedEnd) continue
      const marker = records.flatMap(record => record.listMarkers).find(candidate => candidate.start === item.range.start)
      const indentation = line.listIndentations.find(candidate => candidate.depth === marker?.depth)
      if (marker === undefined || indentation === undefined) continue
      edits.push({ start: toSource(indentation.start), end: toSource(indentation.end, 'previous'), insert: slice(toSource(marker.start), toSource(marker.contentOffset, 'previous')) })
    }
  }
  const finish = (caret: number, table?: MarkdownAstNode) => {
    const sorted = edits.filter(edit => edit.end > edit.start || edit.insert !== '').sort((left, right) => left.start - right.start)
    if (table === undefined) return { edits: sorted, caret }
    const respelled = escapeTableInput(core, revision, syntax, table, { edits: sorted, selection: { start: caret, end: caret }, reconciliation: [] })
    return { edits: respelled.edits, caret: respelled.selection.start }
  }

  // The last line of a block, without its line ending.
  const blockEnd = (node: MarkdownAstNode) => records[lineIndexAt(Math.max(node.range.start, node.range.end - 1))]!.contentEnd
  // Text of a literal from `start` to its content end, its later lines
  // without their container prefixes, joining a paragraph with `prefix`.
  const literalTail = (literal: MarkdownAstNode, start: number, prefix: string) => {
    const contentEnd = Number(literal.attributes.contentEnd)
    const parts: string[] = []
    for (let index = lineIndexAt(start); index < records.length; index++) {
      const line = records[index]!
      if (line.start >= contentEnd) break
      const from = index === lineIndexAt(start) ? start : line.contentOffset
      const until = Math.min(line.contentEnd, contentEnd)
      parts.push((index === lineIndexAt(start) ? '' : prefix) + (until > from ? slice(toSource(from), toSource(until, 'previous')) : ''))
    }
    while (parts.length > 1 && parts.at(-1) === prefix) parts.pop()
    const lineEnding = slice(toSource(records[0]!.contentEnd), toSource(records[0]!.end, 'previous')) || '\n'
    return parts.join(lineEnding)
  }
  const prefixOf = (node: MarkdownAstNode) => {
    const line = records[lineIndexAt(node.range.start)]!
    return ' '.repeat(line.listIndentations.reduce((sum, part) => sum + part.columns, 0) + line.listMarkers.reduce((sum, marker) => sum + marker.contentOffset - marker.start, 0)) +
      line.blockquoteMarkers.map(() => '> ').join('')
  }

  // The cut starts in a code block's language line.
  if (startLiteral !== undefined && inInfo(startLiteral, from)) {
    if (endTable !== undefined) return undefined
    const language = slice(toSource(Number(startLiteral.attributes.infoStart)), range.start)
    const codeStart = toSource(startLiteral.range.start)
    if (endLiteral === startLiteral) {
      if (!inContent(startLiteral, to)) return undefined
      edits.push({ start: codeStart, end: toSource(blockEnd(startLiteral), 'previous'), insert: language + insert + literalTail(startLiteral, to, prefixOf(startLiteral)) })
    } else if (endLiteral !== undefined && inInfo(endLiteral, to)) {
      // Ending in a later code block's language keeps that code block.
      edits.push({ start: codeStart, end: toSource(blockEnd(startLiteral), 'previous'), insert: language + insert })
      removeBetween(blockEnd(startLiteral), endLiteral, lineIndexAt(endLiteral.range.start))
      edits.push({ start: toSource(Number(endLiteral.attributes.infoStart)), end: range.end, insert: '' })
    } else {
      edits.push({ start: codeStart, end: range.end, insert: language + insert })
    }
    return finish(codeStart + language.length + insert.length)
  }
  if (startLiteral !== undefined || startPath.some(node => node.kind === 'table')) return undefined
  const startLeaf = leafOf(startPath)
  if (startLeaf === undefined) return undefined
  const leafEnd = startLeaf.kind === 'heading' && typeof startLeaf.attributes.contentEnd === 'number' ? startLeaf.attributes.contentEnd : startLeaf.range.end

  // The cut ends in a code block's language line.
  if (endLiteral !== undefined && inInfo(endLiteral, to)) {
    edits.push({ start: range.start, end: toSource(leafEnd, 'previous'), insert })
    removeBetween(leafEnd, endLiteral, lineIndexAt(endLiteral.range.start))
    edits.push({ start: toSource(Number(endLiteral.attributes.infoStart)), end: range.end, insert: '' })
    return finish(range.start + insert.length)
  }

  // The cut ends in a code block's code: the block goes and its rest joins.
  if (endLiteral !== undefined && inContent(endLiteral, to)) {
    const tail = literalTail(endLiteral, to, prefixOf(startLeaf))
    edits.push({ start: range.start, end: toSource(leafEnd, 'previous'), insert: insert + tail })
    const afterIndex = lineIndexAt(endLiteral.range.end) + 1
    const after = syntaxPathAt(syntax.ast.root, records[afterIndex]?.contentOffset ?? endLiteral.range.end).at(-1)
    removeBetween(leafEnd, after, Math.min(afterIndex, records.length))
    return finish(range.start + insert.length)
  }

  // The cut ends in a table cell outside the start block's table.
  if (endTable !== undefined) {
    const cells = endTable.children.flatMap(row => row.children)
    const cell = [...endPath].reverse().find(node => node.kind === 'table-cell')
    const last = cells.at(-1)
    if (cell === undefined || last === undefined) return undefined
    edits.push({ start: range.start, end: toSource(leafEnd, 'previous'), insert })
    const wholeTable = cell === last && to >= cell.range.end
    if (wholeTable) {
      const afterIndex = lineIndexAt(endTable.range.end) + 1
      const nextIndex = records[afterIndex]?.blank === true ? afterIndex + 1 : afterIndex
      const after = records[nextIndex] === undefined ? undefined : syntaxPathAt(syntax.ast.root, records[nextIndex]!.contentOffset).at(-1)
      if (after === undefined) {
        // The table ends the document: the start leaf does too.
        edits.push({ start: toSource(leafEnd, 'previous'), end: toSource(records.at(-1)!.contentEnd, 'previous'), insert: '' })
        return finish(range.start + insert.length)
      }
      removeBetween(leafEnd, after, nextIndex)
      return finish(range.start + insert.length)
    }
    removeBetween(leafEnd, endTable, lineIndexAt(endTable.range.start))
    for (const before of cells.slice(0, cells.indexOf(cell))) {
      if (before.range.end > before.range.start) edits.push({ start: toSource(before.range.start), end: toSource(before.range.end, 'previous'), insert: '' })
    }
    if (to > cell.range.start) edits.push({ start: toSource(cell.range.start), end: range.end, insert: '' })
    return finish(range.start + insert.length, endTable)
  }
  return undefined
}
