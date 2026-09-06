import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

describe('arm-local GFM autolinks', () => {
  it.each([
    ['{++https://example.org++}', '', 'https://example.org'],
    ['{++<https://example.com> https://example.org++}', '', '<https://example.com> https://example.org'],
    ['{--https://example.org--}', 'https://example.org', ''],
    ['{==https://example.org==}', 'https://example.org', 'https://example.org'],
    ['{~~https://old.example~>https://new.example~~}', 'https://old.example', 'https://new.example']
  ])('terminates bare autolinks at the owning arm boundary: %s', (source, original, revised) => {
    const core = createDocumentCore()
    const revision = core.open(source)
    expect(revision.annotations).toHaveLength(1)
    expect(core.project(revision, 'original').markdown).toBe(original)
    expect(core.project(revision, 'revised').markdown).toBe(revised)
    const nodes = core.project(revision, 'markup').syntax.ast.root.children.flatMap(node => node.children)
    expect(nodes.filter(node => node.kind === 'link').map(node => node.attributes.semanticDestination))
      .toEqual(source.includes('old.example') ? ['https://old.example', 'https://new.example'] : ['https://example.org'])
    expect(revision.source).toBe(source)
  })

  it('retains completed angle autolink ownership and ordinary URL punctuation', () => {
    const core = createDocumentCore()
    const revision = core.open('{++<https://example.org/++}>++}')
    expect(revision.annotations).toHaveLength(1)
    expect(core.project(revision, 'revised').markdown).toBe('<https://example.org/++}>')
    const plain = core.open('https://example.org/++}')
    expect(core.project(plain, 'revised').ast.root.children[0]?.children[0]?.attributes.semanticDestination)
      .toBe('https://example.org/++%7D')
  })

  it('recognizes a typed closer without changing the surrounding source', () => {
    const core = createDocumentCore()
    const source = 'before\n\n{++https://example.org\n\nafter\n'
    const initial = core.open(source)
    const at = source.indexOf('\n\nafter')
    const result = core.apply(initial, [{ start: at, end: at, insert: '++}' }], { projections: ['markup'] })
    expect(result.revision.annotations).toHaveLength(1)
    expect(result.revision.source).toBe(source.slice(0, at) + '++}' + source.slice(at))
    expect(core.project(result.revision, 'revised').markdown).toBe('before\n\nhttps://example.org\n\nafter\n')
    const oracle = createDocumentCore()
    const expected = oracle.project(oracle.open(result.revision.source), 'markup')
    const actual = core.project(result.revision, 'markup')
    expect(actual.syntax.ast).toEqual(expected.syntax.ast)
    expect(actual.syntax.coordinates.sourceSegments).toEqual(expected.syntax.coordinates.sourceSegments)
  })
})
