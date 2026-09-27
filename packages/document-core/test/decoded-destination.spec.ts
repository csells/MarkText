import { describe, expect, it } from 'vitest'

import { createDocumentCore, type MarkdownAstNode } from '../src/index.js'

// Document formats such as Pandoc's store a link's path as written, with
// Markdown escapes and entities resolved but nothing percent-encoded.

const linkLike = (node: MarkdownAstNode): MarkdownAstNode[] => [
  ...(['link', 'image', 'autolink'].includes(node.kind) ? [node] : []),
  ...node.children.flatMap(linkLike)
]

describe('decoded link destination', () => {
  it('resolves escapes and entities without percent-encoding', () => {
    const core = createDocumentCore()
    const source = '[a](<my file.md>) ![b](pics/ü\\_1.png) [c](x%20y&amp;z) <http://h.test/ä> [r] www.w.test\n\n[r]: <ref file.md>\n'
    const nodes = linkLike(core.project(core.open(source), 'revised').ast.root)
    expect(nodes.map((node) => [node.attributes['decodedDestination'], node.attributes['semanticDestination']])).toEqual([
      ['my file.md', 'my%20file.md'],
      ['pics/ü_1.png', 'pics/%C3%BC_1.png'],
      ['x%20y&z', 'x%20y&z'],
      ['http://h.test/ä', 'http://h.test/%C3%A4'],
      ['ref file.md', 'ref%20file.md'],
      ['http://www.w.test', 'http://www.w.test']
    ])
  })
})
