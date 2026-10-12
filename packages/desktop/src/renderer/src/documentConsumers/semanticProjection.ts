import type { MarkdownAstNode } from '@marktext/document-core'

/** Blocks whose rendered text is searched independently. */
export const searchableBlockKinds = new Set<MarkdownAstNode['kind']>([
  'paragraph',
  'heading',
  'code-block',
  'html-block',
  'front-matter',
  'math-block',
  'diagram',
  'table-cell'
])

export const stringAttribute = (node: MarkdownAstNode, name: string): string | undefined => {
  const value = node.attributes[name]
  return typeof value === 'string' ? value : undefined
}

export type SemanticSegment = Readonly<{
  /** The leaf node kind this run of semantic text comes from. */
  readonly kind: MarkdownAstNode['kind']
  readonly semanticStart: number
  readonly semanticEnd: number
  readonly projectionStart: number
  readonly projectionEnd: number
}>

export type SemanticProjection = Readonly<{
  readonly text: string
  readonly segments: readonly SemanticSegment[]
}>

const defaultInlineCodeText = (node: MarkdownAstNode): string =>
  stringAttribute(node, 'semanticContent') ?? stringAttribute(node, 'content') ?? ''

/**
 * A node's rendered semantic text, with the runs of it that `markdown` spells
 * directly at the node's own projected range.
 */
export const semanticProjectionOf = (
  node: MarkdownAstNode,
  markdown?: string,
  inlineCodeText: (node: MarkdownAstNode) => string = defaultInlineCodeText
): SemanticProjection => {
  const leaf = (text: string): SemanticProjection => {
    const raw = markdown?.slice(node.range.start, node.range.end)
    const suffix = raw?.slice(text.length)
    const isDirect = raw === text || (raw?.startsWith(text) === true && /^\s*$/u.test(suffix ?? ''))
    return Object.freeze({
      text,
      segments: isDirect
        ? Object.freeze([
          Object.freeze({
            kind: node.kind,
            semanticStart: 0,
            semanticEnd: text.length,
            projectionStart: node.range.start,
            projectionEnd: node.range.start + text.length
          })
        ])
        : Object.freeze([])
    })
  }
  switch (node.kind) {
    case 'text':
      return leaf(stringAttribute(node, 'semanticText') ?? '')
    case 'soft-break':
    case 'hard-break':
      return leaf('\n')
    case 'inline-code':
      return leaf(inlineCodeText(node))
    case 'code-block':
    case 'html-block':
    case 'front-matter':
    case 'math-block':
    case 'diagram':
      return leaf(stringAttribute(node, 'content') ?? '')
    case 'definition':
      return leaf('')
    default: {
      let text = ''
      const segments: SemanticSegment[] = []
      for (const child of node.children) {
        const projected = semanticProjectionOf(child, markdown, inlineCodeText)
        const offset = text.length
        text += projected.text
        segments.push(
          ...projected.segments.map((segment) =>
            Object.freeze({
              kind: segment.kind,
              semanticStart: segment.semanticStart + offset,
              semanticEnd: segment.semanticEnd + offset,
              projectionStart: segment.projectionStart,
              projectionEnd: segment.projectionEnd
            })
          )
        )
      }
      return Object.freeze({ text, segments: Object.freeze(segments) })
    }
  }
}
