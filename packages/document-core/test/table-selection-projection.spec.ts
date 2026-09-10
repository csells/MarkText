import { expect, it } from 'vitest'
import { createDocumentCore, type MarkdownAstNode, type DocumentCore, type DocumentRevision, type DocumentTableSelection } from '../src/index.js'
import { projectTableSelection } from '../src/tableSelectionProjection.js'

const cellsOf = (node: MarkdownAstNode): MarkdownAstNode[] => node.kind === 'table-cell' ? [node] : node.children.flatMap(cellsOf)

const rectangle = (core: DocumentCore, revision: DocumentRevision, anchor: { row: number; column: number }, focus: { row: number; column: number }): DocumentTableSelection => {
  const syntax = core.project(revision, 'markup').syntax
  const table = syntax.ast.root.children.find(node => node.kind === 'table')!
  return { kind: 'table', table: { start: syntax.coordinates.toSource(table.range.start, 'previous'), end: syntax.coordinates.toSource(table.range.end, 'next') }, anchor, focus }
}

it('copies only the chosen Revised rectangle, retaining owned inline semantics and exact output coordinates', () => {
  const core = createDocumentCore()
  const revision = core.open('| keep | same | same |\n| --- | :--- | ---: |\n| keep | **{++same++}**{>>hidden<<} | same |\n| keep | {--old--}{++same++} | same |\n')
  const result = projectTableSelection(core, revision, rectangle(core, revision, { row: 1, column: 1 }, { row: 2, column: 2 }))
  expect(result.name).toBe('revised')
  expect(result.markdown).toBe('| **same** | same |\n|:-------- | ----:|\n| same     | same |')
  const cells = cellsOf(result.ast.root)
  expect(cells.map(cell => result.markdown.slice(cell.range.start, cell.range.end))).toEqual(['**same**', 'same', 'same', 'same'])
  expect(cells.map(cell => cell.attributes.header)).toEqual([true, true, false, false])
  expect(result.markdown.slice(cells[0]!.attributes.delimiterStart as number, cells[0]!.attributes.delimiterEnd as number)).toBe(':-------- ')
  expect(cells[0]!.children[0]!.kind).toBe('strong')
  expect(cells[0]!.children[0]!.children[0]!.attributes.semanticText).toBe('same')
  expect(result.markdown).not.toContain('hidden')
  expect(result.markdown).not.toContain('keep')
})

it('keeps single-cell clipboard text and resolved reference semantics without reparsing', () => {
  const core = createDocumentCore()
  const revision = core.open('| a | b |\n| --- | --- |\n| first | [same][target]{>>hidden<<} |\n\n[target]: /kept "title"\n')
  const result = projectTableSelection(core, revision, rectangle(core, revision, { row: 1, column: 1 }, { row: 1, column: 1 }))
  expect(result.markdown).toBe('[same][target]')
  expect(result.ast.root.children[0]!.kind).toBe('paragraph')
  const link = result.ast.root.children[0]!.children[0]!
  expect(link.kind).toBe('link')
  expect(link.attributes.semanticDestination).toBe('/kept')
  expect(link.attributes.semanticTitle).toBe('title')
  expect(link.range).toEqual({ start: 0, end: 14 })
  expect(link.attributes.resolvedDefinitionStart).toBeUndefined()
})

it('copies ordinary repeated cells without including their unselected neighbors', () => {
  const core = createDocumentCore()
  const revision = core.open('| same | same | same |\n| --- | --- | --- |\n| same | same | same |\n')
  const result = projectTableSelection(core, revision, rectangle(core, revision, { row: 1, column: 1 }, { row: 0, column: 1 }))
  expect(result.markdown).toBe('| same |\n| ---- |\n| same |')
  expect(cellsOf(result.ast.root)).toHaveLength(2)
  expect(cellsOf(result.ast.root).map(cell => cell.range)).toEqual([{ start: 2, end: 6 }, { start: 20, end: 24 }])
})

it('keeps an annotated escaped pipe in its owned cell with exact output coordinates', () => {
  const core = createDocumentCore()
  const revision = core.open('| a{++\\|++}b | same |\n| --- | --- |\n| same | same |\n')
  const result = projectTableSelection(core, revision, rectangle(core, revision, { row: 0, column: 0 }, { row: 1, column: 1 }))
  expect(result.markdown).toBe('| a\\|b | same |\n| ---- | ---- |\n| same | same |')
  const cells = cellsOf(result.ast.root)
  expect(cells).toHaveLength(4)
  expect(result.markdown.slice(cells[0]!.range.start, cells[0]!.range.end)).toBe('a\\|b')
  expect(cells[0]!.children.map(child => child.attributes.semanticText).join('')).toBe('a|b')
})

it('refuses padding expansion beyond the existing source ceiling before constructing clipboard output', () => {
  const core = createDocumentCore()
  const source = `| ${'x'.repeat(100_000)} |\n| --- |\n${'| y |\n'.repeat(400)}`
  const revision = core.open(source)
  const selection = rectangle(core, revision, { row: 0, column: 0 }, { row: 400, column: 0 })
  expect(source.length).toBeLessThan(110_000)
  expect(() => projectTableSelection(core, revision, selection)).toThrowError(expect.objectContaining({
    name: 'DocumentCoreError',
    code: 'CM_RESOURCE_SOURCE_UNITS_EXCEEDED',
    metadata: expect.objectContaining({ limit: '32000000' })
  }))
  expect(revision.source).toBe(source)
})
