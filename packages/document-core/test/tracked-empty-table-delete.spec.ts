import { expect, it } from 'vitest'
import { createDocumentCore, projectSourceSelection } from '../src/index.js'

it.each([
  {
    name: 'whole empty table',
    source: '|  |  |\n| --- | --- |\n|  |  |\n',
    anchor: { row: 0, column: 0 },
    focus: { row: 1, column: 1 },
    revised: '\n',
    expected: '{--|  |  |\n| --- | --- |\n|  |  |--}\n',
    target: undefined
  },
  {
    name: 'empty body row',
    source: '| a | b |\n| --- | --- |\n|  |  |\n| c | d |\n',
    anchor: { row: 1, column: 0 },
    focus: { row: 1, column: 1 },
    revised: '| a | b |\n| --- | --- |\n| c | d |\n',
    expected: '| a | b |\n| --- | --- |{--\n|  |  |--}\n| c | d |\n',
    target: { row: 2, column: 0 }
  },
  {
    name: 'empty column with an omitted body cell',
    source: '| a |  | c |\n| --- | --- | --- |\n| x |\n',
    anchor: { row: 0, column: 1 },
    focus: { row: 1, column: 1 },
    revised: '| a | c |\n| --- | --- |\n| x |\n',
    expected: '| a |{--  |--} c |\n| --- |{-- --- |--} --- |\n| x |\n',
    target: { row: 0, column: 2 }
  }
])('tracks structural Delete of $name through the current table model', ({ source, anchor, focus, revised, expected, target }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const plan = core.planClipboard(previous, {
    kind: 'table',
    operation: 'delete',
    tracked: true,
    selection: { kind: 'table', table: { start: 0, end: source.length - 1 }, anchor, focus }
  })
  const next = core.apply(previous, plan.edits).revision
  expect(next.source).toBe(expected)
  if (target === undefined) expect(plan.selection).toEqual({ ranges: [{ anchor: 0, focus: 0 }], primary: 0 })
  else expect(plan.selection).toEqual({ kind: 'table-cell', cell: { table: { start: 0, end: expected.length - 1 }, ...target }, anchor: 0, focus: 0 })
  if ('start' in plan.selection) throw new Error('Structural Delete must return model selection')
  const projected = projectSourceSelection(core, next, plan.selection).ranges[0]
  expect(projected).toEqual({ anchor: target === undefined ? 0 : expected.indexOf(target.row === 2 ? 'c | d' : 'c |'), focus: target === undefined ? 0 : expected.indexOf(target.row === 2 ? 'c | d' : 'c |') })
  expect(core.project(next, 'original').markdown).toBe(source)
  expect(core.project(next, 'revised').markdown).toBe(revised)
})
