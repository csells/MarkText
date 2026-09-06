import { describe, expect, it } from 'vitest'
import { createDocumentCore, type MarkdownAstNode } from '../src/index.js'

const texts = (node: MarkdownAstNode): MarkdownAstNode[] => node.kind === 'text'
  ? [node]
  : node.children.flatMap(texts)

describe('Public semantic text spelling ranges', () => {
  it('locates decoded entities and escapes without changing their raw source ranges', () => {
    const core = createDocumentCore()
    const source = 'x &amp; y \\* z &#x1F600; \\&copy; &unknown;'
    const revision = core.open(source)
    const projection = core.project(revision, 'revised')
    const nodes = texts(projection.ast.root)
    expect(nodes.flatMap(node => node.semanticTextSegments ?? []).map(segment => ({
      raw: source.slice(segment.range.start, segment.range.end), value: segment.value
    }))).toEqual([
      { raw: '&amp;', value: '&' },
      { raw: '\\*', value: '*' },
      { raw: '&#x1F600;', value: '😀' },
      { raw: '\\&', value: '&' }
    ])
    expect(nodes.map(node => node.attributes['semanticText']).join('')).toBe('x & y * z 😀 &copy; &unknown;')
  })

  it('transfers replacement ranges in Markup syntax coordinates across annotation arms', () => {
    const core = createDocumentCore()
    const revision = core.open('before\n\n{~~&amp;~>\\*~~}')
    const projection = core.project(revision, 'markup')
    const ranges = texts(projection.syntax.ast.root).flatMap(node => node.semanticTextSegments ?? [])
    expect(ranges.map(segment => segment.value)).toEqual(['&', '*'])
    expect(structuredClone(ranges)).toEqual(ranges)
    expect(ranges.every(segment => segment.range.end > segment.range.start)).toBe(true)
  })
})
