import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
it('retains the actual backward selection through heading reset and compiled input', () => {
  const core = createDocumentCore()
  const source = '## a{++a++}a\n\nbravo\n'
  const previous = core.open(source)
  const action: DocumentInputAction = { kind: 'command', command: 'changeHeading', change: { type: 'paragraph' }, selection: { ranges: [{ anchor: source.length - 1, focus: 0 }], primary: 0 }, options }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, false)
  if (edits === undefined) throw new Error('Heading reset was rejected')
  const commit = core.apply(previous, edits)
  expect(commit.revision.source).toBe('a{++a++}a\n\nbravo\n')
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: commit.revision.sourceLength - 1, focus: 0 }], primary: 0 })
})
it.each([
  { inputType: 'cancelComposition', source: 'abc', data: null, anchor: 3, focus: 0, target: { start: 0, end: 3 }, expected: { anchor: 3, focus: 0 } },
  { inputType: 'insertText', source: '()', data: ')', anchor: 1, focus: 1, target: { start: 1, end: 1 }, expected: { anchor: 2, focus: 2 } }
])('reconciles $inputType without a source commit or a direction guess', ({ inputType, source, data, anchor, focus, target, expected }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const action: DocumentInputAction = { inputType, data, range: target, selection: { ranges: [{ anchor, focus }], primary: 0 }, options }
  const plan = core.planInput(previous, action)
  expect(plan.edits).toEqual([])
  expect(core.reconcileInput(previous, plan, null, action).selection).toEqual({ ranges: [expected], primary: 0 })
  expect(previous.source).toBe(source)
})
it('rejects multiple native input selections instead of silently ignoring ranges', () => {
  const core = createDocumentCore()
  const previous = core.open('abc')
  expect(() => core.planInput(previous, { inputType: 'insertText', data: 'X', range: { start: 0, end: 0 }, selection: { ranges: [{ anchor: 0, focus: 0 }, { anchor: 2, focus: 2 }], primary: 0 }, options })).toThrow('exactly one')
})
it.each([
  { source: '| aa | b |\n| --- | --- |\n| x |\n', row: 0, column: 0, anchor: 2, focus: 0 },
  { source: '| aa | b |\n| --- | --- |\n| x |\n', row: 1, column: 1, anchor: 0, focus: 0 }
])('keeps cell identity and direction for no-op cancellation at $row/$column', ({ source, row, column, anchor, focus }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const selection = { kind: 'table-cell' as const, cell: { table: { start: 0, end: source.length - 1 }, row, column }, anchor, focus }
  const action: DocumentInputAction = { inputType: 'cancelComposition', data: null, selection, range: selection, options }
  const plan = core.planInput(previous, action)
  expect(plan.edits).toEqual([])
  expect(core.reconcileInput(previous, plan, null, action).selection).toEqual(selection)
})
it('keeps a backward selected payload backward when typing a wrapping pair', () => {
  const core = createDocumentCore()
  const previous = core.open('abc')
  const action: DocumentInputAction = { inputType: 'insertText', data: '(', range: { start: 0, end: 3 }, selection: { ranges: [{ anchor: 3, focus: 0 }], primary: 0 }, options }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, false)
  if (edits === undefined) throw new Error('Pair wrapping was rejected')
  const commit = core.apply(previous, edits)
  expect(commit.revision.source).toBe('(abc)')
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 4, focus: 1 }], primary: 0 })
})
