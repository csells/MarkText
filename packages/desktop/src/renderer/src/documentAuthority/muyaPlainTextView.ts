import type {
  MarkdownAstNode,
  MarkdownProjection,
  SourceRange
} from '@marktext/document-core'

export type MuyaPlainTextViewBinding = Readonly<{
  readonly path: readonly [blockIndex: number, field: 'text']
  readonly sourceRange: SourceRange
  readonly text: string
}>

export type MuyaPlainTextViewResult =
  Readonly<{
    readonly kind: 'view'
    readonly markdown: string
    readonly bindings: readonly MuyaPlainTextViewBinding[]
  }>

const isPlainParagraph = (node: MarkdownAstNode): boolean => {
  if (node.kind !== 'paragraph' || node.children.length !== 1) return false
  const child = node.children[0]
  return child?.kind === 'text' &&
    child.range.start === node.range.start &&
    child.range.end === node.range.end
}

/**
 * Detaches the smallest currently proven Muya view map from a public Core
 * projection. Plain projected paragraphs whose bytes map one-to-one to source
 * receive editable bindings. A CriticMarkup projection may still render as a
 * plain paragraph while its elided markers make that mapping discontinuous;
 * it remains visible but deliberately unbound so the adapter cannot invent a
 * source edit. Structural or inline Markdown stays on the explicit fallback
 * path; this adapter never recognizes Markdown source itself.
 */
export function createMuyaPlainTextView(
  projection: MarkdownProjection
): MuyaPlainTextViewResult {
  const children = projection.ast.root.children

  const bindings: MuyaPlainTextViewBinding[] = []
  for (const [blockIndex, child] of children.entries()) {
    if (!isPlainParagraph(child)) continue
    const text = projection.markdown.slice(child.range.start, child.range.end)
    const start = projection.coordinates.toSource(child.range.start, 'next')
    const end = projection.coordinates.toSource(child.range.end, 'previous')
    if (end - start !== text.length) continue
    let contiguous = true
    for (let offset = 0; offset < text.length; offset += 1) {
      const origin = projection.coordinates.originAt(child.range.start + offset)
      if (origin.kind !== 'source' || origin.sourceOffset !== start + offset) {
        contiguous = false
        break
      }
    }
    if (!contiguous) continue
    bindings.push(Object.freeze({
      path: Object.freeze([blockIndex, 'text'] as const),
      sourceRange: Object.freeze({ start, end }),
      text
    }))
  }

  return Object.freeze({
    kind: 'view',
    markdown: projection.markdown,
    bindings: Object.freeze(bindings)
  })
}
