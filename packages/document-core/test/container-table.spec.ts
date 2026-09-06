import { expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

it.each(['\n', '\r\n', '\r'])('parses a table inside a list without absorbing the following item (%j)', eol => {
  const source = ['- first', '- second', '', '  | a | b |', '  | --- | :--- |', '  | x | y |', '- third', ''].join(eol)
  const core = createDocumentCore()
  const revision = core.open(source)
  const root = core.project(revision, 'markup').syntax.ast.root
  expect(root.children).toHaveLength(1)
  const list = root.children[0]
  expect(list.kind).toBe('list')
  expect(list.children).toHaveLength(3)
  expect(list.children[1].children.map(node => node.kind)).toEqual(['paragraph', 'table'])
  const table = list.children[1].children[1]
  expect(table.children).toHaveLength(2)
  expect(table.children[1].children.map(cell => source.slice(cell.range.start, cell.range.end))).toEqual(['x', 'y'])
  expect(core.project(revision, 'revised').markdown).toBe(source)
})

it.each(['\n', '\r\n', '\r'])('keeps an annotated nested list inside its owning item (%j)', eol => {
  const source = ['- {++first++}{>>note<<}', '  - second', '', '    ## Section', ''].join(eol)
  const core = createDocumentCore()
  const revision = core.open(source)
  const root = core.project(revision, 'markup').syntax.ast.root
  expect(root.children).toHaveLength(1)
  expect(root.children[0].children).toHaveLength(1)
  expect(root.children[0].children[0].children.map(node => node.kind)).toEqual(['paragraph', 'list'])
})
