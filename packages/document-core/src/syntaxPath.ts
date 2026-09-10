import type { MarkdownAstNode } from './documentCore.js'

/** One owned ancestor path: a following start outranks a preceding end. */
export function syntaxPathAt(root: MarkdownAstNode, position: number, ownsTrailing?: (node: MarkdownAstNode) => boolean): MarkdownAstNode[] {
  const contains = (node: MarkdownAstNode) => node.range.start <= position &&
    (position <= node.range.end || ownsTrailing?.(node) === true)
  if (!Number.isInteger(position) || !contains(root)) return []
  const path: MarkdownAstNode[] = []
  let node: MarkdownAstNode | undefined = root
  while (node !== undefined) {
    path.push(node)
    node = node.children.find(child => child.range.start === position && contains(child)) ??
      node.children.find(child => child.range.start < position && position < child.range.end) ??
      node.children.find(child => contains(child))
  }
  return path
}
