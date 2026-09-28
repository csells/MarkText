import type { MarkdownAstNode } from '@marktext/document-core'

export interface SemanticTextPiece {
  /** Position in the node's projection coordinates. */
  readonly at: number
  readonly text: string
  /**
   * Text a longer spelling such as `&#9;` stands for, which is never a word
   * break.
   */
  readonly literal?: true
}

/**
 * Pairs each code unit of a text node's semantic value with its projected
 * position. Normalized spellings are positioned at their segment; protective
 * text the parser generates carries no value of its own. A value that cannot
 * be aligned stays whole at the node's start.
 */
export const semanticTextPieces = (
  node: MarkdownAstNode,
  isGenerated: (position: number) => boolean = () => false
): SemanticTextPiece[] => {
  const semanticText = node.attributes['semanticText']
  const value = typeof semanticText === 'string' ? semanticText : ''
  const segments = [...(node.semanticTextSegments ?? [])].sort(
    (left, right) => left.range.start - right.range.start
  )
  const align = (skipGenerated: boolean): SemanticTextPiece[] | undefined => {
    const pieces: SemanticTextPiece[] = []
    let offset = 0
    let segment = 0
    for (let position = node.range.start; position < node.range.end;) {
      const next = segments[segment]
      if (next !== undefined && next.range.start <= position) {
        if (next.range.start === position && next.value !== '') {
          const literal = next.range.end - next.range.start > next.value.length
          pieces.push({ at: position, text: next.value, ...(literal ? { literal: true as const } : {}) })
        }
        offset += next.range.start === position ? next.value.length : 0
        position = Math.max(position + 1, next.range.end)
        segment += 1
        continue
      }
      if (!(skipGenerated && isGenerated(position))) {
        if (offset >= value.length) return undefined
        pieces.push({ at: position, text: value[offset]! })
        offset += 1
      }
      position += 1
    }
    return offset === value.length ? pieces : undefined
  }
  return align(false) ?? align(true) ?? [{ at: node.range.start, text: value }]
}
