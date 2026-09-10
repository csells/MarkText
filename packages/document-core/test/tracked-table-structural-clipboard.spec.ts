import { expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

it('cuts a populated whole table in Track while preserving its Original and removing its Revised view', () => {
  const core = createDocumentCore()
  const source = '| a | b |\n| --- | --- |\n| c | d |\n'
  const revision = core.open(source)
  const plan = core.planClipboard(revision, {
    kind: 'table',
    operation: 'cut',
    tracked: true,
    selection: { kind: 'table', table: { start: 0, end: source.length - 1 }, anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } }
  })
  const next = core.apply(revision, plan.edits).revision
  expect(next.source).toBe('{--| a | b |\n| --- | --- |\n| c | d |--}\n')
  expect(core.project(next, 'original').markdown).toBe(source)
  expect(core.project(next, 'revised').markdown).toBe('\n')
})

it('already compiles the same whole-table removal through the existing tracked edit owner', () => {
  const core = createDocumentCore()
  const source = '| a | b |\n| --- | --- |\n| c | d |\n'
  const revision = core.open(source)
  const edits = core.trackedEdits(revision, [{ start: 0, end: source.length - 1, insert: '' }])
  expect(edits).toBeDefined()
  const next = core.apply(revision, edits ?? []).revision
  expect(next.source).toBe('{--| a | b |\n| --- | --- |\n| c | d |--}\n')
  expect(core.project(next, 'original').markdown).toBe(source)
  expect(core.project(next, 'revised').markdown).toBe('\n')
})

it.each([false, true])('keeps next input on the chosen surviving context after tracked whole-table Cut (following=%s)', following => {
  const core = createDocumentCore()
  const table = '| a | b |\n| --- | --- |\n| c | d |'
  const source = `${table}\n${following ? '\nafter\n' : ''}`
  const revision = core.open(source)
  const plan = core.planClipboard(revision, {
    kind: 'table',
    operation: 'cut',
    tracked: true,
    selection: { kind: 'table', table: { start: 0, end: table.length }, anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } }
  })
  const next = core.apply(revision, plan.edits).revision
  if (!('ranges' in plan.selection)) throw new Error('Whole table Cut must return exterior text selection')
  const range = plan.selection.ranges[plan.selection.primary]
  if (range === undefined) throw new Error('Missing next selection')
  const point = following ? next.source.indexOf('after') : 0
  expect(range).toEqual({ anchor: point, focus: point })
  const input = core.planInput(next, { selection: { ranges: [{ anchor: point, focus: point }], primary: 0 }, range: { start: point, end: point }, inputType: 'insertText', data: 'X', options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true } })
  const inputEdits = core.trackedEdits(next, input.edits)
  expect(inputEdits).toBeDefined()
  const typed = core.apply(next, inputEdits ?? []).revision
  expect(typed.source).toBe(following ? `{--${table}--}\n\n{++X++}after\n` : `{++X++}{--${table}--}\n`)
  const reopened = createDocumentCore()
  const reopenedRevision = reopened.open(typed.source)
  expect(reopened.project(reopenedRevision, 'original').markdown).toBe(source)
  expect(reopened.project(reopenedRevision, 'revised').markdown).toBe(following ? '\n\nXafter\n' : 'X\n')
})

it('preserves cell comments and existing addition semantics when cutting an annotated table in Track', () => {
  const core = createDocumentCore()
  const source = '| a{++b++} | c{>>note<<} |\n| --- | --- |\n| d | e |\n'
  const revision = core.open(source)
  const plan = core.planClipboard(revision, {
    kind: 'table',
    operation: 'cut',
    tracked: true,
    selection: { kind: 'table', table: { start: 0, end: source.length - 1 }, anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } }
  })
  const next = core.apply(revision, plan.edits).revision
  expect(next.source).toBe(`{--${source.slice(0, -1)}--}\n`)
  expect(core.project(next, 'original').markdown).toBe('| a | c |\n| --- | --- |\n| d | e |\n')
  expect(core.project(next, 'revised').markdown).toBe('\n')
  expect(next.annotations[0]?.arms[0]?.annotations.map(annotation => annotation.kind)).toEqual(['addition', 'comment'])
})

it.each([false, true])('cancels a whole added table instead of leaving annotation fragments (tracked=%s)', tracked => {
  const core = createDocumentCore()
  const table = '| a | b |\n| --- | --- |\n| c | d |'
  const source = `{++${table}++}\n`
  const revision = core.open(source)
  const syntax = core.project(revision, 'markup').syntax
  const node = syntax.ast.root.children.find(node => node.kind === 'table')
  if (node === undefined) throw new Error('Expected owned added table')
  const plan = core.planClipboard(revision, {
    kind: 'table',
    operation: 'cut',
    tracked,
    selection: { kind: 'table', table: { start: syntax.coordinates.toSource(node.range.start, 'previous'), end: syntax.coordinates.toSource(node.range.end, 'next') }, anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } }
  })
  const next = core.apply(revision, plan.edits).revision
  expect(next.source).toBe('\n')
  expect(next.annotations).toEqual([])
  expect(plan.selection).toEqual({ ranges: [{ anchor: 0, focus: 0 }], primary: 0 })
})

it.each([
  'a{>>note {++nested++}<<}',
  'a{>>note {==nested==}<<}',
  'a{=={>>inner<<}==}',
  'a{++{>>inner<<}++}',
  'a{~~{>>inner<<}~>~~}'
])('consumes a fully owned annotation subtree during ordinary whole-table Cut: %s', content => {
  const core = createDocumentCore()
  const source = `| ${content} | b |\n| --- | --- |\n| c | d |\n`
  const revision = core.open(source)
  const plan = core.planClipboard(revision, {
    kind: 'table',
    operation: 'cut',
    tracked: false,
    selection: { kind: 'table', table: { start: 0, end: source.length - 1 }, anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } }
  })
  const next = core.apply(revision, plan.edits).revision
  expect(next.source).toBe('\n')
  expect(next.annotations).toEqual([])
})

it.each([
  { before: '{>>before {++nested++}<<}\n\n', after: '\n\n{>>after<<}\n' },
  { before: '{++before\n\n', after: '\n\ntail++}\n' }
])('retains annotation owners and comments outside the removed table', ({ before, after }) => {
  const core = createDocumentCore()
  const table = '| a | b |\n| --- | --- |\n| c | d |'
  const source = before + table + after
  const revision = core.open(source)
  const plan = core.planClipboard(revision, {
    kind: 'table',
    operation: 'cut',
    tracked: false,
    selection: { kind: 'table', table: { start: before.length, end: before.length + table.length }, anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } }
  })
  expect(core.apply(revision, plan.edits).revision.source).toBe(before + after)
})

it('keeps visible-text deletion comment preservation unchanged', () => {
  const core = createDocumentCore()
  const revision = core.open('a{>>note {++nested++}<<}\n')
  const edits = core.markupEdits(revision, [{ start: 0, end: revision.sourceLength - 1, insert: '' }])
  expect(edits).toBeDefined()
  expect(core.apply(revision, edits ?? []).revision.source).toBe('{>>note {++nested++}<<}\n')
})
