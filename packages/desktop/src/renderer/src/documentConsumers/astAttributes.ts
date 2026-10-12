import type { MarkdownAstNode } from '@marktext/document-core'

export const stringAttribute = (node: MarkdownAstNode, name: string): string | undefined => {
  const value = node.attributes[name]
  return typeof value === 'string' ? value : undefined
}
