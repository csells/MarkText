import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }

it.each([
  { source: 'one {--two--} end\n', from: 7, end: 10, to: 0, copy: false, expected: '{++{--two--}++}one {--two--} end\n', original: 'one two end\n', revised: 'one  end\n', typedRevised: 'Xone  end\n', caret: 12, comments: 0 },
  { source: 'one {--two--} end\n', from: 7, end: 10, to: 0, copy: true, expected: '{++{--two--}++}one {--two--} end\n', original: 'one two end\n', revised: 'one  end\n', typedRevised: 'Xone  end\n', caret: 12, comments: 0 },
  { source: 'A{++bc{>>note<<}de++}F end\n', from: 5, end: 16, to: 22, copy: false, expected: 'A{++bde++}F{++{++c{>>note<<}++}++} end\n', original: 'AF end\n', revised: 'AbdeFc end\n', typedRevised: 'AbdeFcX end\n', caret: 31, comments: 1 },
  { source: 'A{++bc{>>note<<}de++}F end\n', from: 5, end: 16, to: 22, copy: true, expected: 'A{++bc{>>note<<}de++}F{++{++c{>>note<<}++}++} end\n', original: 'AF end\n', revised: 'AbcdeFc end\n', typedRevised: 'AbcdeFcX end\n', caret: 42, comments: 2 }
])('tracks owned annotation movement without rewriting Original: $source (copy=$copy)', example => {
  const core = createDocumentCore()
  const previous = core.open(example.source)
  const action: DocumentInputAction = {
    kind: 'command',
    command: 'moveText',
    copy: example.copy,
    options,
    selection: { ranges: [{ anchor: example.end, focus: example.from }], primary: 0 },
    target: { start: example.to, end: example.to }
  }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, true)
  expect(edits).toBeDefined()
  if (edits === undefined) throw new Error('Expected tracked annotation movement')
  const commit = core.apply(previous, edits)
  expect(commit.revision.source).toBe(example.expected)
  expect(core.project(commit.revision, 'original').markdown).toBe(example.original)
  expect(core.project(commit.revision, 'revised').markdown).toBe(example.revised)
  expect(commit.revision.source.match(/\{>>note<<\}/g) ?? []).toHaveLength(example.comments)
  const selection = { ranges: [{ anchor: example.caret, focus: example.caret }], primary: 0 }
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual(selection)
  const typing: DocumentInputAction = {
    selection, range: { start: example.caret, end: example.caret }, inputType: 'insertText', data: 'X', options
  }
  const typedPlan = core.planInput(commit.revision, typing)
  const typedEdits = core.inputEdits(commit.revision, typing, typedPlan, true)
  expect(typedEdits).toBeDefined()
  if (typedEdits === undefined) throw new Error('Expected typing at tracked move caret')
  const typed = core.apply(commit.revision, typedEdits)
  expect(core.project(typed.revision, 'original').markdown).toBe(example.original)
  expect(core.project(typed.revision, 'revised').markdown).toBe(example.typedRevised)
  expect(typed.revision.source.match(/\{>>note<<\}/g) ?? []).toHaveLength(example.comments)
  const reopened = core.open(typed.revision.source)
  expect(reopened.source).toBe(typed.revision.source)
  expect(core.project(reopened, 'original').markdown).toBe(example.original)
  expect(core.project(reopened, 'revised').markdown).toBe(example.typedRevised)
})
