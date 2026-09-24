import type { DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, MarkupSyntax, SourceRange } from './documentCore.js'
import type { MarkdownLineIndex } from './revision.js'
import type { DocumentCommandInputAction } from './inputPlanning.js'
import { positionAfter } from './sourcePosition.js'
import { isLiteralBlock } from './literalBlock.js'
import { containerContinuationPrefix } from './clipboardMarkdown.js'

export type BlockChange = Extract<DocumentCommandInputAction, { command: 'changeBlock' }>['change']

const blockKind = (node: MarkdownAstNode) => ['paragraph', 'heading', 'list', 'blockquote', 'table', 'thematic-break', 'definition', 'footnote-definition'].includes(node.kind) || isLiteralBlock(node.kind)

/** The block a command at these ancestors addresses, if any. */
export function findBlockCommandTarget(ancestors: readonly MarkdownAstNode[], scope: BlockChange['scope']): MarkdownAstNode | undefined {
  const blocks = ancestors.filter(blockKind)
  return scope === 'outer' ? blocks[0] : blocks.at(-1)
}

export function blockCommandTarget(ancestors: readonly MarkdownAstNode[], scope: BlockChange['scope']): MarkdownAstNode {
  const block = findBlockCommandTarget(ancestors, scope)
  if (block === undefined) throw new RangeError('Block command has no owned target')
  return block
}

/** Menu operations retain the target block's exact source and native caret convention. */
export function planBlockCommand(core: DocumentCore, revision: DocumentRevision, syntax: MarkupSyntax, lines: MarkdownLineIndex, target: MarkdownAstNode, change: BlockChange, lineEnding: string): { edits: DocumentSourceEdit[], selection: SourceRange } {
  const sourceStart = (node: MarkdownAstNode) => syntax.coordinates.toSource(node.range.start, 'previous')
  const sourceEnd = (node: MarkdownAstNode) => {
    let end = node.range.end
    if (node.range.start < end) {
      for (let index = 0; index < lines.count; index++) {
        const line = lines.at(index)
        if (line.end === end) { end = line.contentEnd; break }
        if (line.end > end) break
      }
    }
    return syntax.coordinates.toSource(end, 'next')
  }
  const contentPoint = (node: MarkdownAstNode, last: boolean): number => {
    if (['list', 'list-item', 'blockquote', 'table', 'table-row', 'footnote-definition'].includes(node.kind)) {
      const children = last ? [...node.children].reverse() : node.children
      const child = children.find(candidate => blockKind(candidate) || candidate.kind === 'list-item' || candidate.kind === 'table-row' || candidate.kind === 'table-cell')
      if (child !== undefined) return contentPoint(child, last)
    }
    const position = typeof node.attributes.contentStart === 'number' ? node.attributes.contentStart : node.range.start
    return syntax.coordinates.toSource(position, 'next')
  }
  const from = sourceStart(target)
  const to = sourceEnd(target)
  if (change.type === 'clear') return { edits: [{ start: from, end: to, insert: '' }], selection: { start: from, end: from } }
  if (change.type === 'new') {
    const ancestors: MarkdownAstNode[] = []
    const find = (node: MarkdownAstNode): boolean => {
      if (node === target) return true
      if (node.children.some(find)) { ancestors.unshift(node); return true }
      return false
    }
    find(syntax.ast.root)
    const continuation = containerContinuationPrefix(core, revision, syntax, target, ancestors)
    const text = (change.text ?? '').replace(/\r\n|\r|\n/gu, lineEnding + continuation)
    const separator = lineEnding + continuation.trimEnd() + lineEnding + continuation
    const before = change.placement === 'before'
    const at = before ? from : to
    const insert = before ? text + separator : separator + text
    const caret = before ? at : at + separator.length
    return { edits: [{ start: at, end: at, insert }], selection: { start: caret, end: caret } }
  }
  if (change.type === 'duplicate') {
    if (change.type === 'duplicate' && target.kind === 'front-matter') return { edits: [], selection: { start: from, end: from } }
    const copy = core.sourceSlice(revision, { start: from, end: to })
    const insert = lineEnding + lineEnding + copy
    const caret = to + lineEnding.length * 2 + contentPoint(target, true) - from
    return { edits: [{ start: to, end: to, insert }], selection: { start: caret, end: caret } }
  }
  if (change.type !== 'delete') throw new RangeError('Block source operation requires duplicate, new or delete')
  let siblings: readonly MarkdownAstNode[] = []
  const visit = (node: MarkdownAstNode): boolean => {
    if (node.children.includes(target)) { siblings = node.children; return true }
    return node.children.some(visit)
  }
  visit(syntax.ast.root)
  const index = siblings.indexOf(target)
  const previous = siblings[index - 1]
  const next = siblings[index + 1]
  const survivor = previous ?? next
  const edit = next !== undefined
    ? { start: from, end: sourceStart(next), insert: '' }
    : previous !== undefined
      ? { start: sourceEnd(previous), end: to, insert: '' }
      : { start: from, end: to, insert: '' }
  const caret = survivor === undefined ? from : positionAfter([edit], contentPoint(survivor, previous !== undefined), false)
  return { edits: [edit], selection: { start: caret, end: caret } }
}
