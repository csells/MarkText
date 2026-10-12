import type { MarkdownAstNode, MarkdownAttribute } from './documentCore.js'

/**
 * Whether a numeric AST attribute named `name` is a position: `*Start` and
 * `*End` facts are projection coordinates, which move with the node.
 */
export const isPositionalMarkdownAttribute = (name: string): boolean => /(?:Start|End)$/u.test(name)

/** `node` and its subtree moved `delta` units, positional attributes included. */
export function shiftMarkdownAstNode(
  node: MarkdownAstNode,
  delta: number
): MarkdownAstNode {
  const attributes: Record<string, MarkdownAttribute> = { ...node.attributes }
  for (const [name, value] of Object.entries(attributes)) {
    if (typeof value === 'number' && isPositionalMarkdownAttribute(name)) {
      attributes[name] = value + delta
    }
  }
  return Object.freeze({
    kind: node.kind,
    range: Object.freeze({
      start: node.range.start + delta,
      end: node.range.end + delta
    }),
    attributes: Object.freeze(attributes),
    ...(node.semanticTextSegments === undefined
      ? {}
      : {
        semanticTextSegments: Object.freeze(node.semanticTextSegments.map(segment => Object.freeze({
          range: Object.freeze({ start: segment.range.start + delta, end: segment.range.end + delta }),
          value: segment.value
        })))
      }),
    children: Object.freeze(node.children.map(
      child => shiftMarkdownAstNode(child, delta)
    ))
  })
}
