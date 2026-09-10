import { headingPasteLines, plainHtmlPasteLines, tableCellPaste, tableToMarkdown } from '@marktext/input-policy'
import type { DocumentInputSelection } from './inputPlanning.js'
import { resolveTableCell } from './tableSelection.js'
import type { DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, MarkupSyntax } from './documentCore.js'

interface ClipboardInsertion { edit: DocumentSourceEdit, caret: number, after?: readonly DocumentSourceEdit[] }

/** Imported Markdown is interpreted by the same parser and merged using its owned block ranges. */
export function prepareClipboardMarkdown(
  core: DocumentCore,
  previous: DocumentRevision,
  input: DocumentSourceEdit,
  selection: DocumentInputSelection,
  importSyntax: (source: string) => MarkupSyntax,
  pasteAsPlainText = false
): ClipboardInsertion {
  const unchanged = { edit: input, caret: input.insert.length }
  if (input.insert === '') return unchanged
  const current = core.project(previous, 'markup').syntax
  const from = current.coordinates.toProjected(input.start, 'next')
  const to = current.coordinates.toProjected(input.end, 'previous')
  let anchor: MarkdownAstNode | undefined
  let containers: MarkdownAstNode[] = []
  const visit = (node: MarkdownAstNode, parents: MarkdownAstNode[] = []): void => {
    if (node.range.start <= from && to <= node.range.end) {
      if (['paragraph', 'heading', 'table-cell', 'code-block', 'math-block', 'diagram', 'html-block'].includes(node.kind)) {
        anchor = node
        containers = parents
      }
      for (const child of node.children) visit(child, [...parents, node])
    }
  }
  if (selection.kind === 'table-cell') anchor = resolveTableCell(core, previous, selection.cell).cell
  else visit(current.ast.root)
  if (anchor?.kind === 'table-cell') {
    const insert = tableCellPaste(input.insert)
    return { edit: { ...input, insert }, caret: insert.length }
  }
  if (anchor?.kind !== 'paragraph' && anchor?.kind !== 'heading') return unchanged
  const syntax = importSyntax(input.insert)
  const first = syntax.ast.root.children[0]
  if (first === undefined) return unchanged
  const sourceOffset = (offset: number): number => syntax.coordinates.toSource(offset, 'next')
  const anchorStart = current.coordinates.toSource(anchor.range.start, 'next')
  const anchorEnd = current.coordinates.toSource(anchor.range.end, 'previous')
  const nonempty = anchor.range.start < anchor.range.end
  if (pasteAsPlainText && first.kind === 'html-block') {
    const { first: firstLine, rest } = plainHtmlPasteLines(input.insert)
    if (rest === '') return { edit: { ...input, insert: firstLine }, caret: firstLine.length }
    // The owning paragraph's outside edge includes closing marks and trailing
    // comments. The untouched tail stays in place; only the imported remainder
    // is inserted after it, as in the native plain-HTML command.
    const outsideEnd = current.coordinates.toSource(anchor.range.end, 'next')
    const remainder = '\n\n' + rest
    if (input.end === outsideEnd) return { edit: { ...input, insert: firstLine + remainder }, caret: firstLine.length }
    return {
      edit: { ...input, insert: firstLine },
      caret: firstLine.length,
      after: [{ start: outsideEnd, end: outsideEnd, insert: remainder }]
    }
  }
  const firstHeadingChild = first.children[0]
  const lastHeadingChild = first.children.at(-1)
  if (first.kind === 'heading' && nonempty && firstHeadingChild !== undefined && lastHeadingChild !== undefined) {
    const contentStart = sourceOffset(firstHeadingChild.range.start)
    const contentEnd = syntax.coordinates.toSource(lastHeadingChild.range.end, 'previous')
    const rest = input.insert.slice(sourceOffset(first.range.end))
    const insert = input.insert.slice(contentStart, contentEnd) + rest
    return { edit: { ...input, insert }, caret: insert.length }
  }
  if (first.kind === 'paragraph' || first.kind === 'heading') {
    let insert = input.insert
    if (anchor.kind === 'heading' && anchor.attributes.style !== 'setext' && first.kind === 'paragraph') {
      const firstEnd = sourceOffset(first.range.end)
      const lines = headingPasteLines(insert.slice(0, firstEnd))
      if (lines.rest !== '') insert = lines.first + '\n\n' + lines.rest + insert.slice(firstEnd)
    }
    // The parsed owning containers determine continuation spelling. Copy their
    // existing source prefix; list markers become indentation on later lines.
    if (containers.some(node => node.kind === 'list-item' || node.kind === 'blockquote')) {
      const continuation = containerContinuationPrefix(core, previous, current, anchor, containers)
      const lines = insert.split('\n')
      insert = lines.map((line, index) => index === 0 ? line : (line === '' ? continuation.trimEnd() : continuation) + line).join('\n')
    }
    return { edit: { ...input, insert }, caret: insert.length }
  }
  // Native paste keeps the paragraph head and seats its tail in the final
  // imported content leaf. A structural import begins on a new block boundary.
  const prefix = input.start > anchorStart ? '\n\n' : ''
  if (first.kind !== 'table' || syntax.ast.root.children.length !== 1) {
    const insert = prefix + input.insert
    return { edit: { ...input, insert }, caret: insert.length }
  }
  const lastCell = first.children.at(-1)?.children.at(-1)
  if (lastCell === undefined) return unchanged
  const tail = core.sourceSlice(previous, { start: input.end, end: anchorEnd })
  const originalLast = input.insert.slice(sourceOffset(lastCell.range.start), syntax.coordinates.toSource(lastCell.range.end, 'previous'))
  const rows = first.children.map(row => ({
    children: row.children.map(cell => ({
      text: input.insert.slice(sourceOffset(cell.range.start), syntax.coordinates.toSource(cell.range.end, 'previous')) + (cell === lastCell ? tail : ''),
      meta: { align: typeof cell.attributes.alignment === 'string' ? cell.attributes.alignment : 'none' }
    }))
  }))
  const markdown = tableToMarkdown({ children: rows })
  const spelledSyntax = importSyntax(markdown)
  const resultCell = spelledSyntax.ast.root.children[0]?.children.at(-1)?.children.at(-1)
  if (resultCell?.kind !== 'table-cell') throw new RangeError('Imported table has no exact final cell')
  const caret = prefix.length + spelledSyntax.coordinates.toSource(resultCell.range.start, 'next') + originalLast.length
  return { edit: { start: input.start, end: anchorEnd, insert: prefix + markdown }, caret }
}

export function containerContinuationPrefix(core: DocumentCore, previous: DocumentRevision, current: MarkupSyntax, anchor: MarkdownAstNode, containers: readonly MarkdownAstNode[]): string {
  const prefixEnd = current.coordinates.toSource(anchor.range.start, 'previous')
  const preceding = core.sourceSlice(previous, { start: 0, end: prefixEnd })
  const firstLineStart = Math.max(preceding.lastIndexOf('\n'), preceding.lastIndexOf('\r')) + 1
  let continuation = core.sourceSlice(previous, { start: firstLineStart, end: prefixEnd })
  for (const item of containers.filter(node => node.kind === 'list-item')) {
    const markerStart = current.coordinates.toSource(item.range.start, 'next') - firstLineStart
    if (markerStart < 0 || markerStart >= continuation.length) continue
    const firstChild = item.children[0]
    if (firstChild === undefined) continue
    const markerEnd = current.coordinates.toSource(item.attributes.task === true && typeof item.attributes.taskMarkerStart === 'number'
      ? item.attributes.taskMarkerStart
      : firstChild.range.start, 'previous') - firstLineStart
    continuation = continuation.slice(0, markerStart) + ' '.repeat(markerEnd - markerStart) + continuation.slice(markerEnd)
  }
  return continuation
}
