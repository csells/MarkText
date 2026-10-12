import type { MarkdownAstNode } from '@marktext/document-core'
import { stringAttribute } from './astAttributes'

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

/**
 * A node's rendered semantic text, with the runs of it that `markdown` spells
 * directly at the node's own projected range.
 */
export const semanticProjectionOf = (
  node: MarkdownAstNode,
  markdown?: string
): SemanticProjection => {
  const contentStart = node.attributes.contentStart
  const contentEnd = node.attributes.contentEnd
  // A literal's text starts after its opening syntax (a backtick run, a
  // fence line), where its node records its content.
  const start = typeof contentStart === 'number' ? contentStart : node.range.start
  const end = typeof contentEnd === 'number' ? contentEnd : node.range.end
  const leaf = (text: string): SemanticProjection => {
    const raw = markdown?.slice(start, end)
    const suffix = raw?.slice(text.length)
    const isDirect = raw === text || (raw?.startsWith(text) === true && /^\s*$/u.test(suffix ?? ''))
    if (isDirect) {
      return Object.freeze({
        text,
        segments: Object.freeze([
          Object.freeze({
            kind: node.kind,
            semanticStart: 0,
            semanticEnd: text.length,
            projectionStart: start,
            projectionEnd: start + text.length
          })
        ])
      })
    }
    // Content that drops part of its spelling, as indented code drops each
    // line's indentation, is spelled line by line by its text children.
    const segments: SemanticSegment[] = []
    let cursor = 0
    for (const child of node.children) {
      const childText = child.kind === 'text' ? stringAttribute(child, 'semanticText') : undefined
      if (childText === undefined || childText === '') continue
      const at = text.indexOf(childText, cursor)
      if (at < 0 || markdown?.slice(child.range.start, child.range.start + childText.length) !== childText) continue
      segments.push(Object.freeze({
        kind: node.kind,
        semanticStart: at,
        semanticEnd: at + childText.length,
        projectionStart: child.range.start,
        projectionEnd: child.range.start + childText.length
      }))
      cursor = at + childText.length
    }
    return Object.freeze({ text, segments: Object.freeze(segments) })
  }
  switch (node.kind) {
    case 'text':
      return leaf(stringAttribute(node, 'semanticText') ?? '')
    case 'soft-break':
    case 'hard-break':
      return leaf('\n')
    case 'inline-code':
    case 'inline-diff':
      return leaf(stringAttribute(node, 'semanticContent') ?? stringAttribute(node, 'content') ?? '')
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
        const projected = semanticProjectionOf(child, markdown)
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
