import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

it.each(['\n', '\r\n', '\r'])('compiles adjacent prefix edits without consuming the untouched span before a distinct renumber (%j)', ending => {
  const core = createDocumentCore()
  const source = '8) same' + ending + '9) {++sa++}me{>>keep<<}' + ending + '10) final' + ending
  const revision = core.open(source)
  const at = source.indexOf('sa++}')
  const action: DocumentInputAction = {
    kind: 'command',
    command: 'changeList',
    change: { type: 'backspace' },
    listOptions: { bulletListMarker: '-', orderListDelimiter: '.' },
    selection: { ranges: [{ anchor: at, focus: at }], primary: 0 },
    options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
  }
  const plan = core.planInput(revision, action)
  expect(plan.edits).toEqual([
    { start: 7 + ending.length, end: 7 + ending.length, insert: ending },
    { start: 7 + ending.length, end: 10 + ending.length, insert: '   ' },
    { start: 30 + 2 * ending.length, end: 34 + 2 * ending.length, insert: '9) ' }
  ])
  const edits = core.inputEdits(revision, action, plan, true)
  if (edits === undefined) throw new Error('Tracked structural edit was rejected')
  const commit = core.apply(revision, edits)
  const expected = '8) same' + ending + '{~~9) ~>' + ending + '   ~~}{++sa++}me{>>keep<<}' + ending + '{~~10) ~>9) ~~}final' + ending
  expect(commit.revision.source).toBe(expected)
  expect(commit.change.appliedEdits).toHaveLength(2)
  expect(commit.revision.annotations.map(annotation => annotation.kind)).toEqual(['substitution', 'addition', 'comment', 'substitution'])
  expect(core.project(commit.revision, 'original').markdown).toBe('8) same' + ending + '9) me' + ending + '10) final' + ending)
  expect(core.project(commit.revision, 'revised').markdown).toBe('8) same' + ending + ending + '   same' + ending + '9) final' + ending)
  const target = expected.indexOf('sa++}')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: target, focus: target }], primary: 0 })
  expect(core.open(expected).source).toBe(expected)
})
