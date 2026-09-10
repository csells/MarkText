import { expect, it } from 'vitest'
import { createDocumentCore, type MarkdownAstNode } from '../src/index.js'

const emptyParagraphs = (node: MarkdownAstNode): readonly MarkdownAstNode[] => [
  ...(node.kind === 'paragraph' && node.range.start === node.range.end ? [node] : []),
  ...node.children.flatMap(emptyParagraphs)
]

it.each(['{>>note<<}', '{++++}', '{====}', '{~~~>~~}'])('owns an empty editing document without consuming its marks: %s', source => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const markup = core.project(revision, 'markup')
  const points = emptyParagraphs(markup.syntax.ast.root)
  expect(points).toHaveLength(1)
  const point = points[0]
  if (point === undefined) throw new Error('Missing empty document point')
  expect(markup.syntax.coordinates.toSource(point.range.start, 'next')).toBe(source.length)
  expect(revision.source).toBe(source)
})

it.each([
  { source: '- ___\n\n  \n- other{>>keep<<}\n', at: 9, container: 'list-item' },
  { source: '> ---\n>\n> \n\noutside{>>keep<<}\n', at: 10, container: 'blockquote' }
])('keeps trailing container insertion points inside their owner: $source', ({ source, at, container }) => {
  const core = createDocumentCore()
  const markup = core.project(core.open(source), 'markup')
  const containers = (node: MarkdownAstNode): readonly MarkdownAstNode[] => [
    ...(node.kind === container ? [node] : []), ...node.children.flatMap(containers)
  ]
  const points = containers(markup.syntax.ast.root).flatMap(emptyParagraphs)
  expect(points.map(node => markup.syntax.coordinates.toSource(node.range.start, 'next'))).toContain(at)
})

for (const ending of ['\n', '\r\n', '\r']) {
  const eol = (source: string): string => source.replaceAll('\n', ending)
  for (const marks of ['', '{>>note<<}', '{++++}', '{====}', '{~~~>~~}']) {
    it(`keeps the empty document insertion point before its final EOL: ${JSON.stringify(marks)} (${JSON.stringify(ending)})`, () => {
      const core = createDocumentCore()
      const revision = core.open(marks + ending)
      const markup = core.project(revision, 'markup')
      const points = emptyParagraphs(markup.syntax.ast.root)
      expect(points.map(node => node.range)).toEqual([{ start: 0, end: 0 }])
      expect(markup.syntax.coordinates.toSource(0, 'next')).toBe(marks.length)
      expect(revision.source).toBe(marks + ending)
    })
  }
  for (const example of [
    { source: '', before: '' },
    { source: '\n\nbody{>>keep<<}\n', before: '' },
    { source: '> \n> \n> body\n', before: '> ' },
    { source: '> ', before: '> ' },
    { source: '- ', before: '- ' },
    { source: '- [ ] ', before: '- [ ] ' },
    { source: 'seed\n\n\n', before: 'seed\n\n' },
    { source: '---\n\n\n\noutside{>>keep<<}\n', before: '---\n\n' },
    { source: '> ---\n>\n> \n>\n> outside\n', before: '> ---\n>\n> ' },
    { source: '- item\n\n  ---\n\n  \n\n  outside\n', before: '- item\n\n  ---\n\n  ' },
    { source: '```js\naaa\n```\n\n', before: '```js\naaa\n```\n\n' }
  ]) {
    it(`owns an editing paragraph at ${JSON.stringify(example.before)} in ${JSON.stringify(example.source)} (${JSON.stringify(ending)})`, () => {
      const source = eol(example.source)
      const core = createDocumentCore()
      const revision = core.open(source)
      const markup = core.project(revision, 'markup')
      const empty = emptyParagraphs(markup.syntax.ast.root)
      expect(empty.map(node => markup.syntax.coordinates.toSource(node.range.start, 'next'))).toContain(eol(example.before).length)
      for (const mode of ['original', 'revised'] as const) expect(emptyParagraphs(core.project(revision, mode).ast.root)).toEqual([])
      const at = eol(example.before).length
      const inserted = core.apply(revision, [{ start: at, end: at, insert: 'x' }]).revision
      expect(inserted.source).toBe(source.slice(0, at) + 'x' + source.slice(at))
      const removed = core.apply(inserted, [{ start: at, end: at + 1, insert: '' }]).revision
      expect(emptyParagraphs(core.project(removed, 'markup').syntax.ast.root).map(node => node.range)).toEqual(empty.map(node => node.range))
    })
  }
  for (const source of ['\nbody\n', 'seed\n', 'seed\n\nnext\n', '---\n\nnext\n', '```\n\n\n\n```\n']) {
    it(`does not invent an insertion paragraph in ${JSON.stringify(source)} (${JSON.stringify(ending)})`, () => {
      const core = createDocumentCore()
      const revision = core.open(eol(source))
      expect(emptyParagraphs(core.project(revision, 'markup').syntax.ast.root)).toEqual([])
    })
  }
}
