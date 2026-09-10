import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }

it.each([false, true])('retains directed content selection when a heading prefix extends a complete addition (backward=%s)', backward => {
  const core = createDocumentCore()
  const previous = core.open('{++seed++}\n')
  const range = backward ? { anchor: 7, focus: 4 } : { anchor: 4, focus: 7 }
  const action: DocumentInputAction = { kind: 'command', command: 'changeHeading', change: { type: 'set', level: 1 }, selection: { ranges: [range], primary: 0 }, options }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, true)
  if (edits === undefined) throw new Error('Expected tracked heading command')
  const commit = core.apply(previous, edits)
  expect(commit.revision.source).toBe('{++# seed++}\n')
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: range.anchor + 2, focus: range.focus + 2 }], primary: 0 })
})

it.each([
  { source: 'a{++a++}a\n', start: 0, end: 9, expected: '# a{++a++}a\n', selected: { start: 2, end: 11 } },
  { source: '# a{++a++}a\n', start: 2, end: 11, expected: 'a{++a++}a\n', selected: { start: 0, end: 9 } },
  { source: '## a{++a++}a ##\n', start: 3, end: 12, expected: '# a{++a++}a\n', selected: { start: 2, end: 11 } },
  { source: '> aaa\n', start: 2, end: 5, expected: '> # aaa\n', selected: { start: 4, end: 7 } },
  { source: '- aaa\n', start: 2, end: 5, expected: '- # aaa\n', selected: { start: 4, end: 7 } },
  { source: 'aaa\n===\n', start: 0, end: 3, expected: 'aaa\n', selected: { start: 0, end: 3 } },
  { source: 'aaa\n---\n', start: 0, end: 3, expected: '# aaa\n', selected: { start: 2, end: 5 } }
])('plans the Heading 1 menu from owned syntax and retains selection: $source', ({ source, start, end, expected, selected }) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const inputAction: DocumentInputAction = { kind: 'command', command: 'changeHeading', change: { type: 'toggle', level: 1 }, selection: { ranges: [{ anchor: start, focus: end }], primary: 0 }, options }
  const plan = core.planInput(revision, inputAction)
  const edits = core.inputEdits(revision, inputAction, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits ?? [])
  expect(commit.revision.source).toBe(expected)
  expect(core.reconcileInput(revision, plan, commit, inputAction).selection).toEqual({ ranges: [{ anchor: selected.start, focus: selected.end }], primary: 0 })
  expect(core.open(commit.revision.source).source).toBe(expected)
})

it('retains parser-owned heading content boundaries after incremental source shifts', () => {
  const core = createDocumentCore()
  const previous = core.open('before\n\n## aaa ##\n')
  const shifted = core.apply(previous, [{ start: 0, end: 0, insert: 'more ' }]).revision
  const source = shifted.source
  const start = source.indexOf('aaa')
  const action = { kind: 'command', command: 'changeHeading', change: { type: 'toggle', level: 1 }, selection: { ranges: [{ anchor: start, focus: start + 3 }], primary: 0 }, options } as const
  const plan = core.planInput(shifted, action)
  const reopened = createDocumentCore()
  expect(plan).toEqual(reopened.planInput(reopened.open(source), action))
  expect(core.apply(shifted, plan.edits).revision.source).toBe('more before\n\n# aaa\n')
})

it('tracks the heading marker through the common compiler without rewriting the selected CM payload', () => {
  const core = createDocumentCore()
  const revision = core.open('a{++a++}a\n')
  const inputAction: DocumentInputAction = { kind: 'command', command: 'changeHeading', change: { type: 'toggle', level: 1 }, selection: { ranges: [{ anchor: 0, focus: 9 }], primary: 0 }, options }
  const plan = core.planInput(revision, inputAction)
  const edits = core.inputEdits(revision, inputAction, plan, true)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits ?? [])
  expect(commit.revision.source).toBe('{++# ++}a{++a++}a\n')
  expect(core.project(commit.revision, 'original').markdown).toBe('aa\n')
  expect(core.project(commit.revision, 'revised').markdown).toBe('# aaa\n')
  const selected = core.reconcileInput(revision, plan, commit, inputAction).selection
  expect(selected).toBeDefined()
  if (selected === undefined || !('ranges' in selected)) throw new Error('Heading result requires a source selection')
  const range = selected.ranges[selected.primary]
  if (range === undefined) throw new Error('Missing primary selection')
  const syntax = core.project(commit.revision, 'markup').syntax
  expect(syntax.coordinates.toProjected(range.anchor, 'next')).toBe(2)
  expect(syntax.coordinates.toProjected(range.focus, 'previous')).toBe(5)
})

it.each([1, 2, 3, 4, 5, 6])('uses one heading command for level %s and retains a cross-block selection', level => {
  const core = createDocumentCore()
  const revision = core.open('a{++a++}a\n\nbravo\n')
  const end = revision.sourceLength - 1
  const inputAction: DocumentInputAction = { kind: 'command', command: 'changeHeading', change: { type: 'toggle', level }, selection: { ranges: [{ anchor: 0, focus: end }], primary: 0 }, options }
  const plan = core.planInput(revision, inputAction)
  const edits = core.inputEdits(revision, inputAction, plan, false)
  const commit = core.apply(revision, edits ?? [])
  expect(commit.revision.source).toBe(`${'#'.repeat(level)} a{++a++}a\n\nbravo\n`)
  expect(core.reconcileInput(revision, plan, commit, inputAction).selection).toEqual({ ranges: [{ anchor: level + 1, focus: end + level + 1 }], primary: 0 })
})

it('creates a heading from the empty document caret', () => {
  const core = createDocumentCore()
  const revision = core.open('\n')
  const inputAction: DocumentInputAction = { kind: 'command', command: 'changeHeading', change: { type: 'toggle', level: 2 }, selection: { ranges: [{ anchor: 0, focus: 0 }], primary: 0 }, options }
  const plan = core.planInput(revision, inputAction)
  const commit = core.apply(revision, plan.edits)
  expect(commit.revision.source).toBe('## \n')
  expect(core.reconcileInput(revision, plan, commit, inputAction).selection).toEqual({ ranges: [{ anchor: 3, focus: 3 }], primary: 0 })
})

it.each([
  { type: 'upgrade', source: 'a{++a++}a\n', expected: '###### a{++a++}a\n', offset: 7 },
  { type: 'upgrade', source: '### a{++a++}a\n', expected: '## a{++a++}a\n', offset: 3 },
  { type: 'degrade', source: '###### a{++a++}a\n', expected: 'a{++a++}a\n', offset: 0 },
  { type: 'paragraph', source: 'a{++a++}a\n---\n', expected: 'a{++a++}a\n', offset: 0 }
] as const)('uses owned syntax for heading $type', ({ type, source, expected, offset }) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const start = source.indexOf('a')
  const inputAction: DocumentInputAction = { kind: 'command', command: 'changeHeading', change: { type }, selection: { ranges: [{ anchor: start, focus: start + 9 }], primary: 0 }, options }
  const plan = core.planInput(revision, inputAction)
  const commit = core.apply(revision, core.inputEdits(revision, inputAction, plan, false) ?? [])
  expect(commit.revision.source).toBe(expected)
  expect(core.reconcileInput(revision, plan, commit, inputAction).selection).toEqual({ ranges: [{ anchor: offset, focus: offset + 9 }], primary: 0 })
})

it.each([
  { type: 'upgrade', source: '# aaa\n', start: 2 },
  { type: 'degrade', source: 'aaa\n', start: 0 },
  { type: 'paragraph', source: 'aaa\n', start: 0 }
] as const)('does not manufacture edits for heading $type at its boundary', ({ type, source, start }) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const selection = { ranges: [{ anchor: start, focus: start + 3 }], primary: 0 }
  const inputAction: DocumentInputAction = { kind: 'command', command: 'changeHeading', change: { type }, selection, options }
  const plan = core.planInput(revision, inputAction)
  expect(plan.edits).toEqual([])
  expect(plan.selection).toEqual(selection)
})

it.each([
  { source: '{~~old~>new~~}\n', expected: '# {~~old~>new~~}\n', original: '# old\n', revised: '# new\n' },
  { source: '{~~old~>new~~} tail\n', expected: '# {~~old~>new~~} tail\n', original: '# old tail\n', revised: '# new tail\n' }
])('formats the whole owned paragraph around shared replacement arms: $source', ({ source, expected, original, revised }) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const action: DocumentInputAction = { kind: 'command', command: 'changeHeading', change: { type: 'toggle', level: 1 }, selection: { ranges: [{ anchor: 3, focus: 3 }], primary: 0 }, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits ?? [])
  expect(commit.revision.source).toBe(expected)
  expect(core.project(commit.revision, 'original').markdown).toBe(original)
  expect(core.project(commit.revision, 'revised').markdown).toBe(revised)
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 5, focus: 5 }], primary: 0 })
})
