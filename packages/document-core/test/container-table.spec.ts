import { expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

it.each(['\n', '\r\n', '\r'])('parses a table inside a list without absorbing the following item (%j)', eol => {
  const source = ['- first', '- second', '', '  | a | b |', '  | --- | :--- |', '  | x | y |', '- third', ''].join(eol)
  const core = createDocumentCore()
  const revision = core.open(source)
  const root = core.project(revision, 'markup').syntax.ast.root
  expect(root.children).toHaveLength(1)
  const list = root.children[0]
  if (!list) throw new Error('Expected the outer list')
  expect(list.kind).toBe('list')
  expect(list.children).toHaveLength(3)
  const second = list.children[1]
  if (!second) throw new Error('Expected the second list item')
  expect(second.children.map(node => node.kind)).toEqual(['paragraph', 'table'])
  const table = second.children[1]
  if (!table) throw new Error('Expected the nested table')
  expect(table.children).toHaveLength(2)
  const row = table.children[1]
  if (!row) throw new Error('Expected the table body row')
  expect(row.children.map(cell => source.slice(cell.range.start, cell.range.end))).toEqual(['x', 'y'])
  expect(core.project(revision, 'revised').markdown).toBe(source)
})

it.each(['\n', '\r\n', '\r'])('keeps an annotated nested list inside its owning item (%j)', eol => {
  const source = ['- {++first++}{>>note<<}', '  - second', '', '    ## Section', ''].join(eol)
  const core = createDocumentCore()
  const revision = core.open(source)
  const root = core.project(revision, 'markup').syntax.ast.root
  expect(root.children).toHaveLength(1)
  const list = root.children[0]
  if (!list) throw new Error('Expected the outer list')
  expect(list.children).toHaveLength(1)
  const item = list.children[0]
  if (!item) throw new Error('Expected the owning list item')
  expect(item.children.map(node => node.kind)).toEqual(['paragraph', 'list'])
})
