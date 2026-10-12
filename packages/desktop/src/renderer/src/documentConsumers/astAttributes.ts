import type { MarkdownAstNode } from '@marktext/document-core'

export const stringAttribute = (node: MarkdownAstNode, name: string): string | undefined => {
  const value = node.attributes[name]
  return typeof value === 'string' ? value : undefined
}

const positionKeys = new Map<string, boolean>()
/** Whether an attribute named `key` holds a source position. */
export const isPositionKey = (key: string): boolean => {
  let position = positionKeys.get(key)
  if (position === undefined) {
    position = /(?:Start|End)$/u.test(key)
    positionKeys.set(key, position)
  }
  return position
}
