import type { DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, MarkupSyntax } from './documentCore.js'
import type { MarkdownLineIndex } from './revision.js'
import { paragraphImageRange } from './paragraphBoundary.js'
import { containerContinuationPrefix } from './clipboardMarkdown.js'
import { syntaxPathAt } from './syntaxPath.js'

export const emptyParagraphJoinContainer = (node: MarkdownAstNode): boolean => ['list-item', 'blockquote', 'footnote-definition'].includes(node.kind) && node.children.length === 0

export const paragraphJoinBlock = (node: MarkdownAstNode): boolean => ['paragraph', 'definition'].includes(node.kind) || paragraphImageRange(node) !== undefined || emptyParagraphJoinContainer(node)

/** The same intrinsic predecessor/successor is used by planning and compilation. */
export function paragraphJoinAdjacent(syntax: MarkupSyntax, current: MarkdownAstNode, forward: boolean): MarkdownAstNode | undefined {
  let adjacent: MarkdownAstNode | undefined
  const visit = (node: MarkdownAstNode): void => {
    if (node === current) return
    if (emptyParagraphJoinContainer(node) || ['paragraph', 'definition', 'heading', 'table-cell', 'code-block', 'math-block', 'diagram', 'html-block', 'front-matter', 'thematic-break'].includes(node.kind)) {
      if (forward ? adjacent === undefined && node.range.start >= current.range.end : node.range.end <= current.range.start) adjacent = node
    } else for (const child of node.children) visit(child)
  }
  visit(syntax.ast.root)
  return adjacent
}

/** Resolve the declared backward join's literal ownership from common syntax. */
export function paragraphBackwardCodeTarget(syntax: MarkupSyntax, position: number): MarkdownAstNode | undefined {
  const visit = (node: MarkdownAstNode): MarkdownAstNode | undefined => {
    if (position < node.range.start || position > node.range.end) return undefined
    if (paragraphJoinBlock(node) && (paragraphImageRange(node)?.start ?? node.range.start) === position) return node
    for (const child of node.children) {
      const paragraph = visit(child)
      if (paragraph !== undefined) return paragraph
    }
    return undefined
  }
  const current = visit(syntax.ast.root)
  const previous = current === undefined ? undefined : paragraphJoinAdjacent(syntax, current, false)
  return previous?.kind === 'code-block' ? previous : undefined
}

/** Move the donor's raw spelling into the target literal's owned line context. */
export function codeJoinParagraphText(core: DocumentCore, revision: DocumentRevision, syntax: MarkupSyntax, lines: MarkdownLineIndex, code: MarkdownAstNode, donor: MarkdownAstNode): { text: string, emptyPrefix: string } {
  const sourceAt = (position: number) => syntax.coordinates.toSource(position, 'next')
  const sourceEnd = (position: number) => syntax.coordinates.toSource(position, 'previous')
  const path = syntaxPathAt(syntax.ast.root, code.children[0]?.range.start ?? code.range.start)
  let continuation = containerContinuationPrefix(core, revision, syntax, code, path)
  const records = Array.from({ length: lines.count }, (_, index) => lines.at(index))
  const prefixEnd = (line: typeof records[number]) => Math.max(line.start,
    ...line.listMarkers.map(marker => marker.contentOffset),
    ...line.listIndentations.map(marker => marker.end),
    ...line.blockquoteMarkers.map(marker => marker.end))
  if (code.attributes.provider === 'indented-code') {
    const opener = records.find(line => line.start <= code.range.start && code.range.start <= line.contentEnd)
    if (opener === undefined) throw new RangeError('Code join has no owned opening line')
    continuation = continuation.slice(0, continuation.length - (code.range.start - prefixEnd(opener))) + '    '
  }
  const donorRange = paragraphImageRange(donor) ?? donor.range
  let cursor = syntax.coordinates.toSource(donorRange.start, 'previous')
  let text = ''
  for (const line of records) {
    if (line.start <= donorRange.start || line.start >= donorRange.end) continue
    const start = sourceAt(line.start)
    text += core.sourceSlice(revision, { start: cursor, end: start }) + continuation
    cursor = sourceAt(prefixEnd(line))
  }
  text += core.sourceSlice(revision, { start: cursor, end: syntax.coordinates.toSource(donorRange.end, 'next') })
  const empty = code.attributes.contentStart === code.attributes.contentEnd
  if (empty) {
    const openingLine = records.find(line => line.start <= code.range.start && code.range.start <= line.contentEnd)
    if (openingLine === undefined) throw new RangeError('Code join has no opening terminator')
    text = continuation + text + core.sourceSlice(revision, { start: sourceEnd(openingLine.contentEnd), end: sourceAt(openingLine.end) })
  }
  return { text, emptyPrefix: empty ? continuation : '' }
}

/** Native forward Delete moves the donor paragraph's trailing siblings into
 * the target paragraph's parent. Rebase only their parser-owned container
 * prefixes; nested block indentation and annotation bytes remain untouched.
 */
export function paragraphJoinTrailingEdits(core: DocumentCore, revision: DocumentRevision, syntax: MarkupSyntax, lines: MarkdownLineIndex, target: MarkdownAstNode, donor: MarkdownAstNode): DocumentSourceEdit[] {
  const pathTo = (target: MarkdownAstNode): MarkdownAstNode[] => {
    const visit = (node: MarkdownAstNode): MarkdownAstNode[] | undefined => {
      if (node === target) return [node]
      for (const child of node.children) {
        const path = visit(child)
        if (path !== undefined) return [node, ...path]
      }
      return undefined
    }
    const path = visit(syntax.ast.root)
    if (path === undefined) throw new RangeError('Paragraph join has no owned syntax path')
    return path
  }
  const targetPath = pathTo(target)
  const donorPath = pathTo(donor)
  const empty = (node: MarkdownAstNode) => ['list-item', 'blockquote', 'footnote-definition'].includes(node.kind) && node.children.length === 0
  const destination = empty(target) ? target : targetPath.at(-2)
  const origin = empty(donor) ? donor : donorPath.at(-2)
  if (destination === undefined || origin === undefined || destination === origin) return []
  const trailing = origin.children.slice(origin.children.indexOf(donor) + 1)
  const records = Array.from({ length: lines.count }, (_, index) => lines.at(index))
  const sourceAt = (position: number) => syntax.coordinates.toSource(position, 'next')
  const sourceEnd = (position: number) => syntax.coordinates.toSource(position, 'previous')
  const containers = (path: readonly MarkdownAstNode[]) => path.filter(node => node.kind === 'list-item' || node.kind === 'blockquote')
  const before = containers(donorPath.slice(0, -1))
  const after = containers(empty(target) ? targetPath : targetPath.slice(0, -1))
  const continuation = (context: readonly MarkdownAstNode[]): string => {
    let prefix = ''
    for (const container of context) {
      if (container.kind === 'list-item') {
        const marker = records.flatMap(line => line.listMarkers).find(marker => marker.start === container.range.start)
        if (marker === undefined) throw new RangeError('Paragraph join destination has no list marker')
        prefix += ' '.repeat(marker.contentOffset - marker.start)
      } else {
        const marker = records.flatMap(line => line.blockquoteMarkers).find(marker => marker.start === container.range.start)
        if (marker === undefined) throw new RangeError('Paragraph join destination has no quote marker')
        prefix += core.sourceSlice(revision, { start: sourceAt(marker.start), end: sourceEnd(marker.end) })
      }
    }
    return prefix
  }
  const prefix = continuation(after)
  if (prefix === continuation(before)) return []
  const edits: DocumentSourceEdit[] = []
  const last = trailing.at(-1) ?? donor
  const firstLine = records.find(line => line.start <= donor.range.start && line.end > donor.range.start)
  if (firstLine === undefined) throw new RangeError('Paragraph join donor has no physical line')
  for (const line of records) {
    if (line.start <= firstLine.start || line.start >= last.range.end) continue
    const trivia = [...line.listIndentations, ...line.blockquoteMarkers].filter(part => part.depth < before.length)
    const end = Math.max(line.start, ...trivia.map(part => part.end))
    // Empty separators do not require list indentation. Preserve their exact
    // spelling whenever the old and new container prefixes already match.
    const insert = line.blank && after.some(node => node.kind === 'blockquote') ? prefix.trimEnd() : line.blank && trivia.length === 0 ? '' : prefix
    const range = { start: sourceAt(line.start), end: sourceEnd(end) }
    if (core.sourceSlice(revision, range) !== insert) edits.push({ ...range, insert })
  }
  return edits
}
