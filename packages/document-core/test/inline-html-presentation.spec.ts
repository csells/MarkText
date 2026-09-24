import { expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

it('owns inline HTML attributes without interpreting literal values as Markdown or suggestions', () => {
  const core = createDocumentCore()
  const source = 'Before <kbd TITLE="A &amp; B {++literal++}" title="ignored" class=key>key</kbd> after'
  const revision = core.open(source)
  const tags = core.project(revision, 'markup').syntax.ast.root.children[0]!.children.filter(node => node.kind === 'inline-html')
  expect(tags[0]!.attributes).toMatchObject({
    tagName: 'kbd',
    closingTag: false,
    'htmlAttribute:title': 'A & B {++literal++}',
    'htmlAttribute:class': 'key'
  })
  expect(tags[1]!.attributes).toMatchObject({ tagName: 'kbd', closingTag: true })
  expect(revision.annotations).toEqual([])
  expect(revision.source).toBe(source)
})
