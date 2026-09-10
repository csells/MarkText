import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

describe('owned inline-code syntax at CriticMarkup projection boundaries', () => {
  it.each([
    { name: 'nested arms', source: '`a`{++`a`{==`a`==}`a`++}`a`\n', spans: [{ start: 0, end: 3 }, { start: 6, end: 9 }, { start: 12, end: 15 }, { start: 18, end: 21 }, { start: 24, end: 27 }] },
    { name: 'multi-backtick spans', source: '``a``{++``a``++}``a``\n', spans: [{ start: 0, end: 5 }, { start: 8, end: 13 }, { start: 16, end: 21 }] },
    { name: 'addition', source: '`a`{++`a`++}`a`\n', spans: [{ start: 0, end: 3 }, { start: 6, end: 9 }, { start: 12, end: 15 }] },
    { name: 'hidden comment', source: '`a`{>>note<<}`a`\n', spans: [{ start: 0, end: 3 }, { start: 13, end: 16 }] },
    { name: 'substitution arms', source: '`a`{~~`a`~>`a`~~}`a`\n', spans: [{ start: 0, end: 3 }, { start: 6, end: 9 }, { start: 11, end: 14 }, { start: 17, end: 20 }] }
  ])('retains the distinct canonical code spans across $name', ({ source, spans }) => {
    const count = spans.length
    const core = createDocumentCore()
    const revision = core.open(source)
    const markup = core.project(revision, 'markup')
    const nodes = markup.syntax.ast.root.children[0]?.children ?? []
    expect(nodes.map(node => node.kind)).toEqual(Array(count).fill('inline-code'))
    expect(nodes.map(node => node.attributes.semanticContent)).toEqual(Array(count).fill('a'))
    expect(nodes.map(node => ({
      start: markup.syntax.coordinates.toSource(node.range.start, 'next'),
      end: markup.syntax.coordinates.toSource(node.range.end, 'previous')
    }))).toEqual(spans)
    expect(revision.source).toBe(source)
  })

  it('preserves ordinary Markdown adjacent backticks as one canonical code span', () => {
    const core = createDocumentCore()
    const markup = core.project(core.open('`a``a``a`\n'), 'markup')
    expect(markup.syntax.ast.root.children[0]?.children).toMatchObject([
      { kind: 'inline-code', attributes: { semanticContent: 'a``a``a' } }
    ])
  })
})

it.each([
  { source: `$a$${'{++$a$++}'}$a$\n`, spans: [{ start: 0, end: 3 }, { start: 6, end: 9 }, { start: 12, end: 15 }] },
  { source: `$a$${'{>>note<<}'}$a$\n`, spans: [{ start: 0, end: 3 }, { start: 13, end: 16 }] },
  { source: `$a$${'{~~$a$~>$a$~~}'}$a$\n`, spans: [{ start: 0, end: 3 }, { start: 6, end: 9 }, { start: 11, end: 14 }, { start: 17, end: 20 }] }
])('retains canonical math delimiters at hidden boundaries in $source', ({ source, spans }) => {
  const core = createDocumentCore()
  const markup = core.project(core.open(source), 'markup')
  const nodes = markup.syntax.ast.root.children[0]?.children ?? []
  expect(nodes.map(node => node.kind)).toEqual(spans.map(() => 'inline-math'))
  expect(nodes.map(node => node.attributes.content)).toEqual(spans.map(() => 'a'))
  expect(nodes.map(node => ({ start: markup.syntax.coordinates.toSource(node.range.start, 'next'), end: markup.syntax.coordinates.toSource(node.range.end, 'previous') }))).toEqual(spans)
})

it('retains an ordinary adjacent-dollar expression as one canonical math span', () => {
  const core = createDocumentCore()
  const markup = core.project(core.open('$a$$a$$a$\n'), 'markup')
  expect(markup.syntax.ast.root.children[0]?.children).toMatchObject([{ kind: 'inline-math', attributes: { content: 'a$$a$$a' } }])
})
