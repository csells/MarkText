import type { DocumentCore, DocumentRevision, MarkdownAstNode, MarkdownAttribute } from './documentCore.js'
import type { DocumentModelTextSelection } from './sourceInputPlanning.js'
import { resolveModelTextSelection } from './modelText.js'
import { positionAfter } from './sourcePosition.js'
import { isLiteralBlock } from './literalBlock.js'

/** Copy owned Revised syntax; values at intrinsic endpoints never require a parse. */
export function projectModelTextSelection(core: DocumentCore, revision: DocumentRevision, selection: DocumentModelTextSelection) {
  const selected = resolveModelTextSelection(core, revision, selection)
  const projection = core.project(revision, 'revised')
  const from = projection.coordinates.toProjected(selected.bounds.start, 'next')
  const to = projection.coordinates.toProjected(selected.bounds.end, 'previous')
  const edits: { start: number, end: number, insert: string }[] = []
  const same = selected.first.range.start === selected.last.range.start && selected.first.range.end === selected.last.range.end
  const included = (range: { start: number, end: number }) => (projection.coordinates.sourceSegments ?? []).some(segment => segment.source.start <= range.start && range.end <= segment.source.end)
  if (selected.first.node !== undefined && included(selected.first.range)) {
    const start = projection.coordinates.toProjected(selected.first.range.start, 'next')
    const end = projection.coordinates.toProjected(selected.first.range.end, 'previous')
    edits.push({ start, end, insert: selected.first.text.slice(selected.first.offset, same ? selected.last.offset : undefined) })
  }
  if (!same && selected.last.node !== undefined && included(selected.last.range)) {
    edits.push({ start: projection.coordinates.toProjected(selected.last.range.start, 'next'), end: projection.coordinates.toProjected(selected.last.range.end, 'previous'), insert: selected.last.text.slice(0, selected.last.offset) })
  }
  let markdown = projection.markdown.slice(from, to)
  for (const edit of [...edits].reverse()) markdown = markdown.slice(0, edit.start - from) + edit.insert + markdown.slice(edit.end - from)
  const position = (offset: number, after = false) => positionAfter(edits, Math.max(from, Math.min(to, offset)), after) - from
  const copy = (node: MarkdownAstNode): MarkdownAstNode | undefined => {
    if (node.kind !== 'document' && (node.range.end <= from || node.range.start >= to)) return undefined
    const children = node.children.flatMap(child => { const copied = copy(child); return copied === undefined ? [] : [copied] })
    const range = { start: position(node.range.start), end: position(node.range.end, true) }
    const complete = node.range.start >= from && node.range.end <= to
    const attributes: Record<string, MarkdownAttribute> = {}
    for (const [key, value] of Object.entries(node.attributes)) {
      if (typeof value !== 'number' || !/(?:Start|End)$/.test(key)) attributes[key] = value
      else if (from <= value && value <= to) attributes[key] = position(value, key.endsWith('End'))
    }
    if (node.kind === 'text') {
      const replacement = edits.find(edit => edit.start === node.range.start && edit.end === node.range.end)
      if (replacement !== undefined) attributes.semanticText = replacement.insert
      else if (!complete) attributes.semanticText = markdown.slice(range.start, range.end)
    }
    // A partial literal body is selected text, not its unselected delimiters,
    // language or full-content scalar. Its existing text children supply meaning.
    const kind = isLiteralBlock(node.kind) && !complete ? 'paragraph' : node.kind
    return Object.freeze({ kind, range: Object.freeze(range), attributes: Object.freeze(kind !== node.kind ? {} : attributes), children: Object.freeze(children) })
  }
  const root = copy(projection.ast.root)
  if (root === undefined) throw new RangeError('Model text selection has no Revised projection')
  return Object.freeze({ name: 'revised' as const, markdown, ast: Object.freeze({ root }) })
}
