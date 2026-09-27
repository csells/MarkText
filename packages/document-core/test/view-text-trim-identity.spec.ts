import { describe, expect, it } from 'vitest'
import { createDocumentCore, type MarkdownAstNode } from '../src/index.js'

// A text node that ends its line in Original may continue into an Addition in
// Revised. Each view keeps its own trailing-whitespace reading of that text,
// whichever view the parser happens to emit first.

const texts = (node: MarkdownAstNode): string[] => [
  ...(node.kind === 'text' ? [String(node.attributes['semanticText'])] : []),
  ...node.children.flatMap(texts)
]

describe('view-specific text trimming', () => {
  it.each([
    ['x `a` {++<b>c++}\n', [' ', 'c']],
    ['x close {++<b>c++}\n', ['x close ', 'c']],
    ['- x close {++<b>c++}\n', ['x close ', 'c']]
  ])('keeps the space before an Addition in Revised for %j', (source, revisedTail) => {
    const core = createDocumentCore()
    const revision = core.open(source)
    expect(texts(core.project(revision, 'revised').ast.root).slice(-2)).toEqual(revisedTail)
    expect(texts(core.project(revision, 'original').ast.root).at(-1)).toBe(revisedTail[0]!.trimEnd())
    expect(texts(core.project(revision, 'markup').syntax.ast.root).slice(-2)).toEqual(revisedTail)
  })
})
